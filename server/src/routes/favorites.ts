import { Router } from "express";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";

export const favoritesRouter = Router();

favoritesRouter.get("/", (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(
      `SELECT channels.id, display_name, logo_url, group_title, stream_url
       FROM favorites
       JOIN channels ON channels.id = favorites.channel_id
       WHERE favorites.user_id = ? AND channels.enabled = 1
       ORDER BY display_name COLLATE NOCASE`
    )
    .all(req.user!.id);
  res.json({ favorites: rows });
});

favoritesRouter.post("/:channelId", (req: AuthedRequest, res) => {
  const channelId = Number(req.params.channelId);
  const exists = getDb().prepare("SELECT id FROM channels WHERE id = ? AND enabled = 1").get(channelId);
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
