import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Router } from "express";
import { config } from "../config.js";
import { getDb } from "../db/database.js";
import type { AuthedRequest } from "../types/app.js";

export const streamRouter = Router();

type HlsSession = {
  dir: string;
  exited: boolean;
  exitCode: number | null;
  inputAbort: AbortController;
  lastAccess: number;
  mode: HlsMode;
  process: ChildProcessWithoutNullStreams;
  stderr: string;
  streamUrl: string;
};

type HlsMode = "normal" | "videoOnly";

const hlsSessions = new Map<number, HlsSession>();
const hlsFallbackModes = new Map<number, { mode: HlsMode; streamUrl: string }>();
const HLS_IDLE_TIMEOUT_MS = 30 * 1000;
const FFMPEG_PROBE_OPTIONS = [
  "-analyzeduration", "8000000",
  "-probesize", "8000000",
  "-max_probe_packets", "100000",
  "-err_detect", "ignore_err"
];
const FFMPEG_TIMESTAMP_OPTIONS = [
  "-dts_delta_threshold", "10"
];
const STREAM_INPUT_RETRY_LIMIT = 12;

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

async function waitForReadyPlaylist(dir: string, timeoutMs: number) {
  const started = Date.now();
  const playlistPath = path.join(dir, "index.m3u8");
  while (Date.now() - started < timeoutMs) {
    try {
      const playlist = await fs.promises.readFile(playlistPath, "utf8");
      const segments = playlist
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^segment_\d{5}\.ts$/.test(line));

      if (segments.length >= 2) {
        const readySegments = await Promise.all(segments.slice(-2).map(async (segment) => {
          try {
            const stat = await fs.promises.stat(path.join(dir, segment));
            return stat.size > 0;
          } catch {
            return false;
          }
        }));
        if (readySegments.every(Boolean)) return;
      }
    } catch {
      // FFmpeg may not have emitted the first live playlist yet.
    }
    await wait(250);
  }
  throw new Error("Timed out waiting for FFmpeg HLS playlist to become ready");
}

function stopHlsSession(channelId: number) {
  const session = hlsSessions.get(channelId);
  if (!session) return;
  hlsSessions.delete(channelId);
  session.inputAbort.abort();
  if (!session.process.killed) session.process.kill("SIGTERM");
}

function redactStreamDetails(value: string, streamUrl: string) {
  let redacted = value.replaceAll(streamUrl, "[stream-url]");
  try {
    const url = new URL(streamUrl);
    const [, username, password] = url.pathname.match(/\/live\/([^/]+)\/([^/]+)\//) ?? [];
    redacted = redacted.replace(/(https?:\/\/[^/\s]+\/live\/)[^/\s]+\/[^/\s]+\//g, "$1[username]/[password]/");
    for (const [token, replacement] of [[username, "[username]"], [password, "[password]"]] as const) {
      if (token && token.length > 2) {
        redacted = redacted.replaceAll(token, replacement);
      }
    }
  } catch {
    redacted = redacted.replace(/(\/live\/)[^/\s]+\/[^/\s]+\//g, "$1[username]/[password]/");
  }
  return redacted;
}

function appendStderr(current: string, message: string) {
  return (current + message).slice(-4000);
}

function hasMalformedEac3Audio(stderr: string) {
  return /Could not find codec parameters.+Audio:\s*eac3[\s\S]+unspecified sample rate/i.test(stderr);
}

function sanitizeFfmpegStderrForStatus(stderr: string) {
  const noisyH264StartupPatterns = [
    /non-existing [PS]PS \d+ referenced/i,
    /decode_slice_header error/i,
    /^no frame!$/i,
    /^Last message repeated \d+ times$/i
  ];
  const lines = stderr.split(/\r?\n/);
  let suppressed = 0;
  const visible = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (noisyH264StartupPatterns.some((pattern) => pattern.test(trimmed))) {
      suppressed += 1;
      return false;
    }
    return true;
  });
  const message = visible.join("\n").trim();
  if (!suppressed) return message;

  const startupMessage = `Suppressed ${suppressed} transient H264 startup decoder warning${suppressed === 1 ? "" : "s"} while waiting for the next keyframe/SPS/PPS.`;
  return message ? `${message}\n${startupMessage}` : startupMessage;
}

function streamInputErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error";
  const details = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    details.push(`cause: ${cause.message}`);
  } else if (cause && typeof cause === "object") {
    const entries = ["code", "errno", "syscall", "address", "port"]
      .map((key) => {
        const value = (cause as Record<string, unknown>)[key];
        return value ? `${key}=${String(value)}` : "";
      })
      .filter(Boolean);
    if (entries.length) details.push(`cause: ${entries.join(" ")}`);
  }
  return details.join("; ");
}

