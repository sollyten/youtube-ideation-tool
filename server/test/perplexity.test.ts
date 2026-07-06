/**
 * Unit tests for the Perplexity service (Sonar + Agent) with an injected fetch —
 * no network. Verifies request building (endpoint, model, auth) and defensive
 * response parsing for both products.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.PERPLEXITY_API_KEY = "pplx-test-key";

const { sonarChat, agentRun, extractAgentText, extractAgentCitations, setPerplexityFetch } =
  await import("../src/services/perplexity.js");

interface Captured {
  url: string;
  init: RequestInit;
  body: any;
}

function mockFetch(status: number, json: unknown): Promise<Captured> {
  return new Promise<Captured>((resolve) => {
    setPerplexityFetch((async (url: any, init: any) => {
      resolve({ url: String(url), init, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
      } as unknown as Response;
    }) as typeof fetch);
  });
}

beforeAll(() => {
  process.env.PERPLEXITY_API_KEY = "pplx-test-key";
});
afterEach(() => setPerplexityFetch(undefined));

describe("sonarChat", () => {
  it("posts to /chat/completions with the chosen model + bearer auth, returns content", async () => {
    const captured = mockFetch(200, {
      choices: [{ message: { content: "raw idea json here" } }],
      citations: ["https://example.com/a"],
    });
    const out = await sonarChat("generate ideas", "sonar-deep-research");
    const c = await captured;
    expect(c.url).toMatch(/\/chat\/completions$/);
    expect(c.body.model).toBe("sonar-deep-research");
    expect((c.init.headers as any).Authorization).toBe("Bearer pplx-test-key");
    expect(c.body.messages[1].content).toBe("generate ideas");
    expect(out).toContain("raw idea json here");
    expect(out).toContain("https://example.com/a"); // citations appended
  });

  it("throws on a non-2xx response instead of returning junk", async () => {
    void mockFetch(429, { error: { message: "rate limited" } });
    await expect(sonarChat("x", "sonar-pro")).rejects.toThrow(/429|rate limited/);
  });
});

describe("agentRun", () => {
  it("posts to the agent path in Responses format (input string, not messages)", async () => {
    // Live Agent shape: object:"response", output[] with a message item.
    const captured = mockFetch(200, {
      object: "response",
      output: [
        { type: "reasoning", content: [{ type: "text", text: "thinking scratch" }] },
        { type: "message", content: [{ type: "output_text", text: "{\"topic_bank\":[]}" }] },
      ],
    });
    const out = await agentRun("analyze competitors");
    const c = await captured;
    expect(c.url).toMatch(/\/v1\/agent$/);
    // Agent API rejects chat `messages`; it takes a single `input` string.
    expect(c.body.messages).toBeUndefined();
    expect(typeof c.body.input).toBe("string");
    expect(c.body.input).toContain("analyze competitors");
    expect(c.body.model).toBe("perplexity/sonar");
    expect(c.body.tools).toEqual([{ type: "web_search" }, { type: "fetch_url" }]);
    // Only the message item's text is returned — reasoning scratch is dropped.
    expect(out).toContain("topic_bank");
    expect(out).not.toContain("thinking scratch");
  });
});

describe("extractAgentText (defensive parsing)", () => {
  it("reads OpenAI-style choices", () => {
    expect(extractAgentText({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
  });
  it("reads responses-style output blocks", () => {
    expect(
      extractAgentText({ output: [{ content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }] }] }),
    ).toBe("part1\npart2");
  });
  it("reads flat answer/content fields", () => {
    expect(extractAgentText({ answer: "flat answer" })).toBe("flat answer");
    expect(extractAgentText({ content: "flat content" })).toBe("flat content");
  });
  it("prefers the message item over reasoning/tool items", () => {
    expect(
      extractAgentText({
        output: [
          { type: "reasoning", content: [{ type: "text", text: "scratch" }] },
          { type: "message", content: [{ type: "output_text", text: "answer" }] },
        ],
      }),
    ).toBe("answer");
  });
  it("returns empty string when nothing matches", () => {
    expect(extractAgentText({ weird: true })).toBe("");
  });
});

describe("extractAgentCitations", () => {
  it("reads annotations on output_text and results items", () => {
    const urls = extractAgentCitations({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "answer",
              annotations: [{ url: "https://a.com" }, { url: "https://b.com" }],
            },
          ],
        },
        { type: "web_search_results", results: [{ url: "https://b.com" }, { url: "https://c.com" }] },
      ],
    });
    expect(urls).toEqual(["https://a.com", "https://b.com", "https://c.com"]); // de-duped
  });
  it("falls back to Sonar-style top-level citations/search_results", () => {
    expect(extractAgentCitations({ citations: ["https://x.com"] })).toEqual(["https://x.com"]);
    expect(extractAgentCitations({ search_results: [{ url: "https://y.com" }] })).toEqual([
      "https://y.com",
    ]);
  });
  it("returns an empty array when nothing matches", () => {
    expect(extractAgentCitations({ weird: true })).toEqual([]);
  });
});
