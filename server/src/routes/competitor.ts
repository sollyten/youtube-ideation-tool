import { Router } from "express";
import { z } from "zod";
import { scoped } from "../auth/middleware.js";
import { runCompetitorAnalysis, runRecombination } from "../services/competitorAnalysis.js";

export const competitorRouter = Router();

/** Deep Competitor Analysis for one of the caller's profiles. */
competitorRouter.post("/profiles/:id/competitor-analysis", async (req, res, next) => {
  try {
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const result = await runCompetitorAnalysis(data, profile);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** "Generate ideas from these outliers" — recombination from a saved report. */
competitorRouter.post("/profiles/:id/recombine", async (req, res, next) => {
  try {
    const schema = z.object({ competitor_report_id: z.string().uuid() });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "competitor_report_id (uuid) is required" });
      return;
    }
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const result = await runRecombination(data, profile, parsed.data.competitor_report_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
