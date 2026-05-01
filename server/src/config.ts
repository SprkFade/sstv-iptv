import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3025),
  databasePath: process.env.DATABASE_PATH ?? path.join(root, "..", "data", "tv-guide.sqlite"),
  cacheDir: process.env.CACHE_DIR ?? path.join(root, "..", "cache"),
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "changeme",
  sessionSecret: process.env.SESSION_SECRET ?? randomUUID(),
  m3uUrl: process.env.M3U_URL ?? "",
  xmltvUrl: process.env.XMLTV_URL ?? "",
  refreshIntervalHours: Math.max(1, Number(process.env.REFRESH_INTERVAL_HOURS ?? 12)),
  plexServerIdentifier: process.env.PLEX_SERVER_IDENTIFIER ?? "",
  plexToken: process.env.PLEX_TOKEN ?? "",
  plexProductName: process.env.PLEX_PRODUCT_NAME ?? "TV Guide PWA",
  plexClientIdentifier: process.env.PLEX_CLIENT_IDENTIFIER ?? randomUUID(),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  clientDistPath: process.env.CLIENT_DIST_PATH ?? path.resolve(root, "../client/dist")
};

export function ensureRuntimeDirs() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });
}
