/**
 * Idea Generation pipeline (SPEC §3).
 *
 *   1. refresh channel data + deterministic outlier detection
 *   2. same for every competitor
 *   3. prompts/01_idea_generation.perplexity.md → Perplexity → 50-100 raw ideas
 *   4-7. the shared scoring tail (services/ideaScoring.ts): dedupe → prompt 02
 *        scoring → dedupe → memory append → report save
 *
 * All data flows through the caller's user-scoped data layer; fetch failures
 * are surfaced, never papered over.
 */
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { BadRequestError, UpstreamError } from "../errors.js";
import { renderPromptFile, type PromptContext } from "../prompts/templateEngine.js";
import { extractJsonArray } from "./json.js";
import { assertQuota } from "./quota.js";
import { getScriptRunner, type OutlierResult } from "./scripts.js";
import type { SonarModel } from "./perplexity.js";
import {
  formatDirectorFeedback,
  formatMemoryTitles,
  scoreAndSaveIdeas,
  type ScoreAndSaveResult,
} from "./ideaScoring.js";

export type { ScoredIdea } from "./ideaScoring.js";
export type IdeationRunResult = ScoreAndSaveResult;

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

export async function runIdeation(
  scoped: ScopedData,
  profile: ProfileRecord,
  options: { ideaCount?: number; sonarModel?: SonarModel } = {},
): Promise<IdeationRunResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Idea generation can only be run on your own profiles");
  }
  await assertQuota(scoped, "ideation");
  const startedAt = Date.now();
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;
  const ideaCount = Math.min(100, Math.max(50, options.ideaCount ?? 60));
  // Idea generation uses the Sonar API; the run picks the model (or the config
  // default), so sonar-pro (fast) and sonar-deep-research (deep) are both usable.
  const sonarModel: SonarModel =
    options.sonarModel ?? (config.perplexity.ideationModel as SonarModel);
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
  const feedback = await scoped.listRecentIdeaFeedback(profile.id);
  const promptContext: PromptContext = {
    ...data,
    channel_name: data.channel_name,
    idea_count: ideaCount,
    director_feedback: formatDirectorFeedback(feedback),
    my_outliers: formatOutliers(myOutliers.outliers),
    competitor_outliers: formatCompetitorOutliers(competitorOutliers),
    resources_concatenated: formatResources(data),
    performance_learnings:
      Array.isArray(data.learnings) && data.learnings.length > 0
        ? data.learnings
        : "(no performance learnings recorded yet)",
    previously_generated_ideas: formatMemoryTitles(memory),
    recent_topics: data.recent_topics ?? [],
  };
  const generation = await renderPromptFile(promptsDir(), "01_idea_generation.perplexity", promptContext);
  const generationPrompt = generation.system
    ? `${generation.system}\n\n---\n\n${generation.user}`
    : generation.user;
  const rawResponse = await scripts.perplexityResearch(generationPrompt, { api: "sonar", model: sonarModel });
  const rawIdeas = extractJsonArray(rawResponse, "Perplexity idea generation");
  if (rawIdeas.length === 0) {
    throw new UpstreamError("Perplexity returned zero usable ideas — not saving an empty run");
  }

  // 4-7. Shared scoring tail: dedupe → score → dedupe → memory → report.
  return scoreAndSaveIdeas(scoped, profile, rawIdeas, {
    usageAction: "ideation",
    metaBase: {
      source: "ideation",
      sonar_model: sonarModel,
      idea_count_requested: ideaCount,
      baseline: myOutliers.baseline,
      my_outlier_count: myOutliers.outliers.length,
      competitor_channels_analyzed: competitorOutliers.length,
      fetch_errors: fetchErrors,
      duration_ms: Date.now() - startedAt,
    },
    extraReportPayload: {
      my_outliers: myOutliers.outliers,
      competitor_outliers: competitorOutliers,
    },
  });
}
