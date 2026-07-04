import { Router } from "express";
import { z } from "zod";
import { scoped } from "../auth/middleware.js";
import { BadRequestError } from "../errors.js";
import { runRetentionLab } from "../services/retentionLab.js";

export const retentionRouter = Router();

const schema = z.object({
  video_title: z.string().min(1),
  video_length: z.string().optional(),
  video_id: z.string().optional(),
  image: z
    .object({
      data: z.string().min(1),
      media_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    })
    .optional(),
});

retentionRouter.post("/profiles/:id/retention-lab", async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid input");
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const result = await runRetentionLab(data, profile, {
      videoTitle: parsed.data.video_title,
      videoLength: parsed.data.video_length,
      videoId: parsed.data.video_id,
      image: parsed.data.image
        ? { data: parsed.data.image.data, mediaType: parsed.data.image.media_type }
        : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
