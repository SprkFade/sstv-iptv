import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "../db/database.js";
import { clearSession, createSession, requireAuth } from "../auth/session.js";
import type { AuthedRequest } from "../types/app.js";
import { createPlexPin, getPlexUser, pollPlexPin, verifyPlexServerAccess } from "../services/plex.js";

export const authRouter = Router();

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

authRouter.post("/admin/login", (req, res) => {
  const body = adminLoginSchema.parse(req.body);
  const admin = getDb()
    .prepare("SELECT id, username, password_hash FROM users WHERE auth_provider = 'local' AND role = 'admin'")
    .get() as { id: number; username: string; password_hash: string } | undefined;

  if (!admin || admin.username !== body.username || !bcrypt.compareSync(body.password, admin.password_hash)) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  createSession(res, admin.id);
  return res.json({ ok: true });
});

authRouter.post("/logout", requireAuth, (req: AuthedRequest, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", (req: AuthedRequest, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post("/plex/pin", async (_req, res, next) => {
  try {
    res.json(await createPlexPin());
  } catch (error) {
    next(error);
  }
});

authRouter.get("/plex/pin/:id", async (req, res, next) => {
  try {
    const pin = await pollPlexPin(req.params.id);
    if (!pin.authToken) return res.json({ authenticated: false });

    const hasAccess = await verifyPlexServerAccess(pin.authToken);
    if (!hasAccess) return res.status(403).json({ error: "Plex account does not have access to the configured server." });

    const plexUser = await getPlexUser(pin.authToken);
    const username = plexUser.username || plexUser.title || plexUser.email || `plex-${plexUser.id}`;
    const result = getDb()
      .prepare(
        `INSERT INTO users (username, role, auth_provider, plex_user_id, plex_username)
         VALUES (?, 'user', 'plex', ?, ?)
         ON CONFLICT(plex_user_id) DO UPDATE SET
           username = excluded.username,
           plex_username = excluded.plex_username,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(username, String(plexUser.id), username);

    const user = getDb()
      .prepare("SELECT id FROM users WHERE plex_user_id = ?")
      .get(String(plexUser.id)) as { id: number } | undefined;
    createSession(res, user?.id ?? Number(result.lastInsertRowid));
    res.json({ authenticated: true });
  } catch (error) {
    next(error);
  }
});
