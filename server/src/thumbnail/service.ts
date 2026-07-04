/**
 * Thumbnail Lab service — ISOLATED.
 *
 * Composes a Higgsfield generation prompt from the stored VISUAL style
 * descriptor + the user's request (deterministically, in code — no reasoning
 * model, no profile, no memory), then calls Higgsfield. This honours the
 * module's contract: the only external tool is Higgsfield, and the only channel
 * data is the visual store keyed by slug.
 *
 * The prompt structure follows thumbnail-lab/thumbnail_request.prompt.md.
 */
import type { ThumbnailStore, VisualStyle } from "./store.js";
import { getHiggsfieldClient, type HiggsfieldResult } from "./higgsfield.js";

function describeStyle(style: VisualStyle): { text: string; locked: string[] } {
  const v = (style.descriptor as any)?.visual_style ?? style.descriptor ?? {};
  const parts: string[] = [];
  const locked: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    const str = Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (!str) return;
    parts.push(`${label}: ${str}`);
    locked.push(label);
  };
  push("composition", v.composition);
  push("palette", v.palette);
  push("lighting", v.lighting);
  push("subject treatment", v.subject_treatment);
  push("mood", v.mood);
  if (v.typography?.used) push("typography", `${v.typography.style ?? ""} (${v.typography.placement ?? ""})`);
  if (v.logo_or_brand_mark?.present)
    push("brand mark", `${v.logo_or_brand_mark.description ?? ""} at ${v.logo_or_brand_mark.placement ?? ""}`);
  push("recurring motifs", v.recurring_motifs);
  return { text: parts.join("; "), locked };
}

export interface GenerateInput {
  slug: string;
  request: string;
  attached?: { mediaType: string; data: Buffer; mode: "edit" | "reference" };
}

export interface GenerateOutput {
  generationId: string;
  images: string[];
  promptUsed: string;
  styleLocked: string;
  model: string;
}

/**
 * Build the Higgsfield prompt, attach the stored reference images (+ optional
 * attached image), generate, and record the generation.
 */
export async function generateThumbnail(store: ThumbnailStore, input: GenerateInput): Promise<GenerateOutput> {
  const style = await store.getStyle(input.slug);
  const references = await store.getReferenceImages(input.slug);
  const { text: styleText, locked } = describeStyle(style);

  const negative = style.negativeStyle.length ? ` Avoid: ${style.negativeStyle.join(", ")}.` : "";
  const styleClause = styleText ? ` On-brand style — ${styleText}.` : "";
  const editClause =
    input.attached?.mode === "edit"
      ? " Edit the attached image per the request while keeping the channel style."
      : input.attached?.mode === "reference"
        ? " Use the attached image as an additional visual reference."
        : "";
  const prompt = `${input.request.trim()}.${styleClause}${negative}${editClause}`.trim();

  const result: HiggsfieldResult = await getHiggsfieldClient().generate({
    prompt,
    references: references.map((r) => ({ mediaType: r.mediaType, data: r.data })),
    attached: input.attached,
  });

  const styleLocked = locked.length ? `Enforced: ${locked.join(", ")}` : "No stored style yet";
  const record = await store.recordGeneration(input.slug, {
    request: input.request,
    promptUsed: prompt,
    styleLocked,
    result: { images: result.images, model: result.model },
  });

  return {
    generationId: record.id,
    images: result.images,
    promptUsed: prompt,
    styleLocked,
    model: result.model,
  };
}
