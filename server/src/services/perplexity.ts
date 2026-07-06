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
 * built-in web_search + fetch_url tools, exposed as the OpenAI Responses API:
 * the request carries a single `input` string (NOT chat `messages`) and a
 * provider-prefixed model id (e.g. "perplexity/sonar", "anthropic/claude-...").
 * The response is a Responses object whose `output[]` array holds a `message`
 * item with `content[].text`, plus separate items carrying search results. Both
 * the answer text and its citations are read defensively from that shape.
 */
export async function agentRun(prompt: string): Promise<string> {
  const p = config.perplexity;
  const body: Record<string, unknown> = {
    model: p.agentModel,
    input: `${RESEARCH_SYSTEM}\n\n${prompt}`,
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
  return withCitations(text, extractAgentCitations(json));
}

/**
 * Collect citation URLs from an Agent (Responses API) payload. The Agent API
 * carries no top-level `citations`/`search_results`; instead sources appear as
 * `annotations` on the output_text block and as `results`/`queries` items in the
 * `output[]` array. Falls back to the Sonar-style top-level fields if present.
 */
export function extractAgentCitations(json: any): string[] {
  const urls: string[] = [];
  const push = (u: unknown) => {
    if (typeof u === "string" && u.trim()) urls.push(u);
  };
  if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      for (const c of Array.isArray(item?.content) ? item.content : []) {
        for (const a of Array.isArray(c?.annotations) ? c.annotations : []) push(a?.url);
      }
      for (const r of Array.isArray(item?.results) ? item.results : []) push(r?.url);
    }
  }
  for (const c of Array.isArray(json?.citations) ? json.citations : []) {
    push(typeof c === "string" ? c : c?.url);
  }
  for (const r of Array.isArray(json?.search_results) ? json.search_results : []) push(r?.url);
  return [...new Set(urls)];
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
  // Responses-style output blocks. Prefer the assistant `message` item(s); their
  // content carries the final answer as `output_text`. Reasoning/tool items in
  // the same array are ignored so their scratch text can't leak into the answer.
  if (Array.isArray(json?.output)) {
    const messages = json.output.filter((o: any) => o?.type === "message");
    const source = messages.length ? messages : json.output;
    const t = source
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
