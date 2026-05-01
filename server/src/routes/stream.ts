import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Router } from "express";
import { config } from "../config.js";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";

export const streamRouter = Router();

type HlsSession = {
  dir: string;
  exited: boolean;
  exitCode: number | null;
  lastAccess: number;
  process: ChildProcess;
  stderr: string;
  streamUrl: string;
};

const hlsSessions = new Map<number, HlsSession>();
const HLS_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

function findChannel(channelId: number) {
  return getDb()
    .prepare("SELECT stream_url FROM channels WHERE id = ? AND enabled = 1")
    .get(channelId) as { stream_url: string } | undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 0) return;
    } catch {
      // FFmpeg creates live playlist/segments asynchronously.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

function stopHlsSession(channelId: number) {
  const session = hlsSessions.get(channelId);
  if (!session) return;
  hlsSessions.delete(channelId);
  if (!session.process.killed) session.process.kill("SIGTERM");
}

function ensureHlsSession(channelId: number, streamUrl: string) {
  const existing = hlsSessions.get(channelId);
  if (existing && !existing.exited && existing.streamUrl === streamUrl) {
    existing.lastAccess = Date.now();
    return existing;
  }

  stopHlsSession(channelId);

  const dir = path.join(config.cacheDir, "hls", String(channelId));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const playlistPath = path.join(dir, "index.m3u8");
  const segmentPattern = path.join(dir, "segment_%05d.ts");
  const ffmpeg = spawn(config.ffmpegPath, [
    "-hide_banner",
    "-loglevel", "warning",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-user_agent", "SSTV IPTV/1.0",
    "-rw_timeout", "15000000",
    "-i", streamUrl,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-pix_fmt", "yuv420p",
    "-g", "48",
    "-keyint_min", "48",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list+independent_segments+omit_endlist",
    "-hls_segment_filename", segmentPattern,
    playlistPath
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const session: HlsSession = {
    dir,
    exited: false,
    exitCode: null,
    lastAccess: Date.now(),
    process: ffmpeg,
    stderr: "",
    streamUrl
  };

  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    session.stderr = (session.stderr + chunk).slice(-4000);
  });

  ffmpeg.on("error", (error) => {
    session.exited = true;
    session.stderr = (session.stderr + error.message).slice(-4000);
  });

  ffmpeg.on("close", (code) => {
    session.exited = true;
    session.exitCode = code;
    if (Date.now() - session.lastAccess < HLS_IDLE_TIMEOUT_MS) {
      console.warn("FFmpeg HLS transcode exited", { channelId, code, stderr: session.stderr });
    }
  });

  hlsSessions.set(channelId, session);
  return session;
}

setInterval(() => {
  const now = Date.now();
  for (const [channelId, session] of hlsSessions) {
    if (now - session.lastAccess > HLS_IDLE_TIMEOUT_MS) stopHlsSession(channelId);
  }
}, 30_000).unref();

streamRouter.get("/:channelId/hls/:file", async (req: AuthedRequest, res, next) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  const fileParam = req.params.file;
  const file = Array.isArray(fileParam) ? fileParam[0] : fileParam;
  if (!file) return res.status(400).json({ error: "Invalid HLS file" });
  if (!/^index\.m3u8$/.test(file) && !/^segment_\d{5}\.ts$/.test(file)) {
    return res.status(400).json({ error: "Invalid HLS file" });
  }

  const channel = findChannel(channelId);
  if (!channel) return res.status(404).json({ error: "Channel not found" });

  try {
    const session = ensureHlsSession(channelId, channel.stream_url);
    session.lastAccess = Date.now();

    const filePath = path.join(session.dir, file);
    await waitForFile(filePath, file === "index.m3u8" ? 15_000 : 8_000);

    res.setHeader("cache-control", "no-store");
    res.setHeader("x-accel-buffering", "no");
    res.type(file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
    return res.sendFile(filePath);
  } catch (error) {
    const session = hlsSessions.get(channelId);
    if (session?.exited) {
      return res.status(502).json({
        error: `FFmpeg HLS transcode exited${session.exitCode === null ? "" : ` with code ${session.exitCode}`}.`,
        details: session.stderr
      });
    }
    next(error);
  }
});

streamRouter.get("/:channelId/transcode", (req: AuthedRequest, res, next) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  const channel = findChannel(channelId);
  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const ffmpeg = spawn(config.ffmpegPath, [
    "-hide_banner",
    "-loglevel", "warning",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-user_agent", "SSTV IPTV/1.0",
    "-rw_timeout", "15000000",
    "-i", channel.stream_url,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "main",
    "-pix_fmt", "yuv420p",
    "-g", "48",
    "-keyint_min", "48",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-f", "mpegts",
    "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  let closedByClient = false;

  const stop = () => {
    closedByClient = true;
    if (!ffmpeg.killed) ffmpeg.kill("SIGTERM");
  };

  req.on("close", stop);
  res.on("close", stop);

  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  ffmpeg.on("error", (error) => {
    if (closedByClient) return;
    if (!res.headersSent) {
      return res.status(500).json({
        error: `FFmpeg failed to start. Check FFMPEG_PATH or install ffmpeg. ${error.message}`
      });
    }
    next(error);
  });

  ffmpeg.on("close", (code) => {
    if (closedByClient || code === 0) return;
    console.warn("FFmpeg transcode exited", { channelId, code, stderr });
  });

  res.status(200);
  res.setHeader("content-type", "video/mp2t");
  res.setHeader("cache-control", "no-store");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  ffmpeg.stdout.pipe(res);
});

streamRouter.get("/:channelId", async (req: AuthedRequest, res, next) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  const channel = findChannel(channelId);
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
    const upstreamType = upstream.headers.get("content-type") || "";
    res.setHeader("content-type", upstreamType && upstreamType !== "application/octet-stream" ? upstreamType : "video/mp2t");
    res.setHeader("cache-control", "no-store");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();

    Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } catch (error) {
    if (abort.signal.aborted) return;
    next(error);
  }
});
