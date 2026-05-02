import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const ffmpegLogLevels = new Set(["quiet", "panic", "fatal", "error", "warning", "info", "verbose", "debug", "trace"]);
const ffmpegLogLevel = ffmpegLogLevels.has(process.env.FFMPEG_LOG_LEVEL ?? "")
  ? process.env.FFMPEG_LOG_LEVEL!
  : "info";
const ffmpegHlsInputMode = process.env.FFMPEG_HLS_INPUT_MODE === "pipe" ? "pipe" : "direct";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3025),
  databasePath: process.env.DATABASE_PATH ?? path.join(root, "..", "data", "sstv-iptv.sqlite"),
  cacheDir: process.env.CACHE_DIR ?? path.join(root, "..", "cache"),
  sessionSecret: process.env.SESSION_SECRET ?? randomUUID(),
  xcBaseUrl: "",
  xcUsername: "",
  xcPassword: "",
  xmltvUrl: "",
  refreshIntervalHours: 12,
  plexServerIdentifier: "",
  plexToken: "",
  plexProductName: "SSTV IPTV",
  plexClientIdentifier: randomUUID(),
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffmpegLogLevel,
  ffmpegHlsInputMode,
  ffmpegReconnectDelayMax: Number(process.env.FFMPEG_RECONNECT_DELAY_MAX ?? 5),
  ffmpegRwTimeoutSeconds: Number(process.env.FFMPEG_RW_TIMEOUT_SECONDS ?? 15),
  ffmpegStaleRestartSeconds: Number(process.env.FFMPEG_STALE_RESTART_SECONDS ?? 30),
  ffmpegHlsDvrWindowMinutes: Number(process.env.FFMPEG_HLS_DVR_WINDOW_MINUTES ?? 20),
  ffmpegUserAgent: process.env.FFMPEG_USER_AGENT ?? "VLC/3.0.20 LibVLC/3.0.20",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  clientDistPath: process.env.CLIENT_DIST_PATH ?? path.resolve(root, "../client/dist")
};

export function ensureRuntimeDirs() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });
}
