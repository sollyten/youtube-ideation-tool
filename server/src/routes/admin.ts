import { Router } from "express";
import { requireAdmin } from "../auth/middleware.js";
import { credentialStatus } from "../credentials/companyCredentials.js";
import { getPool } from "../db/pool.js";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Which company keys are configured (booleans only — never the keys). */
adminRouter.get("/credentials", (_req, res) => {
  res.json({ credentials: credentialStatus() });
});

/** Per-user usage over the last 30 days, for the company-spend view. */
adminRouter.get("/usage", async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT u.email, u.name, e.action, count(*)::int AS runs, max(e.created_at) AS last_run
       FROM usage_events e JOIN users u ON u.id = e.owner_user_id
       WHERE e.created_at > now() - interval '30 days'
       GROUP BY u.email, u.name, e.action
       ORDER BY runs DESC`,
    );
    res.json({ usage: rows });
  } catch (err) {
    next(err);
  }
});
