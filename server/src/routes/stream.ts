import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Router } from "express";
import { config } from "../config.js";
import { getDb, setting } from "../db/database.js";
import { groupNameSql } from "../services/channelGroups.js";
import type { AuthedRequest } from "../types/app.js";

export const streamRouter = Router();

type HlsSession = {
  clients: Map<string, HlsClientStats>;
  dir: string;
  events: Array<{ at: string; message: string }>;
  exited: boolean;
  exitCode: number | null;
  inputBytes: number;
  inputAbort: AbortController | null;
  inputMode: HlsInputMode;
  lastInputAt: number | null;
  lastAccess: number;
  mode: HlsMode;
  process: ChildProcessWithoutNullStreams;
  requestStats: {
    playlist: number;
    segment: number;
    lastPlaylistAt: number | null;
    lastSegmentAt: number | null;
    lastSegmentName: string;
  };
  startedAt: number;
  stderr: string;
  streamUrl: string;
};

type HlsMode = "normal" | "videoOnly";
type HlsInputMode = "ffmpeg-direct" | "node-pipe";
type HlsRequestKind = "playlist" | "segment";
type StreamQuality = {
  label: string;
  video: {
    bitrate: string | null;
    codec: string | null;
    fps: number | null;
    height: number | null;
    width: number | null;
  } | null;
  audio: {
    bitrate: string | null;
    channels: string | null;
    codec: string | null;
    sampleRate: number | null;
  } | null;
};

type HlsClientStats = {
  id: string;
  bytesServed: number;
  externalProfileId: number | null;
  externalProfileName: string | null;
  firstSeen: number;
  ip: string;
  lastPlaylistAt: number | null;
  lastRequestKind: HlsRequestKind;
  lastSeen: number;
  lastSegmentAt: number | null;
  lastSegmentName: string;
  playlistRequests: number;
  role: string;
  segmentRequests: number;
  source: "browser" | "external";
  userAgent: string;
  userId: number | null;
  username: string;
};

type HlsRuntimeSettings = {
  dvrWindowMinutes: number;
  inputMode: HlsInputMode;
  reconnectDelayMax: number;
  rwTimeoutSeconds: number;
  staleRestartSeconds: number;
};

const hlsSessions = new Map<number, HlsSession>();
const hlsFallbackModes = new Map<number, { mode: HlsMode; streamUrl: string }>();
const HLS_IDLE_TIMEOUT_MS = 15 * 1000;
const HLS_CLIENT_ACTIVE_MS = 15 * 1000;
const HLS_CLIENT_STARTUP_GRACE_MS = 15 * 1000;
const HLS_SEGMENT_SECONDS = 2;
const HLS_LIVE_SEGMENT_COUNT = 60;
const HLS_DELETE_THRESHOLD = 30;
const FFMPEG_NORMAL_PROBE_OPTIONS = [
  "-analyzeduration", "8000000",
  "-probesize", "8000000",
  "-max_probe_packets", "100000",
  "-err_detect", "ignore_err"
];
const FFMPEG_VIDEO_ONLY_PROBE_OPTIONS = [
  "-analyzeduration", "4000000",
  "-probesize", "4000000",
  "-max_probe_packets", "50000",
  "-err_detect", "ignore_err"
];
const FFMPEG_TIMESTAMP_OPTIONS = [
  "-dts_delta_threshold", "10"
];
const STREAM_INPUT_RETRY_LIMIT = 12;
const STREAM_LOG_BUFFER_LENGTH = 16_000;
const STREAM_EVENT_BUFFER_LENGTH = 80;

