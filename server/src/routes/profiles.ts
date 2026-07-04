import { Router } from "express";
import { z } from "zod";
import { scoped } from "../auth/middleware.js";
import { BadRequestError } from "../errors.js";
import { buildProfilePreview } from "../services/profileBuilder.js";
import { assertQuota } from "../services/quota.js";

export const profilesRouter = Router();

const buildInputSchema = z.object({
  channel_url: z.string().min(3),
  focus_statement: z.string().min(1),
  user_style_description: z.string().min(1),
  resources: z
    .array(
      z.object({
        label: z.string().min(1),
        type: z.enum(["pasted_text", "uploaded_file"]),
        content: z.string(),
      }),
    )
    .default([]),
  competitors: z.array(z.object({ url: z.string().min(3) })).default([]),
  audience: z.object({
    age_ranges: z.array(z.string()).max(5),
    top_countries: z.array(z.string()).max(10),
  }),
});

profilesRouter.get("/", async (req, res, next) => {
  try {
    const profiles = await scoped(req).listProfiles();
    res.json({ profiles });
  } catch (err) {
    next(err);
  }
});

/** Step 1 of Add Channel: assemble the profile and show it for confirmation. */
profilesRouter.post("/preview", async (req, res, next) => {
  try {
    const parsed = buildInputSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid input");
    const data = scoped(req);
    await assertQuota(data, "profile_build");
    const preview = await buildProfilePreview(parsed.data);
    await data.recordUsage("profile_build", undefined, { channel_url: parsed.data.channel_url });
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

/** Step 2: the user confirmed the preview — persist it. */
profilesRouter.post("/", async (req, res, next) => {
  try {
    const schema = z.object({
      slug: z.string().min(1).max(80),
      data: z.record(z.unknown()),
      overwrite: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid profile payload");
    const profile = await scoped(req).createProfile(parsed.data);
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

profilesRouter.get("/:id", async (req, res, next) => {
  try {
    const profile = await scoped(req).getProfile(req.params.id);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

/**
 * Inline edits to the USER+EDITABLE fields (focus changes often — SPEC §2).
 * Whitelisted so AUTO fields and identity fields can't be clobbered from the UI.
 */
const editableSchema = z
  .object({
    focus_statement: z.string().min(1).optional(),
    user_style_description: z.string().min(1).optional(),
    resources: z
      .array(
        z.object({
          id: z.string().optional(),
          label: z.string().min(1),
          type: z.enum(["pasted_text", "uploaded_file"]),
          content: z.string(),
          added_at: z.string().optional(),
        }),
      )
      .optional(),
    competitors: z
      .array(z.object({ name: z.string(), url: z.string(), channel_id: z.string() }))
      .optional(),
    audience: z
      .object({ age_ranges: z.array(z.string()), top_countries: z.array(z.string()) })
      .optional(),
    visibility: z.enum(["private", "company"]).optional(),
  })
  .strict();

profilesRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = editableSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid patch");
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const patch = parsed.data;
    const now = new Date().toISOString();
    const profileData = profile.data as Record<string, any>;

    if (patch.focus_statement !== undefined) {
      profileData.focus = { statement: patch.focus_statement, last_updated: now };
    }
    if (patch.user_style_description !== undefined) {
      profileData.user_style_description = patch.user_style_description;
    }
    if (patch.resources !== undefined) {
      profileData.resources = patch.resources.map((r) => ({
        id: r.id ?? crypto.randomUUID(),
        label: r.label,
        type: r.type,
        content: r.content,
        added_at: r.added_at ?? now,
      }));
    }
    if (patch.competitors !== undefined) profileData.competitors = patch.competitors;
    if (patch.audience !== undefined) profileData.audience = patch.audience;
    profileData.updated_at = now;

    const updated = await data.updateProfile(profile.id, {
      data: profileData,
      visibility: patch.visibility,
    });
    res.json({ profile: updated });
  } catch (err) {
    next(err);
  }
});

profilesRouter.delete("/:id", async (req, res, next) => {
  try {
    await scoped(req).deleteProfile(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
