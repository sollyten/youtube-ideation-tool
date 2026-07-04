/**
 * Idea Generation pipeline (SPEC §3) — the Phase-1 vertical slice.
 *
 *   1. refresh channel data + deterministic outlier detection
 *   2. same for every competitor
 *   3. prompts/01_idea_generation.perplexity.md → Perplexity → 50-100 raw ideas
 *   4. code-side fuzzy dedupe (scripts/dedupe.py) against the memory store
 *   5. prompts/02_idea_scoring.opus.md → reasoning adapter → scored top 15
 *   6. append the selected ideas to idea_memory (the no-repeat store)
 *   7. save the run as a report (History reads these)
 *
 * All data flows through the caller's user-scoped data layer; fetch failures
 * are surfaced, never papered over.
 */
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { BadRequestError, UpstreamError } from "../errors.js";
import { renderPromptFile, type PromptContext } from "../prompts/templateEngine.js";
import { getReasoningAdapter } from "../reasoning/adapter.js";
import { extractJsonArray } from "./json.js";
import { assertQuota } from "./quota.js";
import { getScriptRunner, type OutlierResult } from "./scripts.js";

export interface ScoredIdea {
  title: string;
  premise: string;
  alignment_score: number;
  subscores: Record<string, number>;
  why_it_fits: string;
  why_now: string;
  recommended_format_angle: string;
}

export interface IdeationRunResult {
  reportId: string;
  ideas: ScoredIdea[];
  meta: Record<string, unknown>;
}

function promptsDir(): string {
  return path.join(config.repoRoot, "prompts");
}

function formatOutliers(outliers: OutlierResult["outliers"]): string {
  if (outliers.length === 0) return "(no outliers above threshold)";
  return outliers.map((o) => `${o.title} | ${o.multiplier}x`).join("\n");
}

function formatCompetitorOutliers(
  rows: Array<{ channel: string; outliers: OutlierResult["outliers"] }>,
): string {
  const lines = rows.flatMap((row) =>
    row.outliers.map((o) => `${row.channel} | ${o.title} | ${o.multiplier}x`),
  );
  return lines.length ? lines.join("\n") : "(no competitor outliers above threshold)";
}

function formatResources(profileData: Record<string, any>): string {
  const resources: Array<{ label: string; content: string }> = profileData.resources ?? [];
  if (resources.length === 0) return "(none provided)";
  return resources.map((r) => `### ${r.label}\n${r.content}`).join("\n\n");
}

function formatMemoryTitles(memory: Array<Record<string, unknown>>): string {
  if (memory.length === 0) return "(no previously generated ideas yet)";
  return memory.map((idea) => `- ${(idea as any).title ?? JSON.stringify(idea)}`).join("\n");
}

