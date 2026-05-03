import { Router } from "express";
import { z } from "zod";
import { getDb, setSetting, setting } from "../db/database.js";
import { getRefreshProgress, startRefreshGuide } from "../ingest/refresh.js";
import { plexAdminStatus } from "../services/plex.js";
import { applyDefaultGroupSort, groupNameSql, listChannelGroups, listGroupPrefixes, recalculateChannelNumbers, saveDefaultGroupPrefixOrder } from "../services/channelGroups.js";
import { getActiveStreamMonitor, listStreamConnectionLogs } from "./stream.js";
import { listExternalProfiles, regenerateExternalToken, regenerateExternalXcPassword, updateExternalProfile } from "../services/externalAccess.js";
import { embyStatus, listEmbySessions, listEmbyTasks, triggerEmbyGuideRefresh } from "../services/emby.js";
import {
  createProviderProfile,
  deleteProviderProfile,
  listProviderProfiles,
  refreshProviderAccount,
  syncPrimaryProviderProfile,
  updateProviderProfile
} from "../services/providerProfiles.js";

export const adminRouter = Router();

adminRouter.get("/settings", async (_req, res, next) => {
  try {
    res.json({
      xcBaseUrl: setting("xc_base_url"),
      xcUsername: setting("xc_username"),
      xcPasswordSet: Boolean(setting("xc_password")),
      xmltvUrl: setting("xmltv_url"),
      refreshIntervalHours: Number(setting("refresh_interval_hours", "12")),
      refreshScheduleTimes: setting("refresh_schedule_times", "")
        .split(",")
        .map((time) => time.trim())
        .filter(Boolean),
      serverTime: new Date().toISOString(),
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      plexServerIdentifier: setting("plex_server_identifier"),
      ffmpegHlsInputMode: setting("ffmpeg_hls_input_mode", "direct"),
      ffmpegReconnectDelayMax: Number(setting("ffmpeg_reconnect_delay_max", "5")),
      ffmpegRwTimeoutSeconds: Number(setting("ffmpeg_rw_timeout_seconds", "15")),
      ffmpegStaleRestartSeconds: Number(setting("ffmpeg_stale_restart_seconds", "30")),
      ffmpegHlsDvrWindowMinutes: Number(setting("ffmpeg_hls_dvr_window_minutes", "20")),
      externalInternalBaseUrl: setting("external_internal_base_url", "http://sstv-iptv:3025"),
      externalPublicBaseUrl: setting("external_public_base_url"),
      externalProfiles: listExternalProfiles(),
      providerProfiles: listProviderProfiles(),
      emby: embyStatus(),
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
  refreshScheduleTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24).optional().default([]),
  plexServerIdentifier: z.string().optional().default(""),
  ffmpegHlsInputMode: z.enum(["direct", "pipe"]).optional().default("direct"),
  ffmpegReconnectDelayMax: z.number().int().min(1).max(60).optional().default(5),
  ffmpegRwTimeoutSeconds: z.number().int().min(5).max(120).optional().default(15),
  ffmpegStaleRestartSeconds: z.number().int().min(0).max(300).optional().default(30),
  ffmpegHlsDvrWindowMinutes: z.number().int().min(0).max(60).optional().default(20),
  externalInternalBaseUrl: z.string().url().or(z.literal("")).optional().default(""),
  externalPublicBaseUrl: z.string().url().or(z.literal("")).optional().default(""),
  embyEnabled: z.boolean().optional().default(false),
  embyBaseUrl: z.string().url().or(z.literal("")).optional().default(""),
  embyApiKey: z.string().max(500).optional().default(""),
  embyRefreshAfterProviderRefresh: z.boolean().optional().default(true),
  embyRefreshTaskId: z.string().max(200).optional().default(""),
  embyRefreshTaskName: z.string().max(300).optional().default("")
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

const externalProfileUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  outputMode: z.enum(["hls", "mpegts"]).optional(),
  xcUsername: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/).optional()
});

const providerProfileUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  maxConnections: z.number().int().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  password: z.string().max(500).optional(),
  username: z.string().trim().min(1).max(200).optional()
});

const providerProfileCreateSchema = z.object({
  maxConnections: z.number().int().min(1).max(100).optional().default(1),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(500),
  username: z.string().trim().min(1).max(200)
});

