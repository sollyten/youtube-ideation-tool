/**
 * Deep Competitor Analysis (SPEC §4) and the recombination ideator.
 *
 * Analysis:
 *   1. for each competitor: fetch + deterministic outlier detection (with URLs)
 *   2. prompts/03_competitor_deep_analysis.perplexity.md → Perplexity deep
 *      research → per-outlier breakdown + topic_bank + format_bank
 *   3. save a "competitor" report
 *
 * Recombination ("Generate ideas from these outliers"):
 *   feeds topic_bank + format_bank into prompt 04 (Opus) → raw ideas → the
 *   shared scoring tail (scored/saved/memory-logged like a normal ideation run).
 */
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { BadRequestError, NotFoundError, UpstreamError } from "../errors.js";
import { renderPromptFile, type PromptContext } from "../prompts/templateEngine.js";
import { extractJsonArray, extractJsonObject } from "./json.js";
import { assertQuota } from "./quota.js";
import { getScriptRunner, type Outlier } from "./scripts.js";
import { formatMemoryTitles, scoreAndSaveIdeas, type ScoreAndSaveResult } from "./ideaScoring.js";

function promptsDir(): string {
  return path.join(config.repoRoot, "prompts");
}

interface OutlierBreakdown {
  channel: string;
  title: string;
  url: string;
  view_count: number;
  multiplier: number;
  thumbnail: string;
  topic: string;
  format: string;
  why_it_overperformed: string;
  transcript_accessed: boolean;
}

export interface CompetitorAnalysis {
  outlier_breakdowns: OutlierBreakdown[];
  topic_bank: string[];
  format_bank: string[];
  cross_channel_notes: string;
}

export interface CompetitorRunResult {
  reportId: string;
  analysis: CompetitorAnalysis;
  meta: Record<string, unknown>;
}

function formatCompetitorOutliersWithUrls(
  rows: Array<{ channel: string; outliers: Outlier[] }>,
): string {
  const lines = rows.flatMap((row) =>
    row.outliers.map(
      (o) =>
        `${row.channel} | ${o.title} | ${o.view_count} views | ${o.multiplier}x | ${
          o.url ?? "(url unavailable)"
        }`,
    ),
  );
  return lines.length ? lines.join("\n") : "(no competitor outliers above threshold)";
}

export async function runCompetitorAnalysis(
  scoped: ScopedData,
  profile: ProfileRecord,
): Promise<CompetitorRunResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Competitor analysis can only be run on your own profiles");
  }
  await assertQuota(scoped, "competitor_analysis");
  const startedAt = Date.now();
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;
  const competitors: Array<{ name: string; url: string; channel_id: string }> =
    data.competitors ?? [];
  if (competitors.length === 0) {
    throw new BadRequestError("Add at least one competitor to the profile first");
  }

  const fetchErrors: string[] = [];
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
  ).filter((r): r is { channel: string; outliers: Outlier[] } => r !== undefined);

  const totalOutliers = competitorOutliers.reduce((n, r) => n + r.outliers.length, 0);
  if (totalOutliers === 0) {
    throw new UpstreamError(
      "No competitor outliers found to analyze" +
        (fetchErrors.length ? ` (${fetchErrors.join("; ")})` : ""),
    );
  }

  // Deep research via Perplexity (prompt 03).
  const rendered = await renderPromptFile(promptsDir(), "03_competitor_deep_analysis.perplexity", {
    ...data,
    competitor_outliers_with_urls: formatCompetitorOutliersWithUrls(competitorOutliers),
  } satisfies PromptContext);
  const prompt = rendered.system ? `${rendered.system}\n\n---\n\n${rendered.user}` : rendered.user;
  const response = await scripts.perplexityResearch(prompt);
  const analysis = extractJsonObject<CompetitorAnalysis>(response, "Competitor deep analysis");
  if (!Array.isArray(analysis.outlier_breakdowns) || !Array.isArray(analysis.topic_bank)) {
    throw new UpstreamError("Competitor analysis returned an incomplete result");
  }

  const meta = {
    competitor_channels_analyzed: competitorOutliers.length,
    outliers_analyzed: totalOutliers,
    topic_bank_size: analysis.topic_bank.length,
    format_bank_size: (analysis.format_bank ?? []).length,
    fetch_errors: fetchErrors,
    duration_ms: Date.now() - startedAt,
  };
  const report = await scoped.createReport(profile.id, "competitor", {
    analysis,
    competitor_outliers: competitorOutliers,
    meta,
  });
  await scoped.recordUsage("competitor_analysis", profile.id, {
    duration_ms: meta.duration_ms,
    outliers_analyzed: totalOutliers,
  });

  return { reportId: report.id, analysis, meta };
}

/**
 * Recombination ideator: takes the topic_bank + format_bank from a saved
 * competitor report and manufactures original ideas via prompt 04, then runs
 * the shared scoring tail. Counts against the ideation quota (it produces
 * ideas) rather than the competitor quota.
 */
export async function runRecombination(
  scoped: ScopedData,
  profile: ProfileRecord,
  competitorReportId: string,
): Promise<ScoreAndSaveResult> {
  if (profile.readOnly) {
    throw new BadRequestError("Recombination can only be run on your own profiles");
  }
  await assertQuota(scoped, "ideation");
  const report = await scoped.getReport(competitorReportId);
  if (report.type !== "competitor" || report.profileId !== profile.id) {
    throw new NotFoundError("Competitor report not found for this profile");
  }
  const analysis = (report.payload as any).analysis as CompetitorAnalysis | undefined;
  if (!analysis?.topic_bank?.length && !analysis?.format_bank?.length) {
    throw new BadRequestError("That competitor report has no topic or format bank to recombine");
  }
  const data = profile.data as Record<string, any>;
  const memory = await scoped.listIdeaMemory(profile.id);

  const rendered = await renderPromptFile(promptsDir(), "04_format_topic_recombination.opus", {
    ...data,
    format_bank: analysis.format_bank ?? [],
    topic_bank: analysis.topic_bank ?? [],
    previously_generated_ideas: formatMemoryTitles(memory),
  } satisfies PromptContext);
  const { getReasoningAdapter } = await import("../reasoning/adapter.js");
  const response = await getReasoningAdapter().complete({
    system: rendered.system,
    user: rendered.user,
  });
  const rawIdeas = extractJsonArray(response, "Recombination ideation");
  if (rawIdeas.length === 0) {
    throw new UpstreamError("Recombination returned zero ideas — not saving an empty run");
  }

  return scoreAndSaveIdeas(scoped, profile, rawIdeas, {
    usageAction: "ideation",
    metaBase: {
      source: "recombination",
      from_competitor_report: competitorReportId,
      topic_bank_size: (analysis.topic_bank ?? []).length,
      format_bank_size: (analysis.format_bank ?? []).length,
    },
  });
}
