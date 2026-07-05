import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// loadEnv() is idempotent (module-level guard), so we import it fresh per case
// with vitest's module reset.
const ENV_FILE = `
# a comment
PERPLEXITY_API_KEY=pplx-from-file
ANTHROPIC_API_KEY="sk-ant-quoted"
YOUTUBE_API_KEY=AIza-key # trailing inline comment
ALREADY_SET=file-value
EMPTY_LINE_BELOW=ok

`;

describe("loadEnv", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const d of created) rmSync(d, { recursive: true, force: true });
    created.length = 0;
    for (const k of ["PERPLEXITY_API_KEY", "ANTHROPIC_API_KEY", "YOUTUBE_API_KEY", "EMPTY_LINE_BELOW"]) {
      delete process.env[k];
    }
    delete process.env.DOTENV_PATH;
    delete process.env.ALREADY_SET;
  });

  it("loads keys from the file, honoring quotes and inline comments; real env wins", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    created.push(dir);
    const file = path.join(dir, ".env");
    writeFileSync(file, ENV_FILE);
    process.env.DOTENV_PATH = file;
    process.env.ALREADY_SET = "real-env-wins";

    const { resetLoadEnvForTests, loadEnv } = await import("../src/config/loadEnv.js");
    resetLoadEnvForTests();
    loadEnv();

    expect(process.env.PERPLEXITY_API_KEY).toBe("pplx-from-file");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-quoted");
    expect(process.env.YOUTUBE_API_KEY).toBe("AIza-key");
    expect(process.env.EMPTY_LINE_BELOW).toBe("ok");
    // A variable already present in the real environment is never overwritten.
    expect(process.env.ALREADY_SET).toBe("real-env-wins");
  });

  it("is a no-op when the file is absent", async () => {
    process.env.DOTENV_PATH = path.join(tmpdir(), "definitely-missing-.env");
    const { resetLoadEnvForTests, loadEnv } = await import("../src/config/loadEnv.js");
    resetLoadEnvForTests();
    expect(() => loadEnv()).not.toThrow();
  });
});
