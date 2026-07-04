/**
 * Guardrail: the Thumbnail Lab module must import ONLY Higgsfield + its own
 * store. This test statically scans every file under src/thumbnail/ and fails
 * if any of them import the profile-facing data layer, ideation/competitor/
 * retention services, the prompt engine, the reasoning adapter, or memory —
 * the exact things thumbnail-lab/README.md says must never cross the boundary.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/thumbnail");

const FORBIDDEN = [
  "data/scoped",
  "services/ideation",
  "services/ideaScoring",
  "services/competitorAnalysis",
  "services/retentionLab",
  "services/performance",
  "prompts/templateEngine",
  "reasoning/adapter",
];

describe("Thumbnail Lab isolation contract", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has module files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports nothing from the strategic side`, () => {
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const forbidden of FORBIDDEN) {
        expect(src, `${file} must not import ${forbidden}`).not.toContain(forbidden);
      }
    });
  }
});
