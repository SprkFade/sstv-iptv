import { Router } from "express";
import { z } from "zod";
import { getDb, setSetting, setting } from "../db/database.js";
import { getRefreshProgress, startRefreshGuide } from "../ingest/refresh.js";
import { plexAdminStatus } from "../services/plex.js";
import { applyDefaultGroupSort, listChannelGroups, listGroupPrefixes, recalculateChannelNumbers, saveDefaultGroupPrefixOrder } from "../services/channelGroups.js";
import { getActiveStreamMonitor } from "./stream.js";

export const adminRouter = Router();

adminRouter.get("/settings", async (_req, res, next) => {
  try {
    res.json({
      xcBaseUrl: setting("xc_base_url"),
      xcUsername: setting("xc_username"),
      xcPasswordSet: Boolean(setting("xc_password")),
      xmltvUrl: setting("xmltv_url"),
      refreshIntervalHours: Number(setting("refresh_interval_hours", "12")),
      plexServerIdentifier: setting("plex_server_identifier"),
      ffmpegHlsInputMode: setting("ffmpeg_hls_input_mode", "direct"),
      ffmpegReconnectDelayMax: Number(setting("ffmpeg_reconnect_delay_max", "5")),
      ffmpegRwTimeoutSeconds: Number(setting("ffmpeg_rw_timeout_seconds", "15")),
      ffmpegStaleRestartSeconds: Number(setting("ffmpeg_stale_restart_seconds", "30")),
      plex: await plexAdminStatus()
    });
  } catch (error) {
    next(error);
  }
});

const settingsSchema = z.object({
  xcBaseUrl: z.string().url().or(z.literal("")),
  xcUsername: z.string().max(200).optional().default(""),
  xcPassword: z.string().max(500).optional().default(""),
  xmltvUrl: z.string().url().or(z.literal("")),
  refreshIntervalHours: z.number().int().min(1).max(168),
  plexServerIdentifier: z.string().optional().default(""),
  ffmpegHlsInputMode: z.enum(["direct", "pipe"]).optional().default("direct"),
  ffmpegReconnectDelayMax: z.number().int().min(1).max(60).optional().default(5),
  ffmpegRwTimeoutSeconds: z.number().int().min(5).max(120).optional().default(15),
  ffmpegStaleRestartSeconds: z.number().int().min(0).max(300).optional().default(30)
});

const groupUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  useChannelNameForEpg: z.boolean().optional()
});

const groupOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1)
});

const groupPrefixOrderSchema = z.object({
  prefixes: z.array(z.string().trim().min(1).max(24)).min(1)
});

adminRouter.put("/settings", (req, res) => {
  const body = settingsSchema.parse(req.body);
  setSetting("xc_base_url", body.xcBaseUrl);
  setSetting("xc_username", body.xcUsername);
  if (body.xcPassword) setSetting("xc_password", body.xcPassword);
  setSetting("xmltv_url", body.xmltvUrl);
  setSetting("refresh_interval_hours", String(body.refreshIntervalHours));
  setSetting("plex_server_identifier", body.plexServerIdentifier);
  setSetting("ffmpeg_hls_input_mode", body.ffmpegHlsInputMode);
  setSetting("ffmpeg_reconnect_delay_max", String(body.ffmpegReconnectDelayMax));
  setSetting("ffmpeg_rw_timeout_seconds", String(body.ffmpegRwTimeoutSeconds));
  setSetting("ffmpeg_stale_restart_seconds", String(body.ffmpegStaleRestartSeconds));
  res.json({ ok: true });
});

adminRouter.post("/refresh", async (_req, res, next) => {
  try {
    const result = startRefreshGuide();
    res.status(result.started ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/refresh-status", (_req, res) => {
  res.json(getRefreshProgress());
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

adminRouter.get("/streams", (_req, res) => {
  res.json(getActiveStreamMonitor());
});

adminRouter.get("/groups", (_req, res) => {
  res.json({ groups: listChannelGroups(getDb()) });
});

adminRouter.put("/groups/order", (req, res) => {
  const body = groupOrderSchema.parse(req.body);
  const db = getDb();
  db.transaction(() => {
    const update = db.prepare("UPDATE channel_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    body.ids.forEach((id, index) => update.run(index, id));
    recalculateChannelNumbers(db);
  })();
  res.json({ groups: listChannelGroups(db) });
});

adminRouter.post("/groups/recalculate", (_req, res) => {
  const db = getDb();
  db.transaction(() => recalculateChannelNumbers(db))();
  res.json({ groups: listChannelGroups(db) });
});

adminRouter.get("/groups/default-sort", (_req, res) => {
  res.json(listGroupPrefixes(getDb()));
});

adminRouter.post("/groups/default-sort", (_req, res) => {
  const db = getDb();
  db.transaction(() => applyDefaultGroupSort(db))();
  res.json({ groups: listChannelGroups(db) });
});

adminRouter.put("/groups/default-sort", (req, res) => {
  const body = groupPrefixOrderSchema.parse(req.body);
  const db = getDb();
  db.transaction(() => saveDefaultGroupPrefixOrder(db, body.prefixes))();
  res.json({ groups: listChannelGroups(db), ...listGroupPrefixes(db) });
});

adminRouter.put("/groups/:id", (req, res) => {
  const id = Number(req.params.id);
  const body = groupUpdateSchema.parse(req.body);
  const existing = getDb().prepare("SELECT id FROM channel_groups WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Group not found" });

  const db = getDb();
  db.transaction(() => {
    if (typeof body.enabled === "boolean") {
      db.prepare("UPDATE channel_groups SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(body.enabled ? 1 : 0, id);
      recalculateChannelNumbers(db);
    }
    if (typeof body.useChannelNameForEpg === "boolean") {
      db.prepare("UPDATE channel_groups SET use_channel_name_for_epg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(body.useChannelNameForEpg ? 1 : 0, id);
    }
  })();

  res.json({ groups: listChannelGroups(db) });
});
