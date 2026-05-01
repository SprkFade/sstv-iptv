import { Router } from "express";
import { z } from "zod";
import { getDb, setSetting, setting } from "../db/database.js";
import { refreshGuide } from "../ingest/refresh.js";
import { plexAdminStatus } from "../services/plex.js";

export const adminRouter = Router();

adminRouter.get("/settings", async (_req, res, next) => {
  try {
    res.json({
      m3uUrl: setting("m3u_url"),
      xmltvUrl: setting("xmltv_url"),
      refreshIntervalHours: Number(setting("refresh_interval_hours", "12")),
      plexServerIdentifier: setting("plex_server_identifier"),
      plex: await plexAdminStatus()
    });
  } catch (error) {
    next(error);
  }
});

const settingsSchema = z.object({
  m3uUrl: z.string().url().or(z.literal("")),
  xmltvUrl: z.string().url().or(z.literal("")),
  refreshIntervalHours: z.number().int().min(1).max(168),
  plexServerIdentifier: z.string().optional().default("")
});

adminRouter.put("/settings", (req, res) => {
  const body = settingsSchema.parse(req.body);
  setSetting("m3u_url", body.m3uUrl);
  setSetting("xmltv_url", body.xmltvUrl);
  setSetting("refresh_interval_hours", String(body.refreshIntervalHours));
  setSetting("plex_server_identifier", body.plexServerIdentifier);
  res.json({ ok: true });
});

adminRouter.post("/refresh", async (_req, res, next) => {
  try {
    const result = await refreshGuide();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/refresh-runs", (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, status, started_at, finished_at, channel_count, program_count, matched_count, error
       FROM refresh_runs
       ORDER BY id DESC
       LIMIT 50`
    )
    .all();
  res.json({ runs: rows });
});

adminRouter.get("/users", (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, username, role, auth_provider, plex_user_id, plex_username, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    )
    .all();
  res.json({ users: rows });
});