function boundedInt(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function hlsRuntimeSettings(): HlsRuntimeSettings {
  const dvrWindowMinutes = boundedInt(setting("ffmpeg_hls_dvr_window_minutes", String(config.ffmpegHlsDvrWindowMinutes)), 20, 0, 60);
  return {
    dvrWindowMinutes,
    inputMode: setting("ffmpeg_hls_input_mode", config.ffmpegHlsInputMode) === "pipe" ? "node-pipe" : "ffmpeg-direct",
    reconnectDelayMax: boundedInt(setting("ffmpeg_reconnect_delay_max", String(config.ffmpegReconnectDelayMax)), 5, 1, 60),
    rwTimeoutSeconds: boundedInt(setting("ffmpeg_rw_timeout_seconds", String(config.ffmpegRwTimeoutSeconds)), 15, 5, 120),
    staleRestartSeconds: boundedInt(setting("ffmpeg_stale_restart_seconds", String(config.ffmpegStaleRestartSeconds)), 30, 0, 300)
  };
}

function findChannel(channelId: number) {
  return getDb()
    .prepare(
      `SELECT stream_url
       FROM channels
       JOIN channel_groups ON channel_groups.name = ${groupNameSql()} AND channel_groups.enabled = 1
       WHERE channels.id = ? AND channels.enabled = 1`
    )
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
  session.inputAbort?.abort();
  if (!session.process.killed) session.process.kill("SIGTERM");
}

export function stopAllHlsSessions(reason = "server shutdown") {
  const channelIds = [...hlsSessions.keys()];
  for (const channelId of channelIds) {
    const session = hlsSessions.get(channelId);
    if (session) recordSessionEvent(session, `Stopping stream session: ${reason}.`);
    stopHlsSession(channelId);
  }
  return channelIds.length;
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
  return (current + message).slice(-STREAM_LOG_BUFFER_LENGTH);
}

function recordSessionEvent(session: HlsSession, message: string) {
  session.events = [...session.events, { at: new Date().toISOString(), message }].slice(-STREAM_EVENT_BUFFER_LENGTH);
}

function shortClientId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6);
}

