import { Router } from "express";
import { z } from "zod";
import { scoped } from "../auth/middleware.js";
import { runIdeation } from "../services/ideation.js";

export const ideationRouter = Router();

/** Run the full Idea Generation pipeline for one of the caller's profiles. */
ideationRouter.post("/profiles/:id/ideate", async (req, res, next) => {
  try {
    const schema = z.object({
      idea_count: z.number().int().min(50).max(100).optional(),
      sonar_model: z.enum(["sonar", "sonar-pro", "sonar-reasoning-pro", "sonar-deep-research"]).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const result = await runIdeation(data, profile, {
      ideaCount: parsed.success ? parsed.data.idea_count : undefined,
      sonarModel: parsed.success ? parsed.data.sonar_model : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
