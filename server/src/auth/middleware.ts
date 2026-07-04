/**
 * Identity resolution. getCurrentUser() is the ONLY place identity is read —
 * every route handler receives its user (and its user-scoped data layer)
 * through requireAuth, and nothing else looks at cookies or session state.
 */
import type { NextFunction, Request, Response } from "express";
import { getPool } from "../db/pool.js";
import { ScopedData, type CurrentUser } from "../data/scoped.js";
import { resolveSession, SESSION_COOKIE } from "./sessions.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";

declare module "express-serve-static-core" {
  interface Request {
    currentUser?: CurrentUser;
    scoped?: ScopedData;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionTokenFromRequest(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE);
}

/** Single point of identity resolution for the whole app. */
export async function getCurrentUser(req: Request): Promise<CurrentUser | undefined> {
  if (req.currentUser) return req.currentUser;
  const token = sessionTokenFromRequest(req);
  if (!token) return undefined;
  return resolveSession(getPool(), token);
}

/** Auth guard applied to every /api route except login/register. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getCurrentUser(req);
    if (!user) throw new UnauthorizedError();
    req.currentUser = user;
    req.scoped = new ScopedData(getPool(), user);
    next();
  } catch (err) {
    next(err);
  }
}

/** Role guard for admin-only routes (company keys, usage view). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.currentUser?.role !== "admin") {
    next(new ForbiddenError("Admin access required"));
    return;
  }
  next();
}

/** Convenience accessors that make missing-guard bugs loud. */
export function scoped(req: Request): ScopedData {
  if (!req.scoped) throw new UnauthorizedError("Route is missing the requireAuth guard");
  return req.scoped;
}
