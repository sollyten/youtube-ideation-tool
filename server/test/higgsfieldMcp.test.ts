/**
 * Proves the Higgsfield-over-MCP client actually speaks MCP end to end, against
 * an in-memory mock Higgsfield MCP server (no live endpoint needed). Verifies
 * connect → list tools → call tool → parse images, plus argument passing and
 * the tool-not-found failure path.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpHiggsfieldClient } from "../src/thumbnail/higgsfieldMcp.js";

/** Build a mock Higgsfield MCP server; returns a client-transport factory + a capture. */
async function mockServer(opts: {
  toolName?: string;
  respond: (args: Record<string, unknown>) => { content?: unknown[]; structuredContent?: unknown };
  capture?: (args: Record<string, unknown>) => void;
}): Promise<() => Transport> {
  const server = new McpServer({ name: "mock-higgsfield", version: "1.0.0" });
  server.registerTool(
    opts.toolName ?? "generate_image",
    {
      description: "Generate an image",
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        reference_images: z.array(z.any()).optional(),
        attached_image: z.any().optional(),
      },
    },
    async (args: Record<string, unknown>) => {
      opts.capture?.(args);
      return opts.respond(args) as any;
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return () => clientTransport;
}

describe("McpHiggsfieldClient", () => {
  it("connects, calls the tool, and parses an image URL from a text block", async () => {
    let received: Record<string, unknown> | undefined;
    const factory = await mockServer({
      capture: (a) => (received = a),
      respond: () => ({ content: [{ type: "text", text: "Here: https://higgsfield.example/out.png" }] }),
    });
    const client = new McpHiggsfieldClient(factory);
    const result = await client.generate({
      prompt: "ratlines out of Europe, tense mood",
      references: [{ mediaType: "image/png", data: Buffer.from("ref-bytes") }],
    });
    expect(result.images).toEqual(["https://higgsfield.example/out.png"]);
    expect(result.model).toBe("nano-banana-pro");
    // The tool received the prompt + references under the configured arg names.
    expect(received?.prompt).toContain("ratlines");
    expect((received?.reference_images as unknown[]).length).toBe(1);
  });

  it("parses images from structuredContent", async () => {
    const factory = await mockServer({
      respond: () => ({
        content: [{ type: "text", text: "done" }],
        structuredContent: { images: [{ url: "https://higgsfield.example/a.png" }, "https://higgsfield.example/b.png"] },
      }),
    });
    const client = new McpHiggsfieldClient(factory);
    const result = await client.generate({ prompt: "x", references: [] });
    expect(result.images).toEqual([
      "https://higgsfield.example/a.png",
      "https://higgsfield.example/b.png",
    ]);
  });

  it("fails loudly when the configured tool is missing", async () => {
    // Server exposes a differently-named tool than the client expects.
    const factory = await mockServer({
      toolName: "some_other_tool",
      respond: () => ({ content: [] }),
    });
    const client = new McpHiggsfieldClient(factory);
    await expect(client.generate({ prompt: "x", references: [] })).rejects.toThrow(
      /does not expose a "generate_image" tool/,
    );
  });

  it("surfaces a tool error instead of returning a fake image", async () => {
    const factory = await mockServer({
      respond: () => ({ content: [{ type: "text", text: "quota exceeded" }], isError: true } as any),
    });
    const client = new McpHiggsfieldClient(factory);
    await expect(client.generate({ prompt: "x", references: [] })).rejects.toThrow(/quota exceeded/);
  });
});
