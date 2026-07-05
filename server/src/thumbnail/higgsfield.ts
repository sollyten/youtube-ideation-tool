/**
 * Higgsfield client — the ONLY external tool the Thumbnail Lab may reach.
 *
 * Mirrors the reasoning-adapter pattern: a small interface, a company-key HTTP
 * implementation (model = nano banana Pro), and a stub for tests/dev. With no
 * HIGGSFIELD_API_KEY configured it fails loudly — a generation error is surfaced,
 * an image is never fabricated.
 */
import { getCompanyKey } from "../credentials/companyCredentials.js";
import { UpstreamError } from "../errors.js";
import { McpHiggsfieldClient } from "./higgsfieldMcp.js";

export interface HiggsfieldReference {
  mediaType: string;
  data: Buffer;
}

export interface HiggsfieldRequest {
  prompt: string;
  references: HiggsfieldReference[];
  /** Optional attached image and its mode. */
  attached?: { mediaType: string; data: Buffer; mode: "edit" | "reference" };
}

export interface HiggsfieldResult {
  /** URLs or data URIs of generated image(s), exactly as Higgsfield returned them. */
  images: string[];
  model: string;
  raw?: unknown;
}

export interface HiggsfieldClient {
  generate(request: HiggsfieldRequest): Promise<HiggsfieldResult>;
}

const HIGGSFIELD_MODEL = "nano-banana-pro";
const HIGGSFIELD_ENDPOINT =
  process.env.HIGGSFIELD_ENDPOINT ?? "https://api.higgsfield.ai/v1/images/generate";

export class HttpHiggsfieldClient implements HiggsfieldClient {
  async generate(request: HiggsfieldRequest): Promise<HiggsfieldResult> {
    const apiKey = getCompanyKey("higgsfield");
    const body = {
      model: HIGGSFIELD_MODEL,
      prompt: request.prompt,
      reference_images: request.references.map((r) => ({
        media_type: r.mediaType,
        data: r.data.toString("base64"),
      })),
      ...(request.attached
        ? {
            attached_image: {
              media_type: request.attached.mediaType,
              data: request.attached.data.toString("base64"),
              mode: request.attached.mode,
            },
          }
        : {}),
    };
    let res: Response;
    try {
      res = await fetch(HIGGSFIELD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new UpstreamError(`Higgsfield request failed: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new UpstreamError(`Higgsfield returned ${res.status}: ${json.error ?? "unknown error"}`);
    }
    const images = Array.isArray(json.images)
      ? (json.images as unknown[]).map((i) =>
          typeof i === "string" ? i : ((i as any).url ?? (i as any).image_url ?? ""),
        ).filter(Boolean)
      : [];
    if (images.length === 0) throw new UpstreamError("Higgsfield returned no images");
    return { images, model: HIGGSFIELD_MODEL, raw: json };
  }
}

/** Deterministic stub for tests/dev. Records requests; returns queued results. */
export class StubHiggsfieldClient implements HiggsfieldClient {
  readonly requests: HiggsfieldRequest[] = [];
  private queue: HiggsfieldResult[] = [];

  enqueue(...results: HiggsfieldResult[]): void {
    this.queue.push(...results);
  }

  async generate(request: HiggsfieldRequest): Promise<HiggsfieldResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new UpstreamError("StubHiggsfieldClient has no queued result");
    return next;
  }
}

let client: HiggsfieldClient | undefined;

export function getHiggsfieldClient(): HiggsfieldClient {
  if (!client) {
    const adapter = process.env.HIGGSFIELD_ADAPTER;
    if (adapter === "stub") {
      client = new StubHiggsfieldClient();
    } else if (adapter === "mcp") {
      client = new McpHiggsfieldClient();
    } else {
      client = new HttpHiggsfieldClient();
    }
  }
  return client;
}

export function setHiggsfieldClient(next: HiggsfieldClient | undefined): void {
  client = next;
}
