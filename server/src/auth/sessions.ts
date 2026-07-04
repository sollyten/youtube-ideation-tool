/**
 * DB-backed sessions. The browser holds a random token in an httpOnly cookie;
 * the database stores only its SHA-256 hash, so a DB leak yields no usable
 * sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { CurrentUser } from "../data/scoped.js";

const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = "sid";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: pg.Pool, userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '${SESSION_TTL_DAYS} days')`,
    [hashToken(token), userId],
  );
  return token;
}

export async function destroySession(db: pg.Pool, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/** Resolve a session token to its user, or undefined if invalid/expired. */
export async function resolveSession(db: pg.Pool, token: string): Promise<CurrentUser | undefined> {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0];
}
