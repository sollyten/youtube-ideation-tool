/**
 * Shared "raw ideas → scored, de-duplicated, remembered, saved" tail.
 *
 * Both ideation modes end the same way (SPEC §3 steps 4-7 and §4 step 4:
 * recombination results are "scored/saved/memory-logged like a normal ideation
 * run"). The generation step differs — Perplexity web search (prompt 01) vs.
 * Opus recombination (prompt 04) — but everything after is identical:
 *
 *   dedupe.py backstop → prompt 02 scoring → dedupe.py again → append to the
 *   no-repeat memory → save an "ideas" report → record usage.
 */
import path from "node:path";
import { config } from "../config/env.js";
import type { ProfileRecord, ScopedData } from "../data/scoped.js";
import { UpstreamError } from "../errors.js";
import { renderPromptFile, type PromptContext } from "../prompts/templateEngine.js";
import { getReasoningAdapter } from "../reasoning/adapter.js";
import { extractJsonArray } from "./json.js";
import { getScriptRunner } from "./scripts.js";

export interface ScoredIdea {
  title: string;
  premise: string;
  alignment_score: number;
  subscores: Record<string, number>;
  why_it_fits: string;
  why_now: string;
  recommended_format_angle: string;
}

export interface ScoreAndSaveResult {
  reportId: string;
  ideas: ScoredIdea[];
  meta: Record<string, unknown>;
}

function promptsDir(): string {
  return path.join(config.repoRoot, "prompts");
}

export function formatMemoryTitles(memory: Array<Record<string, unknown>>): string {
  if (memory.length === 0) return "(no previously generated ideas yet)";
  return memory.map((idea) => `- ${(idea as any).title ?? JSON.stringify(idea)}`).join("\n");
}

/**
 * Score raw candidate ideas against the profile (prompt 02), de-dup against the
 * channel's memory on both sides of scoring, append the selection to memory,
 * and persist an "ideas" report.
 *
 * `extraReportPayload` lets a caller (e.g. recombination) attach provenance
 * (source banks, generation mode) to the saved report; `metaBase` seeds the run
 * metadata that the shared tail augments.
 */
export async function scoreAndSaveIdeas(
  scoped: ScopedData,
  profile: ProfileRecord,
  rawIdeas: Array<Record<string, unknown>>,
  options: {
    usageAction: string;
    metaBase?: Record<string, unknown>;
    extraReportPayload?: Record<string, unknown>;
  },
): Promise<ScoreAndSaveResult> {
  const scripts = getScriptRunner();
  const data = profile.data as Record<string, any>;
  const memory = await scoped.listIdeaMemory(profile.id);

  // 1. Fuzzy no-repeat backstop before scoring.
  const deduped = await scripts.dedupeCandidates(memory, rawIdeas);

  // 2. Scoring & selection (prompt 02) through the reasoning adapter.
  const promptContext: PromptContext = {
    ...data,
    profile_json: data,
    candidate_ideas_json: JSON.stringify(deduped.unique, null, 2),
    previously_generated_ideas: formatMemoryTitles(memory),
    format_style: data.format_style,
    idea_count: rawIdeas.length,
  };
  const scoring = await renderPromptFile(promptsDir(), "02_idea_scoring.opus", promptContext);
  const scoringResponse = await getReasoningAdapter().complete({
    system: scoring.system,
    user: scoring.user,
  });
  const selectedRaw = extractJsonArray<ScoredIdea>(scoringResponse, "Idea scoring");
  if (selectedRaw.length === 0) {
    throw new UpstreamError("Scoring returned zero ideas — not saving an empty run");
  }

  // 3. Backstop the selection itself against memory once more before saving.
  const finalCheck = await scripts.dedupeCandidates(
    memory,
    selectedRaw as unknown as Array<Record<string, unknown>>,
  );
  const selected = finalCheck.unique as unknown as ScoredIdea[];

  // The scorer's plain-text drop note (after the JSON) is kept for the report.
  const jsonEnd = scoringResponse.lastIndexOf("]");
  const dropNote = jsonEnd >= 0 ? scoringResponse.slice(jsonEnd + 1).trim() : "";

  // 4. Memory append — every selected idea is remembered forever.
  await scoped.appendIdeaMemory(
    profile.id,
    selected.map((idea) => ({
      title: idea.title,
      premise: idea.premise,
      alignment_score: idea.alignment_score,
      generated_at: new Date().toISOString(),
    })),
  );

  // 5. Save the run and record usage.
  const meta = {
    ...(options.metaBase ?? {}),
    raw_candidate_count: rawIdeas.length,
    unique_candidate_count: deduped.unique.length,
    duplicates_dropped_pre_scoring: deduped.duplicates.length,
    duplicates_dropped_post_scoring: finalCheck.duplicates.length,
  };
  const report = await scoped.createReport(profile.id, "ideas", {
    ideas: selected,
    drop_note: dropNote,
    ...(options.extraReportPayload ?? {}),
    meta,
  });
  await scoped.recordUsage(options.usageAction, profile.id, {
    ideas_selected: selected.length,
  });

  return { reportId: report.id, ideas: selected, meta };
}