adminRouter.put("/settings", (req, res) => {
  const body = settingsSchema.parse(req.body);
  setSetting("xc_base_url", body.xcBaseUrl);
  setSetting("xc_username", body.xcUsername);
  if (body.xcPassword) setSetting("xc_password", body.xcPassword);
  syncPrimaryProviderProfile(body.xcUsername, body.xcPassword || undefined);
  setSetting("xmltv_url", body.xmltvUrl);
  setSetting("refresh_interval_hours", String(body.refreshIntervalHours));
  setSetting("refresh_schedule_times", Array.from(new Set(body.refreshScheduleTimes)).sort().join(","));
  setSetting("plex_server_identifier", body.plexServerIdentifier);
  setSetting("ffmpeg_hls_input_mode", body.ffmpegHlsInputMode);
  setSetting("ffmpeg_reconnect_delay_max", String(body.ffmpegReconnectDelayMax));
  setSetting("ffmpeg_rw_timeout_seconds", String(body.ffmpegRwTimeoutSeconds));
  setSetting("ffmpeg_stale_restart_seconds", String(body.ffmpegStaleRestartSeconds));
  setSetting("ffmpeg_hls_dvr_window_minutes", String(body.ffmpegHlsDvrWindowMinutes));
  setSetting("external_internal_base_url", body.externalInternalBaseUrl);
  setSetting("external_public_base_url", body.externalPublicBaseUrl);
  setSetting("emby_enabled", String(body.embyEnabled));
  setSetting("emby_base_url", body.embyBaseUrl);
  if (body.embyApiKey) setSetting("emby_api_key", body.embyApiKey);
  setSetting("emby_refresh_after_provider_refresh", String(body.embyRefreshAfterProviderRefresh));
  setSetting("emby_refresh_task_id", body.embyRefreshTaskId);
  setSetting("emby_refresh_task_name", body.embyRefreshTaskName);
  res.json({ ok: true });
});

adminRouter.get("/emby/tasks", async (_req, res, next) => {
  try {
    res.json(await listEmbyTasks());
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/emby/sessions", async (_req, res, next) => {
  try {
    res.json(await listEmbySessions());
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/emby/trigger", async (_req, res, next) => {
  try {
    res.json(await triggerEmbyGuideRefresh());
  } catch (error) {
    next(error);
  }
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
      `SELECT id, status, started_at, finished_at,
              MAX(0, unixepoch(COALESCE(finished_at, CURRENT_TIMESTAMP)) - unixepoch(started_at)) AS duration_seconds,
              channel_count, program_count, matched_count, error
       FROM refresh_runs
       ORDER BY id DESC
       LIMIT 50`
    )
    .all();
  res.json({ runs: rows });
});

adminRouter.get("/epg-diagnostics", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `WITH tvg_counts AS (
         SELECT tvg_id, COUNT(*) AS count
         FROM channels
         WHERE enabled = 1 AND tvg_id IS NOT NULL AND tvg_id != ''
         GROUP BY tvg_id
       ),
       xmltv_counts AS (
         SELECT xmltv_channel_id, COUNT(*) AS count
         FROM channels
         WHERE enabled = 1 AND xmltv_channel_id IS NOT NULL AND xmltv_channel_id != ''
         GROUP BY xmltv_channel_id
       )
       SELECT channels.id,
              channels.source_id,
              channels.tvg_id,
              channels.tvg_name,
              channels.display_name,
              channels.group_title,
              channels.channel_number,
              channels.xmltv_channel_id,
              channels.xmltv_match_method,
              channels.xmltv_match_score,
              channels.xmltv_match_name,
              channels.xmltv_candidate_id,
              channels.xmltv_candidate_score,
              channels.xmltv_candidate_gap,
              channels.xmltv_candidate_name,
              COALESCE(channel_groups.enabled, 0) AS group_enabled,
              COALESCE(tvg_counts.count, 0) AS tvg_id_count,
              COALESCE(xmltv_counts.count, 0) AS xmltv_id_count
       FROM channels
       LEFT JOIN channel_groups ON channel_groups.name = ${groupNameSql()}
       LEFT JOIN tvg_counts ON tvg_counts.tvg_id = channels.tvg_id
       LEFT JOIN xmltv_counts ON xmltv_counts.xmltv_channel_id = channels.xmltv_channel_id
       WHERE channels.enabled = 1
       ORDER BY CASE WHEN channels.channel_number IS NULL THEN 1 ELSE 0 END,
                channels.channel_number,
                channels.sort_order,
                channels.display_name COLLATE NOCASE`
    )
    .all() as Array<Record<string, string | number | null>>;

  const diagnostics = rows.map((row) => {
    const warnings: string[] = [];
    const method = String(row.xmltv_match_method ?? "");
    const score = Number(row.xmltv_match_score ?? 0);
    if (!row.xmltv_channel_id) warnings.push("unmatched");
    if (!row.xmltv_channel_id && row.xmltv_candidate_id) warnings.push("fuzzy candidate rejected");
    if (!row.tvg_id) warnings.push("missing provider EPG id");
    if (row.tvg_id && method && method !== "tvg-id") warnings.push("provider EPG id did not match XMLTV id");
    if (method === "fuzzy") warnings.push(score < 0.9 ? "low confidence fuzzy match" : "fuzzy match");
    if (Number(row.tvg_id_count ?? 0) > 1) warnings.push("duplicate provider EPG id");
    if (Number(row.xmltv_id_count ?? 0) > 1) warnings.push("shared XMLTV id");
    if (!row.group_enabled) warnings.push("hidden group");
    return { ...row, warnings };
  });

  res.json({ diagnostics });
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

type StreamMonitor = ReturnType<typeof getActiveStreamMonitor>;
type StreamMonitorStream = StreamMonitor["streams"][number];
type StreamMonitorClient = StreamMonitorStream["clients"][number];
type EmbySession = Awaited<ReturnType<typeof listEmbySessions>>["sessions"][number];

function embyRemoteIp(remoteEndPoint: string) {
  const value = remoteEndPoint.trim();
  if (!value) return "";
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) return ipv4WithPort[1];
  return value;
}

