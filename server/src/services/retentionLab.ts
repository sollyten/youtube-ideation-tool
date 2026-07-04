/**
 * Retention Lab (SPEC §4c). Second-by-second retention analysis for an owned
 * video, reasoning from knowledge/retention_analysis.md as the primary
 * authority (prompt 05).
 *
 * Two input paths:
 *   - API path: fetch_analytics.py --retention pulls the audienceRetention
 *     report (per-user OAuth). Higher fidelity.
 *   - Image path: the user uploads a screenshot of the retention graph; the
 *     analyzer reads the curve visually (timestamps approximate).
 *
 * next_video_rules are saved on the report and feed the same learning loop the
 * Performance Tracker distils.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { BadRequestError, UpstreamError } from "../errors.js";
import { renderPromptFile } from "../prompts/templateEngine.js";
import { getReasoningAdapter, type ReasoningImage } from "../reasoning/adapter.js";
import { extractJsonObject } from "./json.js";
import { assertQuota } from "./quota.js";
import { getScriptRunner, type RetentionPoint } from "./scripts.js";
import { isConnected } from "./performance.js";

function promptsDir(): string {
  return path.join(config.repoRoot, "prompts");
}

let cachedKnowledge: string | undefined;
async function retentionKnowledge(): Promise<string> {
  if (cachedKnowledge === undefined) {
    cachedKnowledge = await readFile(
      path.join(config.repoRoot, "knowledge", "retention_analysis.md"),
      "utf8",
    );
  }
  return cachedKnowledge;
}

export interface RetentionAnalysis {
  overall: { chart_type: string; journey_pattern: string; top_level_fix: string };
  sections: Array<{
    timespan: string;
    curve_behaviour: string;
    pattern: string;
    likely_cause: string;
    note_type: string;
    fix: string;
  }>;
  top_fixes: string[];
  next_video_rules: string[];
}

export interface RetentionRunResult {
  reportId: string;
  analysis: RetentionAnalysis;
  summary: string;
}

export interface RetentionInput {
  videoTitle: string;
  videoLength?: string;
  /** API path: an owned video id (requires the profile to be connected). */
  videoId?: string;
  /** Image path: a base64 screenshot of the retention graph. */
  image?: ReasoningImage;
}

function formatRetentionPoints(points: RetentionPoint[]): string {
  const lines = points.map((p) => {
    const rel = p.relativeRetentionPerformance != null ? ` | rel: ${p.relativeRetentionPerformance}` : "";
    return `elapsed ${p.elapsedVideoTimeRatio} | watchRatio ${p.audienceWatchRatio}${rel}`;
  });
  return `Structured audienceRetention report (elapsedVideoTimeRatio, audienceWatchRatio${
    points[0]?.relativeRetentionPerformance != null ? ", relativeRetentionPerformance" : ""
  }):\n${lines.join("\n")}`;
}

export async function runRetentionLab(
  scoped: ScopedData,
  profile: ProfileRecord,
  input: RetentionInput,
): Promise<RetentionRunResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Retention analysis can only be run on your own profiles");
  }
  if (!input.videoId && !input.image) {
    throw new BadRequestError("Provide either a video id (API path) or a retention screenshot");
  }
  await assertQuota(scoped, "retention");
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;

  let retentionDataText: string;
  let images: ReasoningImage[] | undefined;

  if (input.videoId) {
    // API path — requires this profile's own analytics authorization.
    if (!isConnected(profile)) {
      throw new BadRequestError(
        "The API retention path needs YouTube analytics connected. Use the screenshot path otherwise.",
      );
    }
    const token = await scoped.getChannelToken(profile.id);
    if (!token) throw new BadRequestError("No stored authorization for this channel — reconnect it");
    const { result, refreshedToken } = await scripts.fetchAnalytics(data.slug ?? profile.slug, token, {
      video: input.videoId,
      retention: true,
    });
    if (refreshedToken) {
      await scoped.saveChannelToken(
        profile.id,
        refreshedToken,
        data.connections?.youtube_analytics?.channel_id,
      );
    }
    if (!Array.isArray(result) || result.length === 0) {
      throw new UpstreamError("Retention fetch returned no data for that video");
    }
    retentionDataText = formatRetentionPoints(result as RetentionPoint[]);
  } else {
    retentionDataText =
      "(A screenshot of the retention graph is attached. Read the curve visually; " +
      "state where timestamps are approximate.)";
    images = input.image ? [input.image] : undefined;
  }

  const rendered = await renderPromptFile(promptsDir(), "05_retention_lab.opus", {
    ...data,
    channel_name: data.channel_name,
    retention_analysis_knowledge_base: await retentionKnowledge(),
    video_title: input.videoTitle,
    video_length: input.videoLength ?? "(unknown)",
    typical_retention_note:
      Array.isArray(data.learnings) && data.learnings.length ? data.learnings : "(not established yet)",
    retention_data_or_image: retentionDataText,
  });
  const response = await getReasoningAdapter().complete({
    system: rendered.system,
    user: rendered.user,
    images,
  });
  const analysis = extractJsonObject<RetentionAnalysis>(response, "Retention analysis");
  if (!analysis.overall || !Array.isArray(analysis.next_video_rules)) {
    throw new UpstreamError("Retention analysis returned an incomplete result");
  }
  const jsonEnd = response.lastIndexOf("}");
  const summary = jsonEnd >= 0 ? response.slice(jsonEnd + 1).trim() : "";

  const report = await scoped.createReport(profile.id, "retention", {
    analysis,
    summary,
    video: { title: input.videoTitle, id: input.videoId ?? null, length: input.videoLength ?? null },
    source: input.videoId ? "api" : "image",
    meta: { synced_at: new Date().toISOString() },
  });
  await scoped.recordUsage("retention", profile.id, { path: input.videoId ? "api" : "image" });

  return { reportId: report.id, analysis, summary };
}
