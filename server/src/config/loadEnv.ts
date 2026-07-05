/**
 * Zero-dependency .env loader. Reads a .env file (repo root by default, or
 * $DOTENV_PATH) and populates process.env for any key that isn't already set —
 * so real environment variables always win over the file. Imported first thing
 * at startup (index.ts / migrate.ts) so config/env.ts sees the values.
 *
 * Company API keys live in this file server-side; it is git-ignored (.env) and
 * never shipped to the browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

/** Test hook: allow loadEnv() to run again with a different DOTENV_PATH. */
export function resetLoadEnvForTests(): void {
  loaded = false;
}

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const envPath = process.env.DOTENV_PATH || path.join(repoRoot, ".env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return; // no .env file — rely on the real environment
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue; // real env wins
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes and an optional trailing inline comment.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
}