function embyClientLabel(session: EmbySession) {
  return [session.client, session.deviceName, session.deviceId ? `Device ${session.deviceId}` : ""]
    .filter(Boolean)
    .join(" / ");
}

function embyDisplayClient(session: EmbySession, baseClient: StreamMonitorClient | undefined, index: number, total: number): StreamMonitorClient {
  const lastActivityTime = Date.parse(session.lastActivityDate);
  const lastSeenTime = Number.isFinite(lastActivityTime) ? lastActivityTime : Date.now();
  const share = Math.max(1, total);
  return {
    id: session.id ? `emby-${session.id}` : `emby-${session.userId || session.deviceId || index}`,
    bytesServed: baseClient ? Math.floor(baseClient.bytesServed / share) : 0,
    externalProfileId: baseClient?.externalProfileId ?? null,
    externalProfileName: baseClient?.externalProfileName ?? "Emby",
    firstSeen: baseClient?.firstSeen ?? new Date(lastSeenTime).toISOString(),
    ip: embyRemoteIp(session.remoteEndPoint) || baseClient?.ip || "unknown",
    lastPlaylistAt: baseClient?.lastPlaylistAt ?? null,
    lastRequestKind: baseClient?.lastRequestKind ?? "stream",
    lastSeen: new Date(lastSeenTime).toISOString(),
    lastSeenAgeMs: Math.max(0, Date.now() - lastSeenTime),
    lastSegmentAt: baseClient?.lastSegmentAt ?? null,
    lastSegmentName: baseClient?.lastSegmentName ?? "",
    playlistRequests: baseClient ? Math.floor(baseClient.playlistRequests / share) : 0,
    providerProfileId: baseClient?.providerProfileId ?? null,
    providerProfileName: baseClient?.providerProfileName ?? null,
    providerProfileUsername: baseClient?.providerProfileUsername ?? null,
    role: "emby",
    segmentRequests: baseClient ? Math.floor(baseClient.segmentRequests / share) : 0,
    source: "external",
    userAgent: embyClientLabel(session) || baseClient?.userAgent || "Emby",
    userId: null,
    username: session.userName || session.userId || baseClient?.username || "Emby user"
  };
}

