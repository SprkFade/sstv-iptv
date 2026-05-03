import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";
import { nowIso } from "../utils/time.js";
import { groupNameSql } from "../services/channelGroups.js";

export const dataRouter = Router();

const channelOrder = `CASE WHEN channels.channel_number IS NULL THEN 1 ELSE 0 END,
       channels.channel_number,
       channels.sort_order,
       channels.display_name COLLATE NOCASE`;
const visibleGroupJoin = `JOIN channel_groups ON channel_groups.name = ${groupNameSql()} AND channel_groups.enabled = 1`;

function channelNameProgram(program: Record<string, unknown>, channel: Record<string, unknown>) {
  if (!channel.use_channel_name_for_epg) return program;
  return {
    ...program,
    title: channel.display_name,
    subtitle: "",
    description: "",
    category: channel.group_title ?? ""
  };
}

dataRouter.get("/channels", (req: AuthedRequest, res) => {
  const group = typeof req.query.group === "string" ? req.query.group : "";
  const favoritesOnly = req.query.favorites === "true";
  const params: unknown[] = [];
  let where = "channels.enabled = 1";

  if (group) {
    where += ` AND ${groupNameSql()} = ?`;
    params.push(group);
  }
  if (favoritesOnly && req.user) {
    where += " AND favorites.user_id = ?";
    params.push(req.user.id);
  }

  const limit = Math.min(500, Math.max(0, Number(req.query.limit ?? 500) || 0));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const channels = limit === 0 ? [] : getDb()
    .prepare(
      `SELECT channels.id, channels.tvg_id, channels.tvg_name, channels.display_name, channels.logo_url, channels.logo_cache_path,
              channels.group_title, channels.stream_url, channels.xmltv_channel_id, channels.channel_number, channels.sort_order, channels.enabled,
              CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM channels
       ${visibleGroupJoin}
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE ${where}
       ORDER BY ${channelOrder}
       LIMIT ? OFFSET ?`
    )
    .all(...(req.user ? [req.user.id] : []), ...params, limit, offset);

  const groups = getDb()
    .prepare(
      `SELECT channel_groups.name AS group_title
       FROM channel_groups
       WHERE channel_groups.enabled = 1
         AND EXISTS (
           SELECT 1 FROM channels
           WHERE channels.enabled = 1 AND ${groupNameSql()} = channel_groups.name
         )
       ORDER BY channel_groups.sort_order, channel_groups.name COLLATE NOCASE`
    )
    .all() as Array<{ group_title: string }>;

  res.json({ channels, groups: groups.map((row) => row.group_title) });
});

