import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, destroySession, SESSION_COOKIE } from "../auth/sessions.js";
import { requireAuth, sessionTokenFromRequest } from "../auth/middleware.js";
import { BadRequestError, UnauthorizedError, ConflictError } from "../errors.js";
import { config } from "../config/env.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
const registerSchema = credentialsSchema.extend({ name: z.string().min(1).max(120) });

function setSessionCookie(res: import("express").Response, token: string): void {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`,
  );
}

// The first account created becomes the admin (bootstraps the internal tool);
// everyone after that is a director. Admins can adjust roles later.
authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid input");
    const { email, password, name } = parsed.data;
    const db = getPool();
    const passwordHash = await hashPassword(password);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows: countRows } = await client.query("SELECT count(*)::int AS n FROM users");
      const role = countRows[0].n === 0 ? "admin" : "director";
      const { rows } = await client.query(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, role`,
        [email.toLowerCase(), name, role, passwordHash],
      );
      await client.query("COMMIT");
      if (rows.length === 0) throw new ConflictError("An account with this email already exists");
      const token = await createSession(db, rows[0].id);
      setSessionCookie(res, token);
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid email or password format");
    const { email, password } = parsed.data;
    const db = getPool();
    const { rows } = await db.query(
      "SELECT id, email, name, role, password_hash FROM users WHERE email = $1",
      [email.toLowerCase()],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedError("Incorrect email or password");
    }
    const token = await createSession(db, user.id);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = sessionTokenFromRequest(req);
    if (token) await destroySession(getPool(), token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.currentUser });
});