function clientIp(req: AuthedRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

function hlsClientSessionId(req: AuthedRequest) {
  const value = req.query.clientSession;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return /^[A-Za-z0-9_-]{8,80}$/.test(raw) ? raw : "";
}

function hlsClientKey(req: AuthedRequest) {
  const sessionId = hlsClientSessionId(req);
  if (sessionId) return `session|${sessionId}`;
  const ip = clientIp(req);
  const userAgent = req.headers["user-agent"]?.toString() || "unknown";
  const userId = req.user?.id ?? null;
  const externalProfileId = req.externalProfile?.id ?? null;
  return `${externalProfileId ? `external-${externalProfileId}` : userId ?? "anon"}|${ip}|${userAgent}`;
}

function pruneSessionClients(session: HlsSession, now = Date.now()) {
  for (const [key, client] of session.clients) {
    if (now - client.lastSeen > HLS_CLIENT_ACTIVE_MS) session.clients.delete(key);
  }
}

function isActivePlaybackClient(session: HlsSession, client: HlsClientStats, now = Date.now()) {
  if (client.lastSegmentAt && now - client.lastSegmentAt <= HLS_CLIENT_ACTIVE_MS) return true;
  const sessionStarting = now - session.startedAt <= HLS_CLIENT_STARTUP_GRACE_MS && session.requestStats.segment === 0;
  return sessionStarting && now - client.lastSeen <= HLS_CLIENT_STARTUP_GRACE_MS;
}

function activePlaybackClients(session: HlsSession, now = Date.now()) {
  pruneSessionClients(session, now);
  return [...session.clients.values()].filter((client) => isActivePlaybackClient(session, client, now));
}

function shouldStopInactivePlaybackSession(session: HlsSession, now = Date.now()) {
  if (session.exited) return false;
  const startupGrace = now - session.startedAt <= HLS_CLIENT_STARTUP_GRACE_MS && session.requestStats.segment === 0;
  return !startupGrace && activePlaybackClients(session, now).length === 0;
}

function recordHlsClientRequest(
  req: AuthedRequest,
  session: HlsSession,
  kind: HlsRequestKind,
  segmentName = "",
  bytesServed = 0
) {
  const now = Date.now();
  pruneSessionClients(session, now);
  const ip = clientIp(req);
  const userAgent = req.headers["user-agent"]?.toString() || "unknown";
  const userId = req.user?.id ?? null;
  const externalProfile = req.externalProfile;
  const username = externalProfile?.name ?? req.user?.username ?? "unknown";
  const key = hlsClientKey(req);
  const existing = session.clients.get(key);
  const client: HlsClientStats = existing ?? {
    id: shortClientId(key),
    bytesServed: 0,
    externalProfileId: externalProfile?.id ?? null,
    externalProfileName: externalProfile?.name ?? null,
    firstSeen: now,
    ip,
    lastPlaylistAt: null,
    lastRequestKind: kind,
    lastSeen: now,
    lastSegmentAt: null,
    lastSegmentName: "",
    playlistRequests: 0,
    role: externalProfile ? "external" : req.user?.role ?? "unknown",
    segmentRequests: 0,
    source: externalProfile ? "external" : "browser",
    userAgent,
    userId,
    username
  };

  client.lastSeen = now;
  client.lastRequestKind = kind;
  client.bytesServed += bytesServed;
  if (kind === "playlist") {
    client.playlistRequests += 1;
    client.lastPlaylistAt = now;
  } else {
    client.segmentRequests += 1;
    client.lastSegmentAt = now;
    client.lastSegmentName = segmentName;
  }
  session.clients.set(key, client);
}

function releaseHlsClient(req: AuthedRequest, session: HlsSession) {
  const key = hlsClientKey(req);
  if (!session.clients.delete(key)) return false;
  recordSessionEvent(session, `Released playback client ${shortClientId(key)}.`);
  return true;
}

function rewritePlaylistForClientSession(playlist: string, clientSession: string) {
  if (!clientSession) return playlist;
  return playlist
    .split(/\r?\n/)
    .map((line) => (/^segment_\d{5}\.ts$/.test(line.trim()) ? `${line.trim()}?clientSession=${encodeURIComponent(clientSession)}` : line))
    .join("\n");
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
  onError: (message: string) => void,
  onInputChunk?: (bytes: number) => void
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
        input.on("data", (chunk: Buffer) => {
          onInputChunk?.(chunk.byteLength);
        });
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

function ffmpegInputOptions(mode: HlsMode, logLevel = config.ffmpegLogLevel) {
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel", logLevel,
    "-fflags", "+genpts+igndts+discardcorrupt",
    ...(mode === "videoOnly" ? FFMPEG_VIDEO_ONLY_PROBE_OPTIONS : FFMPEG_NORMAL_PROBE_OPTIONS),
    ...FFMPEG_TIMESTAMP_OPTIONS,
    "-i", "pipe:0",
    "-dn",
    "-sn"
  ];
}

function ffmpegDirectInputOptions(streamUrl: string, mode: HlsMode, runtime: HlsRuntimeSettings, logLevel = config.ffmpegLogLevel) {
  const isHttpStream = /^https?:\/\//i.test(streamUrl);
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel", logLevel,
    ...(isHttpStream ? [
      "-user_agent", config.ffmpegUserAgent,
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", String(runtime.reconnectDelayMax),
      "-rw_timeout", String(runtime.rwTimeoutSeconds * 1_000_000)
    ] : []),
    "-fflags", "+genpts+igndts+discardcorrupt",
    ...(mode === "videoOnly" ? FFMPEG_VIDEO_ONLY_PROBE_OPTIONS : FFMPEG_NORMAL_PROBE_OPTIONS),
    ...FFMPEG_TIMESTAMP_OPTIONS,
    "-i", streamUrl,
    "-dn",
    "-sn"
  ];
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
    "-g", "60",
    "-keyint_min", "60",
    "-sc_threshold", "0",
    "-x264-params", "bframes=0:force-cfr=1:keyint=60:min-keyint=60:scenecut=0"
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

function parseBitrate(line: string) {
  return line.match(/(\d+(?:\.\d+)?)\s*kb\/s/i)?.[0] ?? null;
}

function parseVideoQuality(line: string): StreamQuality["video"] {
  const dimensions = line.match(/(?:^|[,\s])(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
  const width = dimensions ? Number(dimensions[1]) : null;
  const height = dimensions ? Number(dimensions[2]) : null;
  const fps = Number(line.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/i)?.[1] ?? NaN);
  return {
    bitrate: parseBitrate(line),
    codec: line.match(/Video:\s*([^,\s(]+)/i)?.[1] ?? null,
    fps: Number.isFinite(fps) ? fps : null,
    height: height && height >= 64 ? height : null,
    width: width && width >= 64 ? width : null
  };
}

function parseAudioQuality(line: string): StreamQuality["audio"] {
  const sampleRate = Number(line.match(/(\d+)\s*Hz/i)?.[1] ?? NaN);
  return {
    bitrate: parseBitrate(line),
    channels: line.match(/\b(mono|stereo|5\.1|7\.1|[1-9]\d*\s+channels?)\b/i)?.[1] ?? null,
    codec: line.match(/Audio:\s*([^,\s(]+)/i)?.[1] ?? null,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : null
  };
}

function qualityLabel(quality: Omit<StreamQuality, "label">) {
  const videoParts = [
    quality.video?.codec?.toUpperCase() ?? null,
    quality.video?.width && quality.video.height ? `${quality.video.width}x${quality.video.height}` : null,
    quality.video?.fps ? `${Math.round(quality.video.fps)}fps` : null,
    quality.video?.bitrate
  ].filter(Boolean);
  const audioParts = quality.audio
    ? [
      quality.audio.codec?.toUpperCase() ?? null,
      quality.audio.channels,
      quality.audio.sampleRate ? `${Math.round(quality.audio.sampleRate / 1000)} kHz` : null,
      quality.audio.bitrate
    ].filter(Boolean)
    : [];
  const parts = [
    videoParts.length ? videoParts.join(" / ") : null,
    audioParts.length ? audioParts.join(" / ") : quality.audio === null ? "no audio" : null
  ].filter(Boolean);
  return parts.join(" + ") || "Detecting...";
}

function parseFfmpegQuality(stderr: string, section: "input" | "output"): StreamQuality {
  let current: "input" | "output" | null = null;
  const quality: Omit<StreamQuality, "label"> = { video: null, audio: null };

  for (const line of stderr.split(/\r?\n/)) {
    if (/^\s*Input #/i.test(line)) current = "input";
    if (/^\s*Output #/i.test(line)) current = "output";
    if (current !== section) continue;
    if (!quality.video && /\bVideo:/i.test(line)) quality.video = parseVideoQuality(line);
    if (!quality.audio && /\bAudio:/i.test(line)) quality.audio = parseAudioQuality(line);
  }

  return { ...quality, label: qualityLabel(quality) };
}

function fallbackOutputQuality(mode: HlsMode): StreamQuality {
  const quality: Omit<StreamQuality, "label"> = {
    video: {
      bitrate: "2800 kb/s",
      codec: "h264",
      fps: 30,
      height: null,
      width: 1280
    },
    audio: mode === "videoOnly"
      ? null
      : {
        bitrate: "128 kb/s",
        channels: "stereo",
        codec: "aac",
        sampleRate: 48000
      }
  };
  return {
    ...quality,
    label: mode === "videoOnly"
      ? "H.264 up to 1280w / 30fps / 2800 kb/s + no audio"
      : "H.264 up to 1280w / 30fps / 2800 kb/s + AAC stereo / 48 kHz / 128 kb/s"
  };
}

function streamQualities(session: HlsSession) {
  const input = parseFfmpegQuality(session.stderr, "input");
  const parsedOutput = parseFfmpegQuality(session.stderr, "output");
  return {
    input,
    output: parsedOutput.video ? parsedOutput : fallbackOutputQuality(session.mode)
  };
}

function parsePlaylistStats(playlist: string) {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const targetDuration = Number(lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"))?.split(":")[1] ?? 0);
  const mediaSequence = Number(lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))?.split(":")[1] ?? 0);
  const durations = lines
    .filter((line) => line.startsWith("#EXTINF:"))
    .map((line) => Number(line.replace("#EXTINF:", "").split(",")[0]))
    .filter((value) => Number.isFinite(value));
  return {
    mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : 0,
    segmentCount: lines.filter((line) => /^segment_\d{5}\.ts$/.test(line)).length,
    targetDuration: Number.isFinite(targetDuration) ? targetDuration : 0,
    windowSeconds: Math.round(durations.reduce((total, duration) => total + duration, 0))
  };
}

function buildTrace(session: HlsSession, files: Array<{ name: string; size: number; modified: string }>, playlist: string) {
  const now = Date.now();
  const completeSegments = files.filter((file) => /^segment_\d{5}\.ts$/.test(file.name));
  const tempFiles = files.filter((file) => file.name.endsWith(".tmp")).map((file) => file.name);
  const latestSegment = completeSegments.at(-1) ?? null;
  const playlistFile = files.find((file) => file.name === "index.m3u8");

  return {
    completedSegmentCount: completeSegments.length,
    events: session.events,
    inputBytes: session.inputBytes,
    inputMode: session.inputMode,
    lastInputAgeMs: session.lastInputAt ? now - session.lastInputAt : null,
    latestSegment,
    latestSegmentAgeMs: latestSegment ? now - new Date(latestSegment.modified).getTime() : null,
    playlistAgeMs: playlistFile ? now - new Date(playlistFile.modified).getTime() : null,
    playlistStats: parsePlaylistStats(playlist),
    quality: streamQualities(session),
    requests: {
      playlist: session.requestStats.playlist,
      segment: session.requestStats.segment,
      lastPlaylistAgeMs: session.requestStats.lastPlaylistAt ? now - session.requestStats.lastPlaylistAt : null,
      lastSegmentAgeMs: session.requestStats.lastSegmentAt ? now - session.requestStats.lastSegmentAt : null,
      lastSegmentName: session.requestStats.lastSegmentName
    },
    runtimeMs: now - session.startedAt,
    settings: {
      ...hlsRuntimeSettings(),
      segmentSeconds: HLS_SEGMENT_SECONDS
    },
    startedAt: new Date(session.startedAt).toISOString(),
    tempFiles
  };
}

export function getActiveStreamMonitor() {
  const now = Date.now();
  const channelIds = [...hlsSessions.keys()];
  const channelRows = channelIds.length
    ? getDb()
      .prepare(
        `SELECT id, display_name, group_title, channel_number
         FROM channels
         WHERE id IN (${channelIds.map(() => "?").join(",")})`
      )
      .all(...channelIds) as Array<{ id: number; display_name: string; group_title: string; channel_number: number | null }>
    : [];
  const channelById = new Map(channelRows.map((channel) => [channel.id, channel]));

  const streams = [...hlsSessions.entries()]
    .flatMap(([channelId, session]) => {
      if (shouldStopInactivePlaybackSession(session, now)) {
        recordSessionEvent(session, "No active segment clients remain; stopping FFmpeg session.");
        stopHlsSession(channelId);
        return [];
      }
      const channel = channelById.get(channelId);
      const latestSegmentAgeMs = latestCompleteSegmentAgeMs(session);
      const clients = activePlaybackClients(session, now)
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((client) => ({
          id: client.id,
          bytesServed: client.bytesServed,
          externalProfileId: client.externalProfileId,
          externalProfileName: client.externalProfileName,
          firstSeen: new Date(client.firstSeen).toISOString(),
          ip: client.ip,
          lastPlaylistAt: client.lastPlaylistAt ? new Date(client.lastPlaylistAt).toISOString() : null,
          lastRequestKind: client.lastRequestKind,
          lastSeen: new Date(client.lastSeen).toISOString(),
          lastSeenAgeMs: now - client.lastSeen,
          lastSegmentAt: client.lastSegmentAt ? new Date(client.lastSegmentAt).toISOString() : null,
          lastSegmentName: client.lastSegmentName,
          playlistRequests: client.playlistRequests,
          role: client.role,
          segmentRequests: client.segmentRequests,
          source: client.source,
          userAgent: client.userAgent,
          userId: client.userId,
          username: client.username
        }));

      return {
        active: !session.exited,
        channelId,
        channelName: channel?.display_name ?? `Channel ${channelId}`,
        channelNumber: channel?.channel_number ?? null,
        clientCount: clients.length,
        clients,
        exitCode: session.exitCode,
        groupTitle: channel?.group_title ?? "",
        inputBytes: session.inputBytes,
        inputMode: session.inputMode,
        lastAccess: new Date(session.lastAccess).toISOString(),
        latestSegmentAgeMs,
        mode: session.mode,
        playlistRequests: session.requestStats.playlist,
        providerConnectionCount: !session.exited && clients.length > 0 ? 1 : 0,
        quality: streamQualities(session),
        runtimeMs: now - session.startedAt,
        segmentRequests: session.requestStats.segment,
        startedAt: new Date(session.startedAt).toISOString(),
        tempFileCount: fs.existsSync(session.dir)
          ? fs.readdirSync(session.dir).filter((name) => name.endsWith(".tmp")).length
          : 0
      };
    })
    .filter((stream) => stream.active || stream.clientCount > 0)
    .sort((a, b) => b.clientCount - a.clientCount || a.channelName.localeCompare(b.channelName));

  return {
    activeClientCount: streams.reduce((total, stream) => total + stream.clientCount, 0),
    providerConnectionCount: streams.reduce((total, stream) => total + stream.providerConnectionCount, 0),
    refreshedAt: new Date(now).toISOString(),
    streamCount: streams.length,
    streams
  };
}

function latestCompleteSegmentAgeMs(session: HlsSession) {
  try {
    const latest = fs
      .readdirSync(session.dir)
      .filter((name) => /^segment_\d{5}\.ts$/.test(name))
      .sort()
      .at(-1);
    if (!latest) return null;
    return Date.now() - fs.statSync(path.join(session.dir, latest)).mtime.getTime();
  } catch {
    return null;
  }
}

function shouldRestartStaleHlsSession(session: HlsSession, runtime: HlsRuntimeSettings) {
  if (runtime.staleRestartSeconds <= 0 || session.exited) return false;
  const ageMs = latestCompleteSegmentAgeMs(session);
  const thresholdMs = runtime.staleRestartSeconds * 1000;
  if (ageMs === null) return Date.now() - session.startedAt > thresholdMs;
  return ageMs > thresholdMs && Date.now() - session.startedAt > thresholdMs;
}

function ensureHlsSession(channelId: number, streamUrl: string) {
  const existing = hlsSessions.get(channelId);
  const mode = hlsModeForChannel(channelId, streamUrl);
  const runtime = hlsRuntimeSettings();
  const hlsListSize = runtime.dvrWindowMinutes > 0
    ? Math.max(HLS_LIVE_SEGMENT_COUNT, Math.ceil((runtime.dvrWindowMinutes * 60) / HLS_SEGMENT_SECONDS))
    : HLS_LIVE_SEGMENT_COUNT;
  if (existing && !existing.exited && existing.streamUrl === streamUrl && existing.mode === mode && existing.inputMode === runtime.inputMode) {
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
    ...(runtime.inputMode === "ffmpeg-direct" ? ffmpegDirectInputOptions(streamUrl, mode, runtime) : ffmpegInputOptions(mode)),
    ...hlsOutputOptions(mode),
    "-max_muxing_queue_size", "1024",
    "-avoid_negative_ts", "make_zero",
    "-flush_packets", "1",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-f", "hls",
    "-hls_time", String(HLS_SEGMENT_SECONDS),
    "-hls_list_size", String(hlsListSize),
    "-hls_delete_threshold", String(HLS_DELETE_THRESHOLD),
    "-hls_flags", "delete_segments+independent_segments+omit_endlist+program_date_time+temp_file",
    "-hls_segment_filename", segmentPattern,
    "index.m3u8"
  ], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  if (runtime.inputMode === "ffmpeg-direct") ffmpeg.stdin.end();

  const session: HlsSession = {
    clients: new Map(),
    dir,
    events: [],
    exited: false,
    exitCode: null,
    inputBytes: 0,
    inputAbort: null,
    inputMode: runtime.inputMode,
    lastInputAt: null,
    lastAccess: Date.now(),
    mode,
    process: ffmpeg,
    requestStats: {
      playlist: 0,
      segment: 0,
      lastPlaylistAt: null,
      lastSegmentAt: null,
      lastSegmentName: ""
    },
    startedAt: Date.now(),
    stderr: mode === "videoOnly" ? "Malformed EAC3 audio was detected earlier; using video-only fallback for this channel.\n" : "",
    streamUrl
  };
  recordSessionEvent(session, `Started FFmpeg HLS session in ${mode} mode using ${runtime.inputMode === "ffmpeg-direct" ? "direct FFmpeg input" : "Node pipe input"}.`);

  if (runtime.inputMode === "node-pipe") {
    session.inputAbort = pipeProviderStreamToFfmpeg(streamUrl, ffmpeg, (message) => {
      session.stderr = appendStderr(session.stderr, message);
      recordSessionEvent(session, message.trim());
    }, (bytes) => {
      session.inputBytes += bytes;
      session.lastInputAt = Date.now();
    });
  }

  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    session.stderr = appendStderr(session.stderr, chunk);
    if (session.mode === "normal" && hasMalformedEac3Audio(session.stderr)) {
      hlsFallbackModes.set(channelId, { mode: "videoOnly", streamUrl });
      session.stderr = appendStderr(session.stderr, "\nMalformed EAC3 audio detected; restarting this channel with video-only fallback.\n");
      recordSessionEvent(session, "Malformed EAC3 audio detected; restarting with video-only fallback.");
      if (!session.process.killed) session.process.kill("SIGTERM");
    }
  });

  ffmpeg.on("error", (error) => {
    session.exited = true;
    session.stderr = appendStderr(session.stderr, error.message);
    recordSessionEvent(session, `FFmpeg process error: ${error.message}`);
  });

  ffmpeg.on("close", (code) => {
    session.exited = true;
    session.exitCode = code;
    session.inputAbort?.abort();
    recordSessionEvent(session, `FFmpeg exited with code ${code ?? "unknown"}.`);
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
    if (shouldStopInactivePlaybackSession(session, now)) {
      recordSessionEvent(session, "No active segment clients remain; stopping idle FFmpeg session.");
      stopHlsSession(channelId);
      continue;
    }
    if (now - session.lastAccess > HLS_IDLE_TIMEOUT_MS) stopHlsSession(channelId);
  }
}, 5_000).unref();

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
    trace: buildTrace(session, files, playlist),
    stderr: redactStreamDetails(sanitizeFfmpegStderrForStatus(session.stderr), session.streamUrl)
  });
});

