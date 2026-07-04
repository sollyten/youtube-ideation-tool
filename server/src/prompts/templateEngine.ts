/**
 * Prompt-template engine — the runtime brain-loader.
 *
 * Every feature (ideation, scoring, competitor analysis, recombination,
 * retention lab, performance learnings) runs a template from prompts/ through
 * this one component. It:
 *
 *   1. loads a template file and splits it into its ---SYSTEM--- / ---USER---
 *      sections (prose above ---SYSTEM--- is authoring commentary, not sent),
 *   2. resolves every {{placeholder}} against a context object built from the
 *      user-scoped profile, deterministic script outputs, idea memory, and
 *      learnings,
 *   3. refuses to render if any placeholder is unresolved — a silent blank in
 *      a prompt is a correctness bug, so we fail loudly instead.
 *
 * Placeholders support dot paths ({{focus.statement}}, {{audience.age_ranges}}).
 * Value formatting: strings verbatim; numbers stringified; arrays of primitives
 * as "- item" lines; objects/mixed arrays as pretty JSON.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PromptTemplate {
  /** Template name, e.g. "01_idea_generation.perplexity" */
  name: string;
  system: string | undefined;
  user: string;
  /** Every distinct {{placeholder}} appearing in system+user. */
  placeholders: string[];
}

export interface RenderedPrompt {
  system: string | undefined;
  user: string;
}

export type PromptContext = Record<string, unknown>;

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_RE)) found.add(match[1]);
  return [...found];
}

/** Parse raw template text into sections. Exported for tests. */
export function parseTemplate(name: string, raw: string): PromptTemplate {
  const systemMarker = raw.indexOf("---SYSTEM---");
  const userMarker = raw.indexOf("---USER---");
  let system: string | undefined;
  let user: string;
  if (userMarker === -1) {
    // No explicit sections: the whole file is the user prompt.
    user = raw.trim();
  } else {
    user = raw.slice(userMarker + "---USER---".length).trim();
    if (systemMarker !== -1 && systemMarker < userMarker) {
      system = raw.slice(systemMarker + "---SYSTEM---".length, userMarker).trim();
    }
  }
  const placeholders = extractPlaceholders((system ?? "") + "\n" + user);
  return { name, system, user, placeholders };
}

export async function loadTemplate(promptsDir: string, name: string): Promise<PromptTemplate> {
  const file = path.join(promptsDir, `${name}.md`);
  const raw = await readFile(file, "utf8");
  return parseTemplate(name, raw);
}

function lookupPath(context: PromptContext, dotPath: string): unknown {
  let value: unknown = context;
  for (const key of dotPath.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.map((v) => `- ${v}`).join("\n");
    }
    return JSON.stringify(value, null, 2);
  }
  return JSON.stringify(value, null, 2);
}

export class MissingPlaceholderError extends Error {
  constructor(templateName: string, missing: string[]) {
    super(
      `Template "${templateName}" has unresolved placeholders: ${missing.join(", ")}. ` +
        `Provide them in the context (empty string is acceptable for optional sections).`,
    );
  }
}

export function renderTemplate(template: PromptTemplate, context: PromptContext): RenderedPrompt {
  const missing: string[] = [];
  const substitute = (text: string): string =>
    text.replace(PLACEHOLDER_RE, (_whole, dotPath: string) => {
      const value = lookupPath(context, dotPath);
      if (value === undefined || value === null) {
        missing.push(dotPath);
        return "";
      }
      return formatValue(value);
    });
  const user = substitute(template.user);
  const system = template.system === undefined ? undefined : substitute(template.system);
  if (missing.length > 0) {
    throw new MissingPlaceholderError(template.name, [...new Set(missing)]);
  }
  return { system, user };
}

/** One-call convenience used by the pipelines. */
export async function renderPromptFile(
  promptsDir: string,
  name: string,
  context: PromptContext,
): Promise<RenderedPrompt> {
  const template = await loadTemplate(promptsDir, name);
  return renderTemplate(template, context);
}
