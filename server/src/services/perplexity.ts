/**
 * Perplexity research service — two products behind one company key:
 *
 *   - Sonar API (POST /chat/completions): used for Idea Generation (prompt 01).
 *     Model is selectable per run (sonar-pro for speed, sonar-deep-research for
 *     the heavy pass).
 *   - Agent API (POST /v1/agent): used for Deep Competitor Analysis (prompt 03).
 *     An agentic runtime with built-in web_search / fetch_url tools for
 *     multi-step research.
 *
 * The company PERPLEXITY_API_KEY is read server-side via the credentials
 * service. Response parsing is defensive (Perplexity returns different shapes
 * across the two products); a failed or empty response throws UpstreamError —
 * research is never fabricated.
 */
import { config } from "../config/env.js";
import { getCompanyKey } from "../credentials/companyCredentials.js";
import { UpstreamError } from "../errors.js";

export const SONAR_MODELS = ["sonar", "sonar-pro", "sonar-reasoning-pro", "sonar-deep-research"] as const;
export type SonarModel = (typeof SONAR_MODELS)[number];

/** Injectable fetch for tests. */
type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
export function setPerplexityFetch(f: FetchLike | undefined): void {
  fetchImpl = f ?? fetch;
}

const RESEARCH_SYSTEM =
  "You are a research assistant supporting YouTube content strategy. Be specific: " +
  "cite dates, sources, and concrete numbers where available. Do not pad with generic filler.";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getCompanyKey("perplexity")}`,
    "Content-Type": "application/json",
  };
}

/** Append any citation URLs to the text, matching the original script's output. */
function withCitations(text: string, citations: unknown): string {
  if (Array.isArray(citations) && citations.length > 0) {
    const urls = citations
      .map((c) => (typeof c === "string" ? c : (c as any)?.url))
      .filter((u): u is string => typeof u === "string");
    if (urls.length) return `${text}\n\n--- Citations ---\n${urls.join("\n")}`;
  }
  return text;
}

/**
 * Sonar chat/completions research call (prompt 01). Returns the response text.
 * `sonar-deep-research` can take a few minutes; the caller streams via the
 * pipeline, so a generous timeout is used here.
 */
export async function sonarChat(prompt: string, model: SonarModel): Promise<string> {
  const body = {
    model,
    messages: [
      { role: "system", content: RESEARCH_SYSTEM },
      { role: "user", content: prompt },
    ],
  };
  let res: Response;
  try {
    res = await fetchImpl(`${config.perplexity.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.perplexity.timeoutMs),
    });
  } catch (err) {
    throw new UpstreamError(`Perplexity Sonar request failed: ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new UpstreamError(`Perplexity Sonar returned ${res.status}: ${json?.error?.message ?? json?.error ?? "unknown"}`);
  }
  const content: unknown = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new UpstreamError("Perplexity Sonar returned no content");
  }
  return withCitations(content, json?.citations ?? json?.search_results);
}

/**
 * Agent API research call (prompt 03). The Agent API is an agentic runtime with
 * built-in web_search + fetch_url tools. Request/response field names are read
 * defensively and the request shape is config-driven so it can be matched to
 * the live API without code changes.
 */
export async function agentRun(prompt: string): Promise<string> {
  const p = config.perplexity;
  const body: Record<string, unknown> = {
    model: p.agentModel,
    messages: [
      { role: "system", content: RESEARCH_SYSTEM },
      { role: "user", content: prompt },
    ],
    tools: [{ type: "web_search" }, { type: "fetch_url" }],
  };
  let res: Response;
  try {
    res = await fetchImpl(`${p.baseUrl}${p.agentPath}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(p.timeoutMs),
    });
  } catch (err) {
    throw new UpstreamError(`Perplexity Agent request failed: ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new UpstreamError(`Perplexity Agent returned ${res.status}: ${json?.error?.message ?? json?.error ?? "unknown"}`);
  }
  const text = extractAgentText(json);
  if (!text.trim()) throw new UpstreamError("Perplexity Agent returned no content");
  return withCitations(text, json?.citations ?? json?.search_results);
}

/**
 * Pull the final answer text out of an Agent API response. Checks the shapes
 * the Agent runtime is documented to return (choices/message, output text
 * blocks, a top-level answer/content field). Exported for tests + live tuning.
 */
export function extractAgentText(json: any): string {
  // OpenAI-style choices
  const choice = json?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) {
    const t = choice.map((b: any) => (typeof b === "string" ? b : b?.text)).filter(Boolean).join("\n");
    if (t) return t;
  }
  // Responses-style output blocks
  if (Array.isArray(json?.output)) {
    const t = json.output
      .flatMap((o: any) => (Array.isArray(o?.content) ? o.content : [o]))
      .map((c: any) => (typeof c === "string" ? c : c?.text))
      .filter(Boolean)
      .join("\n");
    if (t) return t;
  }
  // Flat fields
  for (const key of ["answer", "output_text", "content", "text"]) {
    if (typeof json?.[key] === "string") return json[key];
  }
  return "";
}