streamRouter.post("/:channelId/hls/release", (req: AuthedRequest, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(channelId)) return res.status(400).json({ error: "Invalid channel id" });

  const session = hlsSessions.get(channelId);
  if (!session) return res.json({ ok: true, stopped: false });

  releaseHlsClient(req, session);
  if (shouldStopInactivePlaybackSession(session)) {
    recordSessionEvent(session, "No active segment clients remain after player release; stopping FFmpeg session.");
    stopHlsSession(channelId);
    return res.json({ ok: true, stopped: true });
  }

  return res.json({ ok: true, stopped: false });
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
    const canStartSession = file === "index.m3u8" && (req.query.prepare === "1" || req.query.prepare === "true" || req.query.start === "1" || req.query.start === "true");
    let session = hlsSessions.get(channelId);
    if (!session || session.exited || session.streamUrl !== channel.stream_url) {
      if (!canStartSession) {
        return res.status(409).json({ error: "HLS session is not active. Reload the player to start a fresh stream." });
      }
      session = ensureHlsSession(channelId, channel.stream_url);
    }
    if (file === "index.m3u8" && shouldRestartStaleHlsSession(session, hlsRuntimeSettings())) {
      if (!canStartSession && activePlaybackClients(session).length === 0) {
        return res.status(409).json({ error: "HLS session is stale. Reload the player to start a fresh stream." });
      }
      recordSessionEvent(session, "HLS producer appears stale; restarting FFmpeg session.");
      stopHlsSession(channelId);
      session = ensureHlsSession(channelId, channel.stream_url);
    }
    const now = Date.now();
    if (file === "index.m3u8") {
      session.requestStats.playlist += 1;
      session.requestStats.lastPlaylistAt = now;
      if (now - session.startedAt <= HLS_CLIENT_STARTUP_GRACE_MS && session.requestStats.segment === 0) {
        session.lastAccess = now;
      }
    } else {
      session.requestStats.segment += 1;
      session.requestStats.lastSegmentAt = now;
      session.requestStats.lastSegmentName = file;
      session.lastAccess = now;
    }

    const filePath = path.join(session.dir, file);
    if (file === "index.m3u8") {
      await waitForReadyPlaylist(session.dir, 20_000);
    } else {
      await waitForFile(filePath, 10_000);
    }
    const servedBytes = await fs.promises.stat(filePath).then((stat) => stat.size).catch(() => 0);
    recordHlsClientRequest(req, session, file === "index.m3u8" ? "playlist" : "segment", file === "index.m3u8" ? "" : file, servedBytes);

    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("pragma", "no-cache");
    res.setHeader("expires", "0");
    res.setHeader("x-accel-buffering", "no");
    if (file.endsWith(".m3u8")) {
      res.type("application/vnd.apple.mpegurl");
      const playlist = await fs.promises.readFile(filePath, "utf8");
      return res.send(rewritePlaylistForClientSession(playlist, hlsClientSessionId(req)));
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
    ...ffmpegInputOptions("normal"),
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
    "-flush_packets", "1",
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
