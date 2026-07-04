/**
 * Reasoning adapter — the seam between orchestration code and the model that
 * runs the judgement steps (prompts 02, 04, 05, 06).
 *
 * The shipping implementation is the company ANTHROPIC_API_KEY path: every
 * director's run bills to the company account, server-side. There is no
 * personal-subscription mode in the hosted product. The interface exists for
 * testability (StubReasoningAdapter) and future model swaps, not for
 * alternative billing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getCompanyKey } from "../credentials/companyCredentials.js";
import { config } from "../config/env.js";
import { UpstreamError } from "../errors.js";

export interface ReasoningImage {
  /** Base64-encoded image data (no data: URI prefix). */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

export interface ReasoningRequest {
  system?: string;
  user: string;
  /** Optional images for vision steps (Retention Lab image path, prompt 05). */
  images?: ReasoningImage[];
  /** Cap on output tokens; reasoning steps produce long JSON, default is generous. */
  maxTokens?: number;
}

export interface ReasoningAdapter {
  /** Returns the model's final text output. Throws UpstreamError on failure. */
  complete(request: ReasoningRequest): Promise<string>;
}

/** The prompts target Opus-class reasoning ("Opus 4.8" in prompts/02 etc.). */
const REASONING_MODEL = "claude-opus-4-8";

export class AnthropicReasoningAdapter implements ReasoningAdapter {
  private client: Anthropic | undefined;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: getCompanyKey("anthropic") });
    }
    return this.client;
  }

  async complete(request: ReasoningRequest): Promise<string> {
    try {
      // A vision request interleaves image blocks before the text prompt;
      // a plain request sends the text as a simple string.
      const content: Anthropic.ContentBlockParam[] | string =
        request.images && request.images.length > 0
          ? [
              ...request.images.map(
                (img): Anthropic.ImageBlockParam => ({
                  type: "image",
                  source: { type: "base64", media_type: img.mediaType, data: img.data },
                }),
              ),
              { type: "text", text: request.user },
            ]
          : request.user;
      // Streaming keeps long scoring runs clear of HTTP timeouts.
      const stream = this.getClient().messages.stream({
        model: REASONING_MODEL,
        max_tokens: request.maxTokens ?? 32000,
        thinking: { type: "adaptive" },
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: "user", content }],
      });
      const message = await stream.finalMessage();
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (message.stop_reason === "refusal") {
        throw new UpstreamError("The reasoning model declined this request");
      }
      if (!text) {
        throw new UpstreamError("The reasoning model returned no text output");
      }
      return text;
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`Reasoning call failed: ${detail}`);
    }
  }
}

/**
 * Deterministic stand-in for tests and keyless local dev. Responses are queued
 * by the test (or default to an empty JSON array so pipelines fail visibly
 * rather than fabricating content).
 */
export class StubReasoningAdapter implements ReasoningAdapter {
  readonly requests: ReasoningRequest[] = [];
  private queue: string[] = [];

  enqueue(...responses: string[]): void {
    this.queue.push(...responses);
  }

  async complete(request: ReasoningRequest): Promise<string> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new UpstreamError("StubReasoningAdapter has no queued response");
    }
    return next;
  }
}

let adapter: ReasoningAdapter | undefined;

export function getReasoningAdapter(): ReasoningAdapter {
  if (!adapter) {
    adapter = config.reasoningAdapter === "stub" ? new StubReasoningAdapter() : new AnthropicReasoningAdapter();
  }
  return adapter;
}

/** Test hook: swap the process-wide adapter. */
export function setReasoningAdapter(next: ReasoningAdapter | undefined): void {
  adapter = next;
}
