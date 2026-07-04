import { Router } from "express";
import { scoped } from "../auth/middleware.js";
import type { ReportType } from "../data/scoped.js";

export const reportsRouter = Router();

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
