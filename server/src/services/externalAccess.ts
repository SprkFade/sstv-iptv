import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db/database.js";
import { groupNameSql } from "./channelGroups.js";
import type { ExternalProfile } from "../types/app.js";

export type ExternalChannel = {
  id: number;
  tvg_id: string | null;
  display_name: string;
  logo_url: string | null;
  group_title: string | null;
  xmltv_channel_id: string | null;
  channel_number: number | null;
  sort_order: number;
};

export type ExternalProgram = {
  channel_id: number;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  start_time: string;
  end_time: string;
};

const channelOrder = `CASE WHEN channels.channel_number IS NULL THEN 1 ELSE 0 END,
       channels.channel_number,
       channels.sort_order,
       channels.display_name COLLATE NOCASE`;
const visibleGroupJoin = `JOIN channel_groups ON channel_groups.name = ${groupNameSql()} AND channel_groups.enabled = 1`;

export function randomExternalCredential(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

export function listExternalProfiles(db = getDb()) {
  return db
    .prepare(
      `SELECT id, name, enabled, token, xc_username, xc_password, output_mode, created_at, updated_at
       FROM external_profiles
       ORDER BY CASE name WHEN 'Emby' THEN 0 WHEN 'Others' THEN 1 ELSE 2 END, name COLLATE NOCASE`
    )
    .all() as ExternalProfile[];
}

export function findExternalProfileByToken(token: string, db = getDb()) {
  return db
    .prepare(
      `SELECT id, name, enabled, token, xc_username, xc_password, output_mode, created_at, updated_at
       FROM external_profiles
       WHERE token = ? AND enabled = 1`
    )
    .get(token) as ExternalProfile | undefined;
}

export function findExternalProfileByXc(username: string, password: string, db = getDb()) {
  return db
    .prepare(
      `SELECT id, name, enabled, token, xc_username, xc_password, output_mode, created_at, updated_at
       FROM external_profiles
       WHERE xc_username = ? AND xc_password = ? AND enabled = 1 AND name COLLATE NOCASE <> 'Emby'`
    )
    .get(username, password) as ExternalProfile | undefined;
}

export function updateExternalProfile(id: number, body: { enabled?: boolean; outputMode?: "hls" | "mpegts"; xcUsername?: string }, db = getDb()) {
  const existing = db.prepare("SELECT id FROM external_profiles WHERE id = ?").get(id);
  if (!existing) return null;
  if (typeof body.enabled === "boolean") {
    db.prepare("UPDATE external_profiles SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.enabled ? 1 : 0, id);
  }
  if (body.outputMode) {
    db.prepare("UPDATE external_profiles SET output_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.outputMode, id);
  }
  if (body.xcUsername) {
    db.prepare("UPDATE external_profiles SET xc_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.xcUsername, id);
  }
  return listExternalProfiles(db).find((profile) => profile.id === id) ?? null;
}

export function regenerateExternalToken(id: number, db = getDb()) {
  const token = randomExternalCredential();
  const result = db
    .prepare("UPDATE external_profiles SET token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(token, id);
  if (!result.changes) return null;
  return listExternalProfiles(db).find((profile) => profile.id === id) ?? null;
}

export function regenerateExternalXcPassword(id: number, db = getDb()) {
  const password = randomExternalCredential(12);
  const result = db
    .prepare("UPDATE external_profiles SET xc_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(password, id);
  if (!result.changes) return null;
  return listExternalProfiles(db).find((profile) => profile.id === id) ?? null;
}

export function visibleExternalChannels(db: Database.Database = getDb()) {
  return db
    .prepare(
      `SELECT channels.id, channels.tvg_id, channels.display_name, channels.logo_url,
              channels.group_title, channels.xmltv_channel_id, channels.channel_number, channels.sort_order
       FROM channels
       ${visibleGroupJoin}
       WHERE channels.enabled = 1
       ORDER BY ${channelOrder}`
    )
    .all() as ExternalChannel[];
}

export function visibleExternalGroups(db: Database.Database = getDb()) {
  return db
    .prepare(
      `SELECT channel_groups.name, channel_groups.sort_order
       FROM channel_groups
       WHERE channel_groups.enabled = 1
         AND EXISTS (
           SELECT 1 FROM channels
           WHERE channels.enabled = 1 AND ${groupNameSql()} = channel_groups.name
         )
       ORDER BY channel_groups.sort_order, channel_groups.name COLLATE NOCASE`
    )
    .all() as Array<{ name: string; sort_order: number }>;
}

export function visibleExternalPrograms(db: Database.Database = getDb()) {
  return db
    .prepare(
      `SELECT programs.channel_id,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.display_name ELSE programs.title END AS title,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN '' ELSE programs.subtitle END AS subtitle,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN '' ELSE programs.description END AS description,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.group_title ELSE programs.category END AS category,
              programs.start_time, programs.end_time
       FROM programs
       JOIN channels ON channels.id = programs.channel_id
       ${visibleGroupJoin}
       WHERE channels.enabled = 1
       ORDER BY programs.start_time, channels.channel_number, channels.sort_order`
    )
    .all() as ExternalProgram[];
}

export function visibleExternalProgramsForChannel(channelId: number, db: Database.Database = getDb()) {
  return db
    .prepare(
      `SELECT programs.channel_id,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.display_name ELSE programs.title END AS title,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN '' ELSE programs.subtitle END AS subtitle,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN '' ELSE programs.description END AS description,
              CASE WHEN channel_groups.use_channel_name_for_epg = 1 THEN channels.group_title ELSE programs.category END AS category,
              programs.start_time, programs.end_time
       FROM programs
       JOIN channels ON channels.id = programs.channel_id
       ${visibleGroupJoin}
       WHERE channels.enabled = 1
         AND channels.id = ?
         AND programs.end_time > ?
       ORDER BY programs.start_time
       LIMIT 12`
    )
    .all(channelId, new Date().toISOString()) as ExternalProgram[];
}
