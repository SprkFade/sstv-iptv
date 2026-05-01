import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();

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
  cookieSecure: process.env.COOKIE_SECURE === "true",
  clientDistPath: process.env.CLIENT_DIST_PATH ?? path.resolve(root, "../client/dist")
};

export function ensureRuntimeDirs() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });
}
