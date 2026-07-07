import { Router } from "express";
import { z } from "zod";
import { scoped } from "../auth/middleware.js";
import type { ReportType } from "../data/scoped.js";
import { BadRequestError } from "../errors.js";

export const reportsRouter = Router();

const feedbackSchema = z.object({
  selected_titles: z.array(z.string().min(1)).max(100),
  comments: z.string().max(4000).optional(),
});

const TYPES = new Set(["ideas", "competitor", "retention", "performance"]);

/** Current user's report history, filterable by profile and type. */
reportsRouter.get("/", async (req, res, next) => {
  try {
    const profileId = typeof req.query.profile_id === "string" ? req.query.profile_id : undefined;
    const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;
    const type = typeParam && TYPES.has(typeParam) ? (typeParam as ReportType) : undefined;
    const reports = profileId
      ? await scoped(req).listProfileReports(profileId, type)
      : await scoped(req).listOwnReports({ type });
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/:id", async (req, res, next) => {
  try {
    const report = await scoped(req).getReport(req.params.id);
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

/**
 * The director's feedback on an idea run (the optional post-run query).
 * `canRespond` tells the UI whether to offer the panel — only the profile
 * owner trains their own channel's taste.
 */
reportsRouter.get("/:id/feedback", async (req, res, next) => {
  try {
    const s = scoped(req);
    const report = await s.getReport(req.params.id);
    const profile = await s.getProfile(report.profileId);
    const feedback = report.type === "ideas" ? await s.getIdeaFeedback(req.params.id) : undefined;
    res.json({
      feedback: feedback ?? null,
      canRespond: report.type === "ideas" && !profile.readOnly,
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.post("/:id/feedback", async (req, res, next) => {
  try {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid feedback");
    const feedback = await scoped(req).saveIdeaFeedback(req.params.id, {
      selectedTitles: parsed.data.selected_titles,
      comments: parsed.data.comments,
    });
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});