export async function runIdeation(
  scoped: ScopedData,
  profile: ProfileRecord,
  options: { ideaCount?: number } = {},
): Promise<IdeationRunResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Idea generation can only be run on your own profiles");
  }
  await assertQuota(scoped, "ideation");
  const startedAt = Date.now();
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;
  const ideaCount = Math.min(100, Math.max(50, options.ideaCount ?? 60));
  const fetchErrors: string[] = [];

  // 1. Refresh own channel + outliers (deterministic).
  const channel = await scripts.fetchChannelData(data.channel_url);
  const myOutliers = await scripts.detectOutliers(channel);

  // Keep the profile's stats snapshot current.
  data.stats = {
    subscriber_count: channel.subscriber_count,
    view_count: channel.view_count,
    video_count: channel.video_count,
    median_views: myOutliers.baseline,
    snapshot_date: new Date().toISOString(),
  };
  await scoped.updateProfile(profile.id, { data });

  // 2. Competitor outliers. Individual failures are surfaced, not fabricated.
  const competitors: Array<{ name: string; url: string; channel_id: string }> =
    data.competitors ?? [];
  const competitorOutliers = (
    await Promise.all(
      competitors.map(async (c) => {
        try {
          const cd = await scripts.fetchChannelData(c.channel_id || c.url);
          const outliers = await scripts.detectOutliers(cd);
          return { channel: cd.channel_title, outliers: outliers.outliers };
        } catch (err) {
          fetchErrors.push(`Competitor "${c.name}": ${(err as Error).message}`);
          return undefined;
        }
      }),
    )
  ).filter((r): r is { channel: string; outliers: OutlierResult["outliers"] } => r !== undefined);

  // 3. Idea generation via Perplexity (prompt 01). Both prompts receive the
  //    full memory so nothing is proposed twice.
  const memory = await scoped.listIdeaMemory(profile.id);
  const memoryTitles = formatMemoryTitles(memory);
  const promptContext: PromptContext = {
    ...data,
    channel_name: data.channel_name,
    idea_count: ideaCount,
    my_outliers: formatOutliers(myOutliers.outliers),
    competitor_outliers: formatCompetitorOutliers(competitorOutliers),
    resources_concatenated: formatResources(data),
    performance_learnings:
      Array.isArray(data.learnings) && data.learnings.length > 0
        ? data.learnings
        : "(no performance learnings recorded yet)",
    previously_generated_ideas: memoryTitles,
    recent_topics: data.recent_topics ?? [],
  };
  const generation = await renderPromptFile(promptsDir(), "01_idea_generation.perplexity", promptContext);
  const generationPrompt = generation.system
    ? `${generation.system}\n\n---\n\n${generation.user}`
    : generation.user;
  const rawResponse = await scripts.perplexityResearch(generationPrompt);
  const rawIdeas = extractJsonArray(rawResponse, "Perplexity idea generation");
  if (rawIdeas.length === 0) {
    throw new UpstreamError("Perplexity returned zero usable ideas — not saving an empty run");
  }

  // 4. Code-side fuzzy no-repeat backstop before scoring.
  const deduped = await scripts.dedupeCandidates(memory, rawIdeas);

  // 5. Scoring & selection (prompt 02) through the reasoning adapter.
  const scoring = await renderPromptFile(promptsDir(), "02_idea_scoring.opus", {
    ...promptContext,
    profile_json: data,
    candidate_ideas_json: JSON.stringify(deduped.unique, null, 2),
  });
  const scoringResponse = await getReasoningAdapter().complete({
    system: scoring.system,
    user: scoring.user,
  });
  const selectedRaw = extractJsonArray<ScoredIdea>(scoringResponse, "Idea scoring");

  // Backstop the selection itself against memory once more before saving.
  const finalCheck = await scripts.dedupeCandidates(
    memory,
    selectedRaw as unknown as Array<Record<string, unknown>>,
  );
  const selected = finalCheck.unique as unknown as ScoredIdea[];

  // The scorer's plain-text drop note (after the JSON) is kept for the report.
  const jsonEnd = scoringResponse.lastIndexOf("]");
  const dropNote = jsonEnd >= 0 ? scoringResponse.slice(jsonEnd + 1).trim() : "";

  // 6. Memory append — every selected idea is remembered forever.
  await scoped.appendIdeaMemory(
    profile.id,
    selected.map((idea) => ({
      title: idea.title,
      premise: idea.premise,
      alignment_score: idea.alignment_score,
      generated_at: new Date().toISOString(),
    })),
  );

  // 7. Save the run. History and the UI read this report.
  const meta = {
    idea_count_requested: ideaCount,
    raw_candidate_count: rawIdeas.length,
    unique_candidate_count: deduped.unique.length,
    duplicates_dropped_pre_scoring: deduped.duplicates.length,
    duplicates_dropped_post_scoring: finalCheck.duplicates.length,
    baseline: myOutliers.baseline,
    my_outlier_count: myOutliers.outliers.length,
    competitor_channels_analyzed: competitorOutliers.length,
    fetch_errors: fetchErrors,
    duration_ms: Date.now() - startedAt,
  };
  const report = await scoped.createReport(profile.id, "ideas", {
    ideas: selected,
    drop_note: dropNote,
    my_outliers: myOutliers.outliers,
    competitor_outliers: competitorOutliers,
    meta,
  });
  await scoped.recordUsage("ideation", profile.id, {
    duration_ms: meta.duration_ms,
    ideas_selected: selected.length,
  });

  return { reportId: report.id, ideas: selected, meta };
}