function pipeProviderStreamToFfmpeg(
  streamUrl: string,
  ffmpeg: ChildProcessWithoutNullStreams,
  onError: (message: string) => void
) {
  const abort = new AbortController();

  void (async () => {
    let consecutiveFailures = 0;
    while (!abort.signal.aborted && ffmpeg.exitCode === null && !ffmpeg.stdin.destroyed) {
      try {
        const upstream = await fetch(streamUrl, {
          signal: abort.signal,
          headers: {
            "user-agent": config.ffmpegUserAgent,
            "accept": "*/*",
            "icy-metadata": "1"
          }
        });

        if (!upstream.ok || !upstream.body) {
          throw new Error(`Provider stream request failed: ${upstream.status} ${upstream.statusText}`);
        }

        consecutiveFailures = 0;
        const input = Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
        const destroyInput = () => input.destroy();
        input.on("error", (error) => {
          if (!abort.signal.aborted) onError(`\nNode stream input error: ${error.message}`);
        });
        ffmpeg.stdin.once("error", destroyInput);
        input.pipe(ffmpeg.stdin, { end: false });
        try {
          await finished(input, { cleanup: true });
        } finally {
          ffmpeg.stdin.off("error", destroyInput);
        }
        if (!abort.signal.aborted && ffmpeg.exitCode === null) {
          onError("\nProvider stream ended; reconnecting.");
          await wait(1000);
        }
      } catch (error) {
        if (abort.signal.aborted || ffmpeg.exitCode !== null || ffmpeg.stdin.destroyed) return;
        consecutiveFailures += 1;
        const delay = Math.min(10_000, 1000 + consecutiveFailures * 1000);
        onError(`\nNode stream input failed (${consecutiveFailures}/${STREAM_INPUT_RETRY_LIMIT}): ${streamInputErrorMessage(error)}; retrying in ${Math.round(delay / 1000)}s.`);
        if (consecutiveFailures >= STREAM_INPUT_RETRY_LIMIT) {
          onError("\nNode stream input failed too many times; stopping FFmpeg session.");
          if (!ffmpeg.killed) ffmpeg.kill("SIGTERM");
          return;
        }
        await wait(delay);
      }
    }
  })();

  return abort;
}

function hlsModeForChannel(channelId: number, streamUrl: string): HlsMode {
  const fallback = hlsFallbackModes.get(channelId);
  return fallback?.streamUrl === streamUrl ? fallback.mode : "normal";
}

function hlsOutputOptions(mode: HlsMode) {
  const videoOptions = [
    "-map", "0:v:0?",
    "-vf", "scale=min(1280\\,iw):-2:force_original_aspect_ratio=decrease,fps=30,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-b:v", "2800k",
    "-maxrate", "3200k",
    "-bufsize", "6400k",
    "-g", "30",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    "-x264-params", "bframes=0:force-cfr=1:keyint=30:min-keyint=30:scenecut=0"
  ];

  if (mode === "videoOnly") {
    return [
      ...videoOptions,
      "-an"
    ];
  }

  return [
    ...videoOptions,
    "-map", "0:a:0?",
    "-af", "aresample=async=1:first_pts=0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000"
  ];
}

