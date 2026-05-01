import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";
import { nowIso } from "../utils/time.js";

export const dataRouter = Router();

dataRouter.get("/channels", (req: AuthedRequest, res) => {
  const group = typeof req.query.group === "string" ? req.query.group : "";
  const favoritesOnly = req.query.favorites === "true";
  const params: unknown[] = [];
  let where = "channels.enabled = 1";

  if (group) {
    where += " AND channels.group_title = ?";
    params.push(group);
  }
  if (favoritesOnly && req.user) {
    where += " AND favorites.user_id = ?";
    params.push(req.user.id);
  }

  const channels = getDb()
    .prepare(
      `SELECT channels.id, tvg_id, tvg_name, display_name, logo_url, logo_cache_path,
              group_title, stream_url, xmltv_channel_id, enabled,
              CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM channels
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE ${where}
       ORDER BY group_title COLLATE NOCASE, display_name COLLATE NOCASE`
    )
    .all(...(req.user ? [req.user.id] : []), ...params);

  const groups = getDb()
    .prepare("SELECT DISTINCT group_title FROM channels WHERE enabled = 1 AND group_title != '' ORDER BY group_title")
    .all() as Array<{ group_title: string }>;

  res.json({ channels, groups: groups.map((row) => row.group_title) });
});

dataRouter.get("/guide/current", (req: AuthedRequest, res) => {
  const at = typeof req.query.at === "string" ? new Date(req.query.at).toISOString() : nowIso();
  const rows = getDb()
    .prepare(
      `SELECT channels.id AS channel_id, channels.display_name, channels.logo_url, channels.group_title,
              channels.stream_url,
              programs.id AS program_id, programs.title, programs.subtitle, programs.description,
              programs.category, programs.start_time, programs.end_time,
              CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM channels
       LEFT JOIN programs ON programs.channel_id = channels.id
        AND programs.start_time <= ? AND programs.end_time > ?
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE channels.enabled = 1
       ORDER BY channels.group_title COLLATE NOCASE, channels.display_name COLLATE NOCASE`
    )
    .all(...(req.user ? [at, at, req.user.id] : [at, at]));
  res.json({ airing: rows, at });
});

dataRouter.get("/guide/channel/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const start = typeof req.query.start === "string" ? new Date(req.query.start).toISOString() : nowIso();
  const end = typeof req.query.end === "string"
    ? new Date(req.query.end).toISOString()
    : new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

  const channel = getDb()
    .prepare(
      `SELECT channels.*, CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM channels
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE channels.id = ? AND enabled = 1`
    )
    .get(...(req.user ? [req.user.id, id] : [id]));

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const programs = getDb()
    .prepare(
      `SELECT id, title, subtitle, description, category, start_time, end_time
       FROM programs
       WHERE channel_id = ? AND end_time >= ? AND start_time <= ?
       ORDER BY start_time`
    )
    .all(id, start, end);
  res.json({ channel, programs });
});

const searchSchema = z.object({
  q: z.string().min(1).max(100)
});

dataRouter.get("/search", (req: AuthedRequest, res) => {
  const { q } = searchSchema.parse(req.query);
  const like = `%${q}%`;
  const channels = getDb()
    .prepare(
      `SELECT id, display_name, logo_url, group_title, stream_url
       FROM channels
       WHERE enabled = 1 AND (display_name LIKE ? OR tvg_name LIKE ? OR group_title LIKE ?)
       ORDER BY display_name COLLATE NOCASE
       LIMIT 40`
    )
    .all(like, like, like);
  const programs = getDb()
    .prepare(
      `SELECT programs.id, programs.title, programs.subtitle, programs.category,
              programs.start_time, programs.end_time, channels.id AS channel_id,
              channels.display_name AS channel_name, channels.logo_url
       FROM programs
       JOIN channels ON channels.id = programs.channel_id
       WHERE channels.enabled = 1 AND programs.end_time >= ?
         AND (programs.title LIKE ? OR programs.subtitle LIKE ? OR programs.description LIKE ? OR programs.category LIKE ?)
       ORDER BY programs.start_time
       LIMIT 60`
    )
    .all(nowIso(), like, like, like, like);

  res.json({ channels, programs });
});
