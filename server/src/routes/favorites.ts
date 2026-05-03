import { Router } from "express";
import { getDb } from "../db/database.js";
import { groupNameSql } from "../services/channelGroups.js";
import type { AuthedRequest } from "../types/app.js";

export const favoritesRouter = Router();

favoritesRouter.get("/", (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(
      `SELECT channels.id,
              channels.display_name,
              channels.logo_url,
              channels.group_title,
              channels.stream_url,
              channels.channel_number,
              channels.sort_order
       FROM favorites
       JOIN channels ON channels.id = favorites.channel_id
       JOIN channel_groups ON channel_groups.name = ${groupNameSql()} AND channel_groups.enabled = 1
       WHERE favorites.user_id = ? AND channels.enabled = 1
       ORDER BY CASE WHEN channels.channel_number IS NULL THEN 1 ELSE 0 END,
                channels.channel_number, channels.sort_order, channels.display_name COLLATE NOCASE`
    )
    .all(req.user!.id);
  res.json({ favorites: rows });
});

favoritesRouter.post("/:channelId", (req: AuthedRequest, res) => {
  const channelId = Number(req.params.channelId);
  const exists = getDb()
    .prepare(
      `SELECT channels.id
       FROM channels
       JOIN channel_groups ON channel_groups.name = ${groupNameSql()} AND channel_groups.enabled = 1
       WHERE channels.id = ? AND channels.enabled = 1`
    )
    .get(channelId);
  if (!exists) return res.status(404).json({ error: "Channel not found" });
  getDb()
    .prepare("INSERT OR IGNORE INTO favorites (user_id, channel_id) VALUES (?, ?)")
    .run(req.user!.id, channelId);
  res.json({ ok: true });
});

favoritesRouter.delete("/:channelId", (req: AuthedRequest, res) => {
  getDb()
    .prepare("DELETE FROM favorites WHERE user_id = ? AND channel_id = ?")
    .run(req.user!.id, Number(req.params.channelId));
  res.json({ ok: true });
});
