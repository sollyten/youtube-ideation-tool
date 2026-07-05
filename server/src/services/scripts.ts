/**
 * Runner for the deterministic Python scripts in scripts/. All arithmetic and
 * data fetching happens in these scripts (SPEC: determinism first) — the
 * backend shells out and consumes their JSON.
 *
 * Company keys are injected per script, from the credentials service, and only
 * the key that script needs. Nothing else from the server environment's
 * secrets is forwarded.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config/env.js";
import { getCompanyKey } from "../credentials/companyCredentials.js";
import { UpstreamError } from "../errors.js";
import { sonarChat, agentRun, type SonarModel } from "./perplexity.js";

const SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;

export interface ChannelData {
  channel_title: string;
  channel_id: string;
  subscriber_count: number;
  view_count: number;
  video_count: number;
  recent_videos: Array<{
    video_id?: string;
    url?: string;
    title: string;
    published_at: string;
    view_count: number;
  }>;
}

export interface Outlier {
  title: string;
  view_count: number;
  multiplier: number;
  published_at: string;
  video_id?: string;
  url?: string;
}

export interface OutlierResult {
  baseline: number;
  baseline_method: string;
  multiplier_threshold: number;
  mature_video_count: number;
  outliers: Outlier[];
  warning?: string;
}

export interface DedupeResult {
  unique: Array<Record<string, unknown>>;
  duplicates: Array<{ title: string; matched: string; score: number }>;
}

function runPython(
  scriptName: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const scriptPath = path.join(config.repoRoot, "scripts", scriptName);
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [scriptPath, ...args],
      {
        cwd: config.repoRoot,
        timeout: SCRIPT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        // Deliberately minimal env: PATH for the interpreter plus exactly the
        // key(s) this script needs.
        env: { PATH: process.env.PATH ?? "", ...extraEnv },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new UpstreamError(`${scriptName} failed: ${stderr.trim() || error.message}`));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

function parseJson<T>(scriptName: string, output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new UpstreamError(`${scriptName} produced non-JSON output`);
  }
}

/** Public channel stats + last 50 videos. Works for any channel incl. competitors. */
export async function fetchChannelData(channelUrlOrHandle: string): Promise<ChannelData> {
  const out = await runPython("fetch_channel_data.py", [channelUrlOrHandle], {
    YOUTUBE_API_KEY: getCompanyKey("youtube"),
  });
  return parseJson<ChannelData>("fetch_channel_data.py", out);
}

/** Deterministic outlier detection over a fetched channel-data payload. */
export async function detectOutliers(channelData: ChannelData): Promise<OutlierResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "outliers-"));
  try {
    const dataFile = path.join(dir, "channel.json");
    await writeFile(dataFile, JSON.stringify(channelData));
    const out = await runPython("outlier_detect.py", [dataFile]);
    return parseJson<OutlierResult>("outlier_detect.py", out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Fuzzy no-repeat backstop. `memoryIdeas` come from the user-scoped
 * idea_memory table; written to a temp jsonl to match the script's contract.
 */
export async function dedupeCandidates(
  memoryIdeas: Array<Record<string, unknown>>,
  candidates: Array<Record<string, unknown>>,
): Promise<DedupeResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "dedupe-"));
  try {
    const memoryFile = path.join(dir, "memory.jsonl");
    const candidatesFile = path.join(dir, "candidates.json");
    await writeFile(memoryFile, memoryIdeas.map((idea) => JSON.stringify(idea)).join("\n"));
    await writeFile(candidatesFile, JSON.stringify(candidates));
    const out = await runPython("dedupe.py", [memoryFile, candidatesFile]);
    return parseJson<DedupeResult>("dedupe.py", out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Perplexity research routing. Idea Generation (prompt 01) uses the Sonar API
 * with a selectable model; Deep Competitor Analysis (prompt 03) uses the Agent
 * API. Returns the response text (citations appended when present). This is the
 * seam both pipelines call (and that tests stub); the HTTP details live in
 * services/perplexity.ts.
 */
export type PerplexityMode =
  | { api: "sonar"; model: SonarModel }
  | { api: "agent" };

export async function perplexityResearch(
  prompt: string,
  mode: PerplexityMode = { api: "sonar", model: "sonar-pro" },
): Promise<string> {
  if (mode.api === "agent") return agentRun(prompt);
  return sonarChat(prompt, mode.model);
}

export interface PerformanceRow {
  video: string;
  views?: number;
  averageViewPercentage?: number;
  averageViewDuration?: number;
  estimatedMinutesWatched?: number;
  subscribersGained?: number;
  performance_rank?: string;
}

export interface RetentionPoint {
  elapsedVideoTimeRatio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance?: number;
}

/**
 * OWNER-only analytics via per-profile OAuth (fetch_analytics.py). This is
 * SECURITY-CRITICAL and differs from every other script runner:
 *
 *   - It uses the caller's decrypted OAuth token, NOT a company key.
 *   - The token is written to a fresh per-run temp dir, passed as the script's
 *     user-scoped --token-dir, and the dir is wiped in a finally — no shared
 *     path, no persisted plaintext.
 *   - If the script refreshed the access token, we hand it back so the caller
 *     can re-encrypt it.
 */
export async function fetchAnalytics(
  slug: string,
  tokenJson: string,
  options: { recent?: number; video?: string; retention?: boolean },
): Promise<{ result: unknown; refreshedToken?: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "yt-oauth-"));
  const tokenPath = path.join(dir, `${slug}.token.json`);
  try {
    await writeFile(tokenPath, tokenJson, { mode: 0o600 });
    const args = [slug, "--token-dir", dir];
    if (options.retention && options.video) {
      args.push("--video", options.video, "--retention");
    } else {
      args.push("--recent", String(options.recent ?? 10));
    }
    const out = await runPython("fetch_analytics.py", args);
    const result = parseJson<unknown>("fetch_analytics.py", out);
    // The script rewrites the token file after a refresh; capture any change.
    let refreshedToken: string | undefined;
    try {
      const after = await readFile(tokenPath, "utf8");
      if (after && after !== tokenJson) refreshedToken = after;
    } catch {
      /* token file may be gone; ignore */
    }
    return { result, refreshedToken };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Test hook: swap script implementations without touching the network. */
export interface ScriptRunner {
  fetchChannelData: typeof fetchChannelData;
  detectOutliers: typeof detectOutliers;
  dedupeCandidates: typeof dedupeCandidates;
  perplexityResearch: typeof perplexityResearch;
  fetchAnalytics: typeof fetchAnalytics;
}

let runner: ScriptRunner = {
  fetchChannelData,
  detectOutliers,
  dedupeCandidates,
  perplexityResearch,
  fetchAnalytics,
};

export function getScriptRunner(): ScriptRunner {
  return runner;
}

export function setScriptRunner(next: Partial<ScriptRunner>): void {
  runner = { ...runner, ...next };
}
