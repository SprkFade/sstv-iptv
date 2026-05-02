import Database from "better-sqlite3";
import { config, ensureRuntimeDirs } from "../config.js";
import { groupNameSql } from "../services/channelGroups.js";

let db: Database.Database | null = null;

export function getDb() {
  if (!db) {
    ensureRuntimeDirs();
    db = new Database(config.databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function migrate() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      auth_provider TEXT NOT NULL CHECK(auth_provider IN ('local', 'plex')),
      plex_user_id TEXT UNIQUE,
      plex_username TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tvg_id TEXT,
      tvg_name TEXT,
      display_name TEXT NOT NULL,
      logo_url TEXT,
      logo_cache_path TEXT,
      group_title TEXT,
      stream_url TEXT NOT NULL,
      xmltv_channel_id TEXT,
      channel_number INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channel_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      use_channel_name_for_epg INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      category TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      channel_count INTEGER NOT NULL DEFAULT 0,
      program_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_channels_enabled_group ON channels(enabled, group_title);
    CREATE INDEX IF NOT EXISTS idx_channels_tvg_id ON channels(tvg_id);
    CREATE INDEX IF NOT EXISTS idx_channels_stream_url ON channels(stream_url);
    CREATE INDEX IF NOT EXISTS idx_channels_xmltv_channel_id ON channels(xmltv_channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_groups_enabled_sort ON channel_groups(enabled, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_programs_channel_time ON programs(channel_id, start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_programs_time ON programs(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_programs_title ON programs(title);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  addColumnIfMissing(database, "channels", "channel_number", "INTEGER");
  addColumnIfMissing(database, "channels", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "channel_groups", "use_channel_name_for_epg", "INTEGER NOT NULL DEFAULT 0");
  database.exec("CREATE INDEX IF NOT EXISTS idx_channels_enabled_sort ON channels(enabled, channel_number, sort_order, display_name);");
  database.exec("CREATE INDEX IF NOT EXISTS idx_channel_groups_enabled_sort ON channel_groups(enabled, sort_order, name);");
  backfillExistingChannelGroups(database);

  seedSettings();
  closeInterruptedRefreshRuns();
}

function addColumnIfMissing(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillExistingChannelGroups(database: Database.Database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM channel_groups").get() as { count: number };
  if (count.count > 0) return;

  const groups = database
    .prepare(
      `SELECT ${groupNameSql()} AS name,
              MIN(COALESCE(channels.channel_number, channels.sort_order, 999999)) AS first_sort
       FROM channels
       WHERE channels.enabled = 1
       GROUP BY name
       ORDER BY first_sort, name COLLATE NOCASE`
    )
    .all() as Array<{ name: string }>;
  const insert = database.prepare("INSERT OR IGNORE INTO channel_groups (name, enabled, sort_order) VALUES (?, 1, ?)");
  groups.forEach((group, index) => insert.run(group.name, index));
}

function closeInterruptedRefreshRuns() {
  getDb()
    .prepare(
      `UPDATE refresh_runs
       SET status = 'failed',
           finished_at = CURRENT_TIMESTAMP,
           error = COALESCE(NULLIF(error, ''), 'Refresh interrupted by app restart.')
       WHERE status = 'running'`
    )
    .run();
}

function seedSettings() {
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
  );
  insert.run("xc_base_url", config.xcBaseUrl);
  insert.run("xc_username", config.xcUsername);
  insert.run("xc_password", config.xcPassword);
  insert.run("xmltv_url", config.xmltvUrl);
  insert.run("refresh_interval_hours", String(config.refreshIntervalHours));
  insert.run("plex_server_identifier", config.plexServerIdentifier);
  insert.run("plex_token", config.plexToken);
  insert.run("plex_product_name", config.plexProductName);
  insert.run("plex_client_identifier", config.plexClientIdentifier);
  insert.run("ffmpeg_hls_input_mode", config.ffmpegHlsInputMode);
  insert.run("ffmpeg_reconnect_delay_max", String(config.ffmpegReconnectDelayMax));
  insert.run("ffmpeg_rw_timeout_seconds", String(config.ffmpegRwTimeoutSeconds));
  insert.run("ffmpeg_stale_restart_seconds", String(config.ffmpegStaleRestartSeconds));
  insert.run("ffmpeg_hls_dvr_window_minutes", String(config.ffmpegHlsDvrWindowMinutes));
  insert.run("setup_complete", "false");
}

export function setting(key: string, fallback = "") {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, value);
}

export function isSetupComplete() {
  const row = getDb()
    .prepare("SELECT id FROM users WHERE auth_provider = 'local' AND role = 'admin' LIMIT 1")
    .get() as { id: number } | undefined;
  return setting("setup_complete") === "true" && Boolean(row);
}