function ensureHlsSession(channelId: number, streamUrl: string) {
  const existing = hlsSessions.get(channelId);
  const mode = hlsModeForChannel(channelId, streamUrl);
  if (existing && !existing.exited && existing.streamUrl === streamUrl && existing.mode === mode) {
    existing.lastAccess = Date.now();
    return existing;
  }

  stopHlsSession(channelId);

  const dir = path.join(config.cacheDir, "hls", String(channelId));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const playlistPath = path.join(dir, "index.m3u8");
  const segmentPattern = "segment_%05d.ts";
  const ffmpeg = spawn(config.ffmpegPath, [
    "-hide_banner",
    "-loglevel", mode === "videoOnly" ? "error" : "warning",
    "-fflags", "+genpts+igndts+discardcorrupt",
    ...FFMPEG_PROBE_OPTIONS,
    ...FFMPEG_TIMESTAMP_OPTIONS,
    "-i", "pipe:0",
    ...hlsOutputOptions(mode),
    "-max_muxing_queue_size", "1024",
    "-avoid_negative_ts", "make_zero",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "24",
    "-hls_delete_threshold", "18",
    "-hls_flags", "delete_segments+independent_segments+omit_endlist+program_date_time+temp_file",
    "-hls_segment_filename", segmentPattern,
    "index.m3u8"
  ], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });

  const session: HlsSession = {
    dir,
    exited: false,
    exitCode: null,
    inputAbort: new AbortController(),
    lastAccess: Date.now(),
    mode,
    process: ffmpeg,
    stderr: mode === "videoOnly" ? "Malformed EAC3 audio was detected earlier; using video-only fallback for this channel.\n" : "",
    streamUrl
  };

  session.inputAbort = pipeProviderStreamToFfmpeg(streamUrl, ffmpeg, (message) => {
    session.stderr = appendStderr(session.stderr, message);
  });

  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    session.stderr = appendStderr(session.stderr, chunk);
    if (session.mode === "normal" && hasMalformedEac3Audio(session.stderr)) {
      hlsFallbackModes.set(channelId, { mode: "videoOnly", streamUrl });
      session.stderr = appendStderr(session.stderr, "\nMalformed EAC3 audio detected; restarting this channel with video-only fallback.\n");
      if (!session.process.killed) session.process.kill("SIGTERM");
    }
  });

  ffmpeg.on("error", (error) => {
    session.exited = true;
    session.stderr = appendStderr(session.stderr, error.message);
  });

  ffmpeg.on("close", (code) => {
    session.exited = true;
    session.exitCode = code;
    session.inputAbort.abort();
    if (Date.now() - session.lastAccess < HLS_IDLE_TIMEOUT_MS) {
      console.warn("FFmpeg HLS transcode exited", {
        channelId,
        code,
        stderr: redactStreamDetails(session.stderr, session.streamUrl)
      });
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

streamRouter.get("/:channelId/hls/status", async (req: AuthedRequest, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("pragma", "no-cache");
  res.setHeader("expires", "0");

  const shouldEnsure = req.query.ensure === "1" || req.query.ensure === "true";
  let session = hlsSessions.get(channelId);
  if (!session && shouldEnsure) {
    const channel = findChannel(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    session = ensureHlsSession(channelId, channel.stream_url);
  }

  if (!session) {
    return res.json({
      active: false,
      files: [],
      message: "No FFmpeg HLS session has been started for this channel in this container."
    });
  }

  session.lastAccess = Date.now();

  let files: Array<{ name: string; size: number; modified: string }> = [];
  let playlist = "";
  try {
    const entries = await fs.promises.readdir(session.dir);
    files = await Promise.all(entries.sort().map(async (name) => {
      const stat = await fs.promises.stat(path.join(session.dir, name));
      return { name, size: stat.size, modified: stat.mtime.toISOString() };
    }));
    playlist = await fs.promises.readFile(path.join(session.dir, "index.m3u8"), "utf8").catch(() => "");
  } catch {
    files = [];
  }

  return res.json({
    active: !session.exited,
    exitCode: session.exitCode,
    files,
    mode: session.mode,
    playlist,
    stderr: redactStreamDetails(sanitizeFfmpegStderrForStatus(session.stderr), session.streamUrl)
  });
});

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
    if (file === "index.m3u8") {
      await waitForReadyPlaylist(session.dir, 20_000);
    } else {
      await waitForFile(filePath, 10_000);
    }

    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("pragma", "no-cache");
    res.setHeader("expires", "0");
    res.setHeader("x-accel-buffering", "no");
    if (file.endsWith(".m3u8")) {
      res.type("application/vnd.apple.mpegurl");
    } else {
      res.type("video/mp2t");
    }
    return res.sendFile(filePath);
  } catch (error) {
    const session = hlsSessions.get(channelId);
    if (session?.exited) {
      return res.status(502).json({
        error: `FFmpeg HLS transcode exited${session.exitCode === null ? "" : ` with code ${session.exitCode}`}.`,
        details: redactStreamDetails(session.stderr, session.streamUrl)
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
    "-fflags", "+genpts+igndts+discardcorrupt",
    ...FFMPEG_PROBE_OPTIONS,
    ...FFMPEG_TIMESTAMP_OPTIONS,
    "-i", "pipe:0",
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
  ], { stdio: ["pipe", "pipe", "pipe"] });

  let stderr = "";
  let closedByClient = false;
  const inputAbort = pipeProviderStreamToFfmpeg(channel.stream_url, ffmpeg, (message) => {
    stderr = appendStderr(stderr, message);
  });

  const stop = () => {
    closedByClient = true;
    inputAbort.abort();
    if (!ffmpeg.killed) ffmpeg.kill("SIGTERM");
  };

  req.on("close", stop);
  res.on("close", stop);

  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    stderr = appendStderr(stderr, chunk);
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
    console.warn("FFmpeg transcode exited", {
      channelId,
      code,
      stderr: redactStreamDetails(stderr, channel.stream_url)
    });
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
