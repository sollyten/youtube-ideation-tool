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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config/env.js";
import { getCompanyKey } from "../credentials/companyCredentials.js";
import { UpstreamError } from "../errors.js";

const SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;

export interface ChannelData {
  channel_title: string;
  channel_id: string;
  subscriber_count: number;
  view_count: number;
  video_count: number;
  recent_videos: Array<{ title: string; published_at: string; view_count: number }>;
}

export interface OutlierResult {
  baseline: number;
  baseline_method: string;
  multiplier_threshold: number;
  mature_video_count: number;
  outliers: Array<{ title: string; view_count: number; multiplier: number; published_at: string }>;
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
 * Research call via scripts/perplexity_research.py (company key). Returns the
 * response text (citations appended by the script when present).
 */
export async function perplexityResearch(prompt: string): Promise<string> {
  return runPython("perplexity_research.py", [prompt], {
    PERPLEXITY_API_KEY: getCompanyKey("perplexity"),
  });
}

/** Test hook: swap script implementations without touching the network. */
export interface ScriptRunner {
  fetchChannelData: typeof fetchChannelData;
  detectOutliers: typeof detectOutliers;
  dedupeCandidates: typeof dedupeCandidates;
  perplexityResearch: typeof perplexityResearch;
}

let runner: ScriptRunner = { fetchChannelData, detectOutliers, dedupeCandidates, perplexityResearch };

export function getScriptRunner(): ScriptRunner {
  return runner;
}

export function setScriptRunner(next: Partial<ScriptRunner>): void {
  runner = { ...runner, ...next };
}
