/**
 * Express app factory. Auth is applied at the router level: every /api route
 * except /api/auth/{register,login} sits behind requireAuth, which resolves
 * identity through the single getCurrentUser() and hands the handler its
 * user-scoped data layer.
 */
import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { requireAuth } from "./auth/middleware.js";
import { HttpError } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { profilesRouter } from "./routes/profiles.js";
import { ideationRouter } from "./routes/ideation.js";
import { competitorRouter } from "./routes/competitor.js";
import { performanceRouter } from "./routes/performance.js";
import { retentionRouter } from "./routes/retention.js";
import { reportsRouter } from "./routes/reports.js";
import { adminRouter } from "./routes/admin.js";
import { thumbnailRouter } from "./thumbnail/routes.js";
import { config } from "./config/env.js";

export function createApp(): express.Express {
  const app = express();
  // Generous limit: the Retention Lab image path posts a base64 screenshot.
  app.use(express.json({ limit: "12mb" }));

  app.use("/api/auth", authRouter);
  app.use("/api/profiles", requireAuth, profilesRouter);
  app.use("/api", requireAuth, ideationRouter);
  app.use("/api", requireAuth, competitorRouter);
  app.use("/api", requireAuth, performanceRouter);
  app.use("/api", requireAuth, retentionRouter);
  app.use("/api/reports", requireAuth, reportsRouter);
  app.use("/api/admin", requireAuth, adminRouter);
  // Isolated module: identity only, no profile/memory/prompt access.
  app.use("/api/thumbnail-lab", requireAuth, thumbnailRouter);

  // Serve the built front end in production; the Vite dev server proxies /api
  // during development.
  const webDist = path.join(config.repoRoot, "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  // Central error mapping. HttpErrors carry their status; anything else is a
  // 500 with the detail kept server-side.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("Unhandled error:", err);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
