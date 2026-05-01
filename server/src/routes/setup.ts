import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb, isSetupComplete, setSetting, setting } from "../db/database.js";
import { createSession } from "../auth/session.js";
import { createPlexPin, getPlexResources, getPlexUser, pollPlexPin } from "../services/plex.js";

export const setupRouter = Router();

function guardSetup(_req: Request, res: Response, next: NextFunction) {
  if (isSetupComplete()) return res.status(409).json({ error: "Setup is already complete." });
  next();
}

setupRouter.get("/status", (_req, res) => {
  res.json({ setupRequired: !isSetupComplete() });
});

setupRouter.get("/defaults", guardSetup, (_req, res) => {
  res.json({
    xcBaseUrl: setting("xc_base_url"),
    xcUsername: setting("xc_username"),
    xmltvUrl: setting("xmltv_url"),
    refreshIntervalHours: Number(setting("refresh_interval_hours", "12")),
    plexProductName: setting("plex_product_name", "SSTV IPTV")
  });
});

setupRouter.post("/plex/pin", guardSetup, async (_req, res, next) => {
  try {
    res.json(await createPlexPin());
  } catch (error) {
    next(error);
  }
});

setupRouter.get("/plex/pin/:id", guardSetup, async (req, res, next) => {
  try {
    const pin = await pollPlexPin(String(req.params.id));
    if (!pin.authToken) return res.json({ authenticated: false });

    const [plexUser, resources] = await Promise.all([
      getPlexUser(pin.authToken),
      getPlexResources(pin.authToken)
    ]);

    const servers = resources
      .filter((resource) => resource.provides?.split(",").includes("server"))
      .map((resource) => ({
        name: resource.name ?? "Plex Server",
        product: resource.product ?? "",
        clientIdentifier: resource.clientIdentifier ?? "",
        owned: Boolean(resource.owned)
      }))
      .filter((resource) => resource.clientIdentifier);

    res.json({
      authenticated: true,
      token: pin.authToken,
      user: {
        id: plexUser.id,
        username: plexUser.username || plexUser.title || plexUser.email || `plex-${plexUser.id}`
      },
      servers
    });
  } catch (error) {
    next(error);
  }
});

const completeSchema = z.object({
  adminUsername: z.string().min(3).max(80),
  adminPassword: z.string().min(8).max(200),
  xcBaseUrl: z.string().url(),
  xcUsername: z.string().min(1).max(200),
  xcPassword: z.string().min(1).max(500),
  xmltvUrl: z.string().url().or(z.literal("")),
  refreshIntervalHours: z.number().int().min(1).max(168),
  plexToken: z.string().optional().default(""),
  plexServerIdentifier: z.string().optional().default(""),
  plexServerName: z.string().optional().default("")
}).refine((body) => Boolean(body.plexToken) === Boolean(body.plexServerIdentifier), {
  message: "Choose a Plex server after signing in, or leave Plex unconfigured.",
  path: ["plexServerIdentifier"]
});

setupRouter.post("/complete", guardSetup, async (req, res, next) => {
  try {
    const body = completeSchema.parse(req.body);

    if (body.plexToken && body.plexServerIdentifier) {
      const resources = await getPlexResources(body.plexToken);
      const hasServer = resources.some((resource) => resource.clientIdentifier === body.plexServerIdentifier);
      if (!hasServer) return res.status(400).json({ error: "Selected Plex server is not available to this Plex account." });
    }

    const db = getDb();
    const adminId = db.transaction(() => {
      const passwordHash = bcrypt.hashSync(body.adminPassword, 12);
      const existing = db
        .prepare("SELECT id FROM users WHERE auth_provider = 'local' AND role = 'admin' LIMIT 1")
        .get() as { id: number } | undefined;

      const id = existing
        ? (db
          .prepare("UPDATE users SET username = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(body.adminUsername, passwordHash, existing.id), existing.id)
        : Number(db
          .prepare("INSERT INTO users (username, role, auth_provider, password_hash) VALUES (?, 'admin', 'local', ?)")
          .run(body.adminUsername, passwordHash).lastInsertRowid);

      setSetting("xc_base_url", body.xcBaseUrl);
      setSetting("xc_username", body.xcUsername);
      setSetting("xc_password", body.xcPassword);
      setSetting("xmltv_url", body.xmltvUrl);
      setSetting("refresh_interval_hours", String(body.refreshIntervalHours));
      setSetting("plex_token", body.plexToken);
      setSetting("plex_server_identifier", body.plexServerIdentifier);
      setSetting("plex_server_name", body.plexServerName);
      setSetting("setup_complete", "true");
      return id;
    })();

    createSession(res, adminId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
