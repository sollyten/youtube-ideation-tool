/**
 * Thumbnail Lab routes — ISOLATED namespace (/api/thumbnail-lab).
 *
 * Uses requireAuth only for identity (the user id). It does NOT touch
 * ScopedData, profiles, memory, prompts, or the reasoning adapter — it builds a
 * ThumbnailStore directly and calls the Higgsfield-only service. This is the
 * boundary the module exists to enforce.
 */
import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { UnauthorizedError, BadRequestError } from "../errors.js";
import type { Request } from "express";
import { ThumbnailStore } from "./store.js";
import { generateThumbnail } from "./service.js";

export const thumbnailRouter = Router();

function store(req: Request): ThumbnailStore {
  const userId = req.currentUser?.id;
  if (!userId) throw new UnauthorizedError();
  return new ThumbnailStore(getPool(), userId);
}

// slug is treated as an opaque visual-store key; no profile lookup happens here.
const slugParam = z.string().min(1).max(120);

thumbnailRouter.get("/:slug/style", async (req, res, next) => {
  try {
    const slug = slugParam.parse(req.params.slug);
    const s = store(req);
    const [style, references, generations] = await Promise.all([
      s.getStyle(slug),
      s.listReferences(slug),
      s.listGenerations(slug),
    ]);
    res.json({ style, references, generations });
  } catch (err) {
    next(err);
  }
});

thumbnailRouter.put("/:slug/style", async (req, res, next) => {
  try {
    const slug = slugParam.parse(req.params.slug);
    const schema = z.object({
      descriptor: z.record(z.unknown()).default({}),
      negative_style: z.array(z.string()).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid style payload");
    const style = await store(req).saveStyle(slug, parsed.data.descriptor, parsed.data.negative_style);
    res.json({ style });
  } catch (err) {
    next(err);
  }
});

thumbnailRouter.post("/:slug/references", async (req, res, next) => {
  try {
    const slug = slugParam.parse(req.params.slug);
    const schema = z.object({
      filename: z.string().min(1),
      note: z.string().default(""),
      media_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
      data: z.string().min(1), // base64
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid reference payload");
    const ref = await store(req).addReference(slug, {
      filename: parsed.data.filename,
      note: parsed.data.note,
      mediaType: parsed.data.media_type,
      data: Buffer.from(parsed.data.data, "base64"),
    });
    res.status(201).json({ reference: ref });
  } catch (err) {
    next(err);
  }
});

thumbnailRouter.delete("/:slug/references/:id", async (req, res, next) => {
  try {
    const slug = slugParam.parse(req.params.slug);
    await store(req).deleteReference(slug, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

thumbnailRouter.post("/:slug/generate", async (req, res, next) => {
  try {
    const slug = slugParam.parse(req.params.slug);
    const schema = z.object({
      request: z.string().min(1),
      attached: z
        .object({
          data: z.string().min(1),
          media_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
          mode: z.enum(["edit", "reference"]),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid generate payload");
    const result = await generateThumbnail(store(req), {
      slug,
      request: parsed.data.request,
      attached: parsed.data.attached
        ? {
            mediaType: parsed.data.attached.media_type,
            data: Buffer.from(parsed.data.attached.data, "base64"),
            mode: parsed.data.attached.mode,
          }
        : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
