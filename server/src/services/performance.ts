/**
 * Performance Tracker + the learning loop (SPEC §4b).
 *
 * Locked per profile until that profile completes its OWN YouTube analytics
 * authorization. Once unlocked, a sync:
 *   1. pulls recent owned-video analytics via fetch_analytics.py (per-user OAuth
 *      token, decrypted to a temp dir, wiped after — see scripts.fetchAnalytics),
 *   2. attaches each video's Studio-style "N of 10" rank and, when the video
 *      came from a generated idea, its pre-production alignment_score,
 *   3. distils durable learnings via prompt 06 and writes them back into the
 *      profile (they feed prompts 01/04 as {{performance_learnings}}),
 *   4. saves a "performance" report.
 *
 * Credentials never leave the server; a director can only sync channels they
 * personally connected.
 */
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { BadRequestError, UpstreamError } from "../errors.js";
import { renderPromptFile } from "../prompts/templateEngine.js";
import { getReasoningAdapter } from "../reasoning/adapter.js";
import { extractJsonObject } from "./json.js";
import { assertQuota } from "./quota.js";
import { getScriptRunner, type PerformanceRow } from "./scripts.js";
import { norm } from "./textMatch.js";

function promptsDir(): string {
  return path.join(config.repoRoot, "prompts");
}

export function isConnected(profile: ProfileRecord): boolean {
  const conn = (profile.data as any)?.connections?.youtube_analytics;
  return Boolean(conn?.connected);
}

/** Mark a profile connected after its token has been stored (owner only). */
export async function markConnected(
  scoped: ScopedData,
  profile: ProfileRecord,
  channelId: string,
): Promise<ProfileRecord> {
  const data = profile.data as Record<string, any>;
  data.connections = data.connections ?? {};
  data.connections.youtube_analytics = {
    connected: true,
    channel_id: channelId,
    token_ref: `${scoped.user.id}:${profile.id}`,
    connected_at: new Date().toISOString(),
  };
  return scoped.updateProfile(profile.id, { data });
}

export async function disconnect(scoped: ScopedData, profile: ProfileRecord): Promise<ProfileRecord> {
  await scoped.deleteChannelToken(profile.id);
  const data = profile.data as Record<string, any>;
  data.connections = data.connections ?? {};
  data.connections.youtube_analytics = { connected: false, channel_id: "", token_ref: "", connected_at: "" };
  return scoped.updateProfile(profile.id, { data });
}

interface PerformanceLearnings {
  calibration: { well_calibrated: boolean; notes: string; suggested_weight_change: string | null };
  working: string[];
  not_working: string[];
  learnings: string[];
}

export interface PerformanceSyncResult {
  reportId: string;
  rows: PerformanceRow[];
  learnings: string[];
  calibration: PerformanceLearnings["calibration"];
}

function formatPerformanceRows(rows: PerformanceRow[]): string {
  if (rows.length === 0) return "(no recent videos returned)";
  return rows
    .map((r) => {
      const parts = [
        `title/video: ${r.video}`,
        `views: ${r.views ?? "?"}`,
        `avgViewPct: ${r.averageViewPercentage ?? "?"}`,
        `avgViewDuration: ${r.averageViewDuration ?? "?"}`,
        `rank: ${r.performance_rank ?? "?"}`,
      ];
      if ((r as any).source_idea_alignment_score != null) {
        parts.push(`pre-production alignment_score: ${(r as any).source_idea_alignment_score}`);
      }
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

export async function runPerformanceSync(
  scoped: ScopedData,
  profile: ProfileRecord,
  options: { recent?: number } = {},
): Promise<PerformanceSyncResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Performance sync can only be run on your own profiles");
  }
  if (!isConnected(profile)) {
    throw new BadRequestError("This channel has not authorized YouTube analytics yet");
  }
  await assertQuota(scoped, "performance");
  const token = await scoped.getChannelToken(profile.id);
  if (!token) {
    throw new BadRequestError("No stored authorization for this channel — reconnect it");
  }
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;
  const slug = data.slug ?? profile.slug;

  const { result, refreshedToken } = await scripts.fetchAnalytics(slug, token, {
    recent: options.recent ?? 10,
  });
  // If the OAuth token was refreshed during the run, re-encrypt it at rest.
  if (refreshedToken) {
    await scoped.saveChannelToken(
      profile.id,
      refreshedToken,
      data.connections?.youtube_analytics?.channel_id,
    );
  }
  if (!Array.isArray(result)) {
    throw new UpstreamError("Analytics fetch returned an unexpected shape");
  }
  const rows = result as PerformanceRow[];

  // Attach pre-production alignment scores by matching video titles against the
  // no-repeat idea memory (this is what lets the loop check its own predictions).
  const memory = await scoped.listIdeaMemory(profile.id);
  const memoryByTitle = new Map(
    memory.map((m) => [norm((m as any).title ?? ""), (m as any).alignment_score]),
  );
  for (const row of rows) {
    const score = memoryByTitle.get(norm(row.video));
    if (score != null) (row as any).source_idea_alignment_score = score;
  }

  // Pull any retention findings on file for the learnings prompt.
  const retentionReports = await scoped.listProfileReports(profile.id, "retention");
  const retentionFindings: string[] = [];
  for (const r of retentionReports.slice(0, 5)) {
    const full = await scoped.getReport(r.id);
    const rules = (full.payload as any)?.analysis?.next_video_rules as string[] | undefined;
    if (rules) retentionFindings.push(...rules);
  }

  const existingLearnings: string[] = Array.isArray(data.learnings) ? data.learnings : [];
  const rendered = await renderPromptFile(promptsDir(), "06_performance_learnings.opus", {
    ...data,
    channel_name: data.channel_name,
    performance_rows: formatPerformanceRows(rows),
    retention_findings: retentionFindings.length ? retentionFindings : "(none on file)",
    existing_learnings: existingLearnings.length ? existingLearnings : "(none yet)",
    performance_learnings: existingLearnings.length ? existingLearnings : "(none yet)",
  });
  const response = await getReasoningAdapter().complete({
    system: rendered.system,
    user: rendered.user,
  });
  const parsed = extractJsonObject<PerformanceLearnings>(response, "Performance learnings");
  const learnings = Array.isArray(parsed.learnings) ? parsed.learnings : existingLearnings;

  // The learnings array REPLACES profile.learnings (prompt 06 folds in the old).
  data.learnings = learnings;
  data.updated_at = new Date().toISOString();
  await scoped.updateProfile(profile.id, { data });

  const report = await scoped.createReport(profile.id, "performance", {
    rows,
    calibration: parsed.calibration,
    working: parsed.working,
    not_working: parsed.not_working,
    learnings,
    meta: { video_count: rows.length, synced_at: new Date().toISOString() },
  });
  await scoped.recordUsage("performance", profile.id, { video_count: rows.length });

  return {
    reportId: report.id,
    rows,
    learnings,
    calibration: parsed.calibration,
  };
}
