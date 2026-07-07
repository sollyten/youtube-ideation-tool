import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPlaceholders,
  loadTemplate,
  parseTemplate,
  renderTemplate,
  MissingPlaceholderError,
} from "../src/prompts/templateEngine.js";

const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prompts");

describe("parseTemplate", () => {
  it("splits SYSTEM and USER sections and drops authoring commentary", () => {
    const raw = [
      "# Some header commentary with a literal {{placeholder}} mention",
      "---SYSTEM---",
      "You are {{role}}.",
      "---USER---",
      "Hello {{name}}, focus: {{focus.statement}}",
    ].join("\n");
    const t = parseTemplate("test", raw);
    expect(t.system).toBe("You are {{role}}.");
    expect(t.user).toBe("Hello {{name}}, focus: {{focus.statement}}");
    expect(t.placeholders.sort()).toEqual(["focus.statement", "name", "role"]);
  });

  it("treats a file without markers as a pure user prompt", () => {
    const t = parseTemplate("plain", "Just {{x}}");
    expect(t.system).toBeUndefined();
    expect(t.user).toBe("Just {{x}}");
  });
});

describe("renderTemplate", () => {
  it("resolves dot paths and formats arrays as bullet lists", () => {
    const t = parseTemplate("test", "---USER---\nAges: {{audience.age_ranges}}\nNiche: {{niche}}");
    const rendered = renderTemplate(t, {
      audience: { age_ranges: ["25-34", "18-24"] },
      niche: "naval history",
    });
    expect(rendered.user).toContain("- 25-34\n- 18-24");
    expect(rendered.user).toContain("Niche: naval history");
  });

  it("throws on unresolved placeholders instead of rendering blanks", () => {
    const t = parseTemplate("test", "---USER---\n{{present}} {{missing}}");
    expect(() => renderTemplate(t, { present: "yes" })).toThrow(MissingPlaceholderError);
  });

  it("accepts empty strings for intentionally blank sections", () => {
    const t = parseTemplate("test", "---USER---\n[{{optional}}]");
    expect(renderTemplate(t, { optional: "" }).user).toBe("[]");
  });
});

describe("real prompt files", () => {
  it("loads prompt 01 and renders it fully from an ideation-shaped context", async () => {
    const t = await loadTemplate(promptsDir, "01_idea_generation.perplexity");
    expect(t.system).toBeTruthy();
    expect(t.placeholders).toContain("focus.statement");
    const context = {
      channel_name: "Test Channel",
      niche: "test niche",
      focus: { statement: "test focus" },
      user_style_description: "style",
      format_style: "fmt",
      tone: "tone",
      audience: { age_ranges: ["25-34"], top_countries: ["US"] },
      resources_concatenated: "(none)",
      performance_learnings: "(none yet)",
      my_outliers: "A | 4x",
      competitor_outliers: "C | B | 5x",
      recent_topics: ["t1"],
      previously_generated_ideas: "(none)",
      director_feedback: "(no director feedback recorded yet)",
      idea_count: 60,
    };
    const rendered = renderTemplate(t, context);
    expect(rendered.user).toContain("test focus");
    expect(rendered.user).not.toMatch(/\{\{[\w.]+\}\}/);
  });

  it("loads prompt 02 and renders it fully", async () => {
    const t = await loadTemplate(promptsDir, "02_idea_scoring.opus");
    const rendered = renderTemplate(t, {
      profile_json: { slug: "x" },
      candidate_ideas_json: "[]",
      previously_generated_ideas: "(none)",
      director_feedback: "(no director feedback recorded yet)",
      format_style: "fmt",
      idea_count: 60,
    });
    expect(rendered.user).not.toMatch(/\{\{[\w.]+\}\}/);
  });
});
