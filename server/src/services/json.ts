/**
 * Robust extraction of a JSON array from model output. Both Perplexity and the
 * reasoning model are asked for pure JSON, but may wrap it in code fences or
 * add a trailing note (prompt 02 explicitly appends a plain-text drop list).
 * We locate the outermost array and parse only that; if none parses, the run
 * fails loudly — content is never fabricated.
 */
import { UpstreamError } from "../errors.js";

export function extractJsonArray<T = Record<string, unknown>>(text: string, source: string): T[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("[");
    if (start === -1) continue;
    // Walk to the matching close bracket so trailing prose doesn't break parsing.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\" && inString) {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === "[") {
        depth++;
      } else if (!inString && ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(candidate.slice(start, i + 1));
            if (Array.isArray(parsed)) return parsed as T[];
          } catch {
            // fall through to the next candidate
          }
          break;
        }
      }
    }
  }
  throw new UpstreamError(`${source} did not return a parsable JSON array`);
}

/** Same idea for a single JSON object. */
export function extractJsonObject<T = Record<string, unknown>>(text: string, source: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\" && inString) {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === "{") {
        depth++;
      } else if (!inString && ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(candidate.slice(start, i + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
          } catch {
            // fall through
          }
          break;
        }
      }
    }
  }
  throw new UpstreamError(`${source} did not return a parsable JSON object`);
}