function withEmbyDisplayClients(stream: StreamMonitorStream, embySessions: EmbySession[]) {
  const matchingSessions = embySessions.filter((session) => session.nowPlaying?.sstvChannelId === stream.channelId);
  if (matchingSessions.length === 0) {
    return { ...stream, embySessions: matchingSessions };
  }

  const embyBaseClients = stream.clients.filter((client) => client.externalProfileName?.toLowerCase() === "emby");
  if (embyBaseClients.length === 0) {
    return { ...stream, embySessions: matchingSessions };
  }

  const nonEmbyClients = stream.clients.filter((client) => client.externalProfileName?.toLowerCase() !== "emby");
  const embyClients = matchingSessions.map((session, index) => embyDisplayClient(session, embyBaseClients[index] ?? embyBaseClients[0], index, matchingSessions.length));
  const clients = [...embyClients, ...nonEmbyClients].sort((a, b) => a.lastSeenAgeMs - b.lastSeenAgeMs);

  return {
    ...stream,
    clients,
    clientCount: clients.length,
    embySessions: matchingSessions
  };
}

adminRouter.get("/streams", async (_req, res) => {
  const monitor = getActiveStreamMonitor();
  const status = embyStatus();
  let embySessions: Awaited<ReturnType<typeof listEmbySessions>>["sessions"] = [];
  let embySessionError = "";

  if (status.enabled && status.configured) {
    try {
      const snapshot = await listEmbySessions();
      embySessions = snapshot.sessions;
    } catch (error) {
      embySessionError = error instanceof Error ? error.message : String(error);
    }
  }
  const streams = monitor.streams.map((stream) => withEmbyDisplayClients(stream, embySessions));

  res.json({
    ...monitor,
    activeClientCount: streams.reduce((total, stream) => total + stream.clientCount, 0),
    streams,
    connectionLogs: listStreamConnectionLogs(),
    embySessions,
    embySessionError
  });
});

adminRouter.get("/external-profiles", (_req, res) => {
  res.json({ profiles: listExternalProfiles() });
});

adminRouter.put("/external-profiles/:id", (req, res) => {
  const id = Number(req.params.id);
  const body = externalProfileUpdateSchema.parse(req.body);
  const profile = updateExternalProfile(id, body);
  if (!profile) return res.status(404).json({ error: "External profile not found" });
  res.json({ profile, profiles: listExternalProfiles() });
});

adminRouter.post("/external-profiles/:id/regenerate-token", (req, res) => {
  const profile = regenerateExternalToken(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: "External profile not found" });
  res.json({ profile, profiles: listExternalProfiles() });
});

adminRouter.post("/external-profiles/:id/regenerate-password", (req, res) => {
  const profile = regenerateExternalXcPassword(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: "External profile not found" });
  res.json({ profile, profiles: listExternalProfiles() });
});

adminRouter.get("/provider-profiles", (_req, res) => {
  res.json({ profiles: listProviderProfiles() });
});

adminRouter.post("/provider-profiles", (req, res) => {
  const body = providerProfileCreateSchema.parse(req.body);
  const profile = createProviderProfile(body);
  res.status(201).json({ profile, profiles: listProviderProfiles() });
});

adminRouter.put("/provider-profiles/:id", (req, res) => {
  const id = Number(req.params.id);
  const body = providerProfileUpdateSchema.parse(req.body);
  const profile = updateProviderProfile(id, body);
  if (!profile) return res.status(404).json({ error: "Provider profile not found" });
  res.json({ profile, profiles: listProviderProfiles() });
});

adminRouter.delete("/provider-profiles/:id", (req, res) => {
  const deleted = deleteProviderProfile(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Provider profile not found or cannot be deleted" });
  res.json({ ok: true, profiles: listProviderProfiles() });
});

adminRouter.post("/provider-profiles/:id/check", async (req, res, next) => {
  try {
    const profile = await refreshProviderAccount(Number(req.params.id));
    if (!profile) return res.status(404).json({ error: "Provider profile not found" });
    res.json({ profile, profiles: listProviderProfiles() });
  } catch (error) {
    next(error);
  }
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

adminRouter.get("/groups/:id/channels", (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const group = db.prepare("SELECT id, name FROM channel_groups WHERE id = ?").get(id) as { id: number; name: string } | undefined;
  if (!group) return res.status(404).json({ error: "Group not found" });

  const channels = db
    .prepare(
      `SELECT id, display_name, logo_url, group_title, stream_url, channel_number, sort_order
       FROM channels
       WHERE enabled = 1 AND ${groupNameSql()} = ?
       ORDER BY
         CASE WHEN channel_number IS NULL THEN 1 ELSE 0 END,
         channel_number,
         display_name COLLATE NOCASE`
    )
    .all(group.name);

  res.json({ group, channels });
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
