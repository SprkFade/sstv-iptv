import { Readable } from "node:stream";
import { Router } from "express";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";

export const streamRouter = Router();

streamRouter.get("/:channelId", async (req: AuthedRequest, res, next) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  const channel = getDb()
    .prepare("SELECT stream_url FROM channels WHERE id = ? AND enabled = 1")
    .get(channelId) as { stream_url: string } | undefined;
  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const abort = new AbortController();
  req.on("close", () => abort.abort());

  try {
    const upstream = await fetch(channel.stream_url, {
      signal: abort.signal,
      headers: {
        "user-agent": "SSTV IPTV/1.0",
        "accept": "*/*"
      }
    });

    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: `Stream failed: ${upstream.status} ${upstream.statusText}`
      });
    }

    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "video/mp2t");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();

    Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } catch (error) {
    if (abort.signal.aborted) return;
    next(error);
  }
});