dataRouter.get("/guide/current", (req: AuthedRequest, res) => {
  const at = typeof req.query.at === "string" ? new Date(req.query.at).toISOString() : nowIso();
  const start = typeof req.query.start === "string" ? new Date(req.query.start).toISOString() : at;
  const end = typeof req.query.end === "string"
    ? new Date(req.query.end).toISOString()
    : new Date(new Date(at).getTime() + 12 * 60 * 60 * 1000).toISOString();
  const group = typeof req.query.group === "string" ? req.query.group : "";
  const favoritesOnly = req.query.favorites === "true";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25) || 25));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const params: unknown[] = [];
  let where = "channels.enabled = 1";

  if (group) {
    where += ` AND ${groupNameSql()} = ?`;
    params.push(group);
  }
  if (favoritesOnly) {
    if (req.user) where += " AND favorites.user_id IS NOT NULL";
    else where += " AND 1 = 0";
  }

  const rows = getDb()
    .prepare(
      `SELECT channels.id AS channel_id, channels.display_name, channels.logo_url,
              channels.group_title, channels.stream_url, channels.channel_number, channels.sort_order,
              programs.id AS program_id, programs.title, programs.subtitle, programs.description,
              programs.category, programs.start_time, programs.end_time,
              CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite,
              channel_groups.use_channel_name_for_epg
       FROM channels
       ${visibleGroupJoin}
       LEFT JOIN programs ON programs.id = (
        SELECT current_program.id
        FROM programs AS current_program
        WHERE current_program.channel_id = channels.id
          AND current_program.start_time <= ?
          AND current_program.end_time > ?
        ORDER BY current_program.start_time DESC, current_program.end_time ASC, current_program.id
        LIMIT 1
       )
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE ${where}
       ORDER BY ${channelOrder}
       LIMIT ? OFFSET ?`
    )
    .all(...(req.user ? [at, at, req.user.id] : [at, at]), ...params, limit, offset) as Array<Record<string, unknown> & { channel_id: number }>;

  const channelIds = rows.map((row) => row.channel_id);
  const programsByChannel = new Map<number, Array<Record<string, unknown>>>();
  if (channelIds.length > 0) {
    const placeholders = channelIds.map(() => "?").join(",");
    const programs = getDb()
      .prepare(
        `SELECT id, channel_id, title, subtitle, description, category, start_time, end_time
         FROM programs
         WHERE channel_id IN (${placeholders})
           AND end_time > ?
           AND start_time < ?
         ORDER BY channel_id, start_time, end_time, id`
      )
      .all(...channelIds, start, end) as Array<Record<string, unknown> & { channel_id: number }>;
    for (const program of programs) {
      const list = programsByChannel.get(program.channel_id) ?? [];
      list.push(program);
      programsByChannel.set(program.channel_id, list);
    }
  }

  const airing = rows.map((row) => {
    const programs = programsByChannel.get(row.channel_id) ?? [];
    if (programs.length === 0 && row.use_channel_name_for_epg) {
      const fallback = {
        id: -row.channel_id,
        channel_id: row.channel_id,
        title: row.display_name,
        subtitle: "",
        description: "",
        category: row.group_title ?? "",
        start_time: start,
        end_time: end
      };
      return {
        ...row,
        program_id: fallback.id,
        title: fallback.title,
        subtitle: fallback.subtitle,
        description: fallback.description,
        category: fallback.category,
        start_time: fallback.start_time,
        end_time: fallback.end_time,
        programs: [fallback]
      };
    }
    const mappedPrograms = programs.map((program) => channelNameProgram(program, row));
    const currentProgram = row.program_id ? channelNameProgram(row, row) : row;
    return { ...currentProgram, programs: mappedPrograms };
  });

  const total = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM channels
       ${visibleGroupJoin}
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE ${where}`
    )
    .get(...(req.user ? [req.user.id] : []), ...params) as { count: number };

  res.json({ airing, at, start, end, total: total.count, limit, offset, hasMore: offset + rows.length < total.count });
});

dataRouter.get("/guide/channel/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const start = typeof req.query.start === "string" ? new Date(req.query.start).toISOString() : nowIso();
  const end = typeof req.query.end === "string"
    ? new Date(req.query.end).toISOString()
    : new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

  const channel = getDb()
    .prepare(
      `SELECT channels.*, channel_groups.use_channel_name_for_epg,
              CASE WHEN favorites.user_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM channels
       ${visibleGroupJoin}
       LEFT JOIN favorites ON favorites.channel_id = channels.id
        AND favorites.user_id = ${req.user ? "?" : "NULL"}
       WHERE channels.id = ? AND channels.enabled = 1`
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
  if (programs.length === 0 && (channel as { use_channel_name_for_epg?: number }).use_channel_name_for_epg) {
    return res.json({
      channel,
      programs: [{
        id: -id,
        title: (channel as { display_name: string }).display_name,
        subtitle: "",
        description: "",
        category: (channel as { group_title?: string }).group_title ?? "",
        start_time: start,
        end_time: end
      }]
    });
  }
  res.json({
    channel,
    programs: (programs as Array<Record<string, unknown>>).map((program) => channelNameProgram(program, channel as Record<string, unknown>))
  });
});

const searchSchema = z.object({
  q: z.string().min(1).max(100)
});

dataRouter.get("/search", (req: AuthedRequest, res) => {
  const { q } = searchSchema.parse(req.query);
  const like = `%${q}%`;
  const now = nowIso();
  const channels = getDb()
    .prepare(
      `SELECT channels.id, channels.display_name, channels.logo_url, channels.group_title, channels.stream_url,
              channels.channel_number, channels.sort_order,
              (
                SELECT CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.display_name ELSE current_programs.title END
                FROM programs AS current_programs
                WHERE current_programs.channel_id = channels.id
                  AND current_programs.start_time <= ?
                  AND current_programs.end_time > ?
                ORDER BY current_programs.start_time DESC
                LIMIT 1
              ) AS current_title,
              (
                SELECT current_programs.start_time
                FROM programs AS current_programs
                WHERE current_programs.channel_id = channels.id
                  AND current_programs.start_time <= ?
                  AND current_programs.end_time > ?
                ORDER BY current_programs.start_time DESC
                LIMIT 1
              ) AS current_start_time,
              (
                SELECT current_programs.end_time
                FROM programs AS current_programs
                WHERE current_programs.channel_id = channels.id
                  AND current_programs.start_time <= ?
                  AND current_programs.end_time > ?
                ORDER BY current_programs.start_time DESC
                LIMIT 1
              ) AS current_end_time
       FROM channels
       ${visibleGroupJoin}
       WHERE channels.enabled = 1 AND (display_name LIKE ? OR tvg_name LIKE ? OR group_title LIKE ?)
       ORDER BY CASE WHEN channels.channel_number IS NULL THEN 1 ELSE 0 END,
                channels.channel_number, channels.sort_order, channels.display_name COLLATE NOCASE
       LIMIT 40`
    )
    .all(now, now, now, now, now, now, like, like, like);
  const programs = getDb()
    .prepare(
      `SELECT programs.id,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.display_name ELSE programs.title END AS title,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN '' ELSE programs.subtitle END AS subtitle,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.group_title ELSE programs.category END AS category,
              programs.start_time, programs.end_time, channels.id AS channel_id,
              channels.display_name AS channel_name, channels.logo_url
       FROM programs
       JOIN channels ON channels.id = programs.channel_id
       ${visibleGroupJoin}
       WHERE channels.enabled = 1 AND programs.end_time >= ?
         AND (programs.title LIKE ? OR programs.subtitle LIKE ? OR programs.description LIKE ? OR programs.category LIKE ? OR channels.display_name LIKE ?)
       ORDER BY programs.start_time
       LIMIT 60`
    )
    .all(now, like, like, like, like, like);

  res.json({ channels, programs });
});
