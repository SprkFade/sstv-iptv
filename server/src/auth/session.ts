import crypto from "node:crypto";
import type { NextFunction, Response } from "express";
import { getDb } from "../db/database.js";
import { addDaysIso, nowIso } from "../utils/time.js";
import type { AuthUser, AuthedRequest } from "../types/app.js";
import { config } from "../config.js";

const cookieName = "sstv_iptv_sid";

export function createSession(res: Response, userId: number) {
  const sid = crypto.randomBytes(32).toString("base64url");
  const expiresAt = addDaysIso(30);
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sid, userId, expiresAt);
  res.cookie(cookieName, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSession(req: AuthedRequest, res: Response) {
  const sid = req.cookies?.[cookieName];
  if (sid) getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  res.clearCookie(cookieName, { path: "/" });
}

export function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  const sid = req.cookies?.[cookieName];
  if (!sid) return next();

  const row = getDb()
    .prepare(
      `SELECT users.id, users.username, users.role, users.auth_provider,
              users.plex_user_id, users.plex_username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > ?`
    )
    .get(sid, nowIso()) as AuthUser | undefined;

  if (row) req.user = row;
  else getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
