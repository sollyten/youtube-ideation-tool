/**
 * Unit tests for the Perplexity service (Sonar + Agent) with an injected fetch —
 * no network. Verifies request building (endpoint, model, auth) and defensive
 * response parsing for both products.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.PERPLEXITY_API_KEY = "pplx-test-key";

const { sonarChat, agentRun, extractAgentText, setPerplexityFetch } = await import(
  "../src/services/perplexity.js"
);

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
  it("posts to the agent path with web_search + fetch_url tools", async () => {
    const captured = mockFetch(200, { choices: [{ message: { content: "{\"topic_bank\":[]}" } }] });
    const out = await agentRun("analyze competitors");
    const c = await captured;
    expect(c.url).toMatch(/\/v1\/agent$/);
    expect(c.body.tools).toEqual([{ type: "web_search" }, { type: "fetch_url" }]);
    expect(out).toContain("topic_bank");
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
  it("returns empty string when nothing matches", () => {
    expect(extractAgentText({ weird: true })).toBe("");
  });
});
