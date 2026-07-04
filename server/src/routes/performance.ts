import { Router } from "express";
import { scoped } from "../auth/middleware.js";
import { config } from "../config/env.js";
import { BadRequestError, ForbiddenError } from "../errors.js";
import { buildAuthUrl, decodeState, exchangeCode } from "../oauth/youtube.js";
import { disconnect, isConnected, markConnected, runPerformanceSync } from "../services/performance.js";

export const performanceRouter = Router();

/** Connection status for the Performance tab lock. */
performanceRouter.get("/profiles/:id/connection", async (req, res, next) => {
  try {
    const profile = await scoped(req).getProfile(req.params.id);
    const conn = (profile.data as any)?.connections?.youtube_analytics ?? {};
    res.json({
      connected: isConnected(profile),
      oauthConfigured: config.googleOAuth.configured,
      channelId: conn.channel_id || null,
      connectedAt: conn.connected_at || null,
    });
  } catch (err) {
    next(err);
  }
});

/** Begin the per-director OAuth flow; returns the Google consent URL. */
performanceRouter.post("/profiles/:id/youtube/connect", async (req, res, next) => {
  try {
    if (!config.googleOAuth.configured) {
      throw new BadRequestError("YouTube OAuth is not configured on this server");
    }
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    if (profile.readOnly) throw new ForbiddenError("You can only connect channels you own");
    res.json({ authUrl: buildAuthUrl(data.user.id, profile.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * OAuth callback (top-level browser redirect — carries the session cookie).
 * Verifies the signed state AND that the live user matches it, exchanges the
 * code server-side, stores the token encrypted, and marks the profile connected.
 */
performanceRouter.get("/oauth/youtube/callback", async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      res.redirect(`${config.appBaseUrl}/?youtube=denied`);
      return;
    }
    if (typeof code !== "string" || typeof state !== "string") {
      throw new BadRequestError("Missing code or state");
    }
    const payload = decodeState(state);
    const data = scoped(req);
    if (payload.userId !== data.user.id) {
      throw new ForbiddenError("This authorization does not belong to the signed-in user");
    }
    const profile = await data.getProfile(payload.profileId);
    if (profile.readOnly) throw new ForbiddenError("You can only connect channels you own");

    const token = await exchangeCode(code);
    const channelId = (profile.data as any)?.channel_id ?? "";
    await data.saveChannelToken(profile.id, JSON.stringify(token), channelId);
    await markConnected(data, profile, channelId);

    res.redirect(`${config.appBaseUrl}/channels/${profile.id}?youtube=connected`);
  } catch (err) {
    next(err);
  }
});

performanceRouter.post("/profiles/:id/youtube/disconnect", async (req, res, next) => {
  try {
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    if (profile.readOnly) throw new ForbiddenError("You can only disconnect channels you own");
    const updated = await disconnect(data, profile);
    res.json({ connected: isConnected(updated) });
  } catch (err) {
    next(err);
  }
});

/** Run a performance sync (locked until the profile is connected). */
performanceRouter.post("/profiles/:id/performance-sync", async (req, res, next) => {
  try {
    const data = scoped(req);
    const profile = await data.getProfile(req.params.id);
    const result = await runPerformanceSync(data, profile);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
