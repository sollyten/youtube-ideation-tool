/**
 * Higgsfield-over-MCP client for the ISOLATED Thumbnail Lab.
 *
 * Implements the same HiggsfieldClient interface as the HTTP client, but talks
 * to a Higgsfield MCP server (Streamable HTTP transport) instead of the REST
 * API. This keeps the module's isolation contract: the only external tool is
 * Higgsfield, reached here through its MCP endpoint. Nothing about strategy,
 * memory, or the profile is imported.
 *
 * Because Higgsfield's exact MCP tool name and argument shape aren't fixed here,
 * they are configurable (HIGGSFIELD_MCP_*). Defaults match the documented
 * "generate image with nano banana Pro" shape; override them to match the real
 * server. If the configured tool isn't found, we fail loudly with the list of
 * tools the server actually exposes — never a fabricated image.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config/env.js";
import { UpstreamError } from "../errors.js";
import type { HiggsfieldClient, HiggsfieldRequest, HiggsfieldResult } from "./higgsfield.js";

const HIGGSFIELD_MODEL = "nano-banana-pro";

/** Pull image URLs / data URIs out of an MCP tool-call result. */
function extractImages(result: unknown): string[] {
  const images: string[] = [];
  const r = result as { content?: unknown[]; structuredContent?: Record<string, unknown> };

  // Preferred: structured content with an images array.
  const structured = r?.structuredContent;
  if (structured) {
    const arr = (structured.images ?? structured.results ?? structured.urls) as unknown;
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === "string") images.push(it);
        else if (it && typeof it === "object") {
          const u = (it as any).url ?? (it as any).image_url ?? (it as any).uri;
          if (typeof u === "string") images.push(u);
        }
      }
    }
  }

  // Fallback: image content blocks (base64) or text blocks carrying URLs.
  if (Array.isArray(r?.content)) {
    for (const block of r.content) {
      const b = block as any;
      if (b?.type === "image" && typeof b.data === "string") {
        images.push(`data:${b.mimeType ?? "image/png"};base64,${b.data}`);
      } else if (b?.type === "text" && typeof b.text === "string") {
        const m = b.text.match(/https?:\/\/\S+|data:image\/\S+/g);
        if (m) images.push(...m);
      }
    }
  }
  return [...new Set(images)];
}

export class McpHiggsfieldClient implements HiggsfieldClient {
  /** Injectable transport for tests (in-memory); production builds one from config. */
  constructor(private readonly transportFactory?: () => Transport) {}

  private buildTransport(): Transport {
    if (this.transportFactory) return this.transportFactory();
    const url = config.higgsfieldMcp.url;
    if (!url) throw new UpstreamError("HIGGSFIELD_MCP_URL is not configured");
    const headers: Record<string, string> = {};
    const token = config.higgsfieldMcp.authToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });
  }

  async generate(request: HiggsfieldRequest): Promise<HiggsfieldResult> {
    const client = new Client(
      { name: "thumbnail-lab", version: "1.0.0" },
      { capabilities: {} },
    );
    let transport: Transport;
    try {
      transport = this.buildTransport();
      await client.connect(transport);
    } catch (err) {
      throw new UpstreamError(`Could not connect to the Higgsfield MCP server: ${(err as Error).message}`);
    }

    try {
      const toolName = config.higgsfieldMcp.tool;
      const { tools } = await client.listTools();
      if (!tools.some((t) => t.name === toolName)) {
        throw new UpstreamError(
          `Higgsfield MCP server does not expose a "${toolName}" tool. Available: ${tools
            .map((t) => t.name)
            .join(", ") || "(none)"}. Set HIGGSFIELD_MCP_TOOL to match.`,
        );
      }

      // Argument names are configurable to match the real server's schema.
      const args: Record<string, unknown> = {
        [config.higgsfieldMcp.promptArg]: request.prompt,
        [config.higgsfieldMcp.modelArg]: HIGGSFIELD_MODEL,
      };
      if (request.references.length > 0) {
        args[config.higgsfieldMcp.referencesArg] = request.references.map((r) => ({
          media_type: r.mediaType,
          data: r.data.toString("base64"),
        }));
      }
      if (request.attached) {
        args[config.higgsfieldMcp.attachedArg] = {
          media_type: request.attached.mediaType,
          data: request.attached.data.toString("base64"),
          mode: request.attached.mode,
        };
      }

      const result = await client.callTool({ name: toolName, arguments: args });
      if ((result as any).isError) {
        const text = Array.isArray((result as any).content)
          ? (result as any).content.map((c: any) => c.text).filter(Boolean).join(" ")
          : "unknown error";
        throw new UpstreamError(`Higgsfield MCP tool returned an error: ${text}`);
      }
      const images = extractImages(result);
      if (images.length === 0) throw new UpstreamError("Higgsfield MCP tool returned no images");
      return { images, model: HIGGSFIELD_MODEL, raw: result };
    } finally {
      await client.close().catch(() => {});
    }
  }
}
