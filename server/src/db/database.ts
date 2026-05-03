import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
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
      source_id TEXT,
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

    CREATE TABLE IF NOT EXISTS external_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      token TEXT NOT NULL UNIQUE,
      xc_username TEXT NOT NULL UNIQUE,
      xc_password TEXT NOT NULL,
      output_mode TEXT NOT NULL DEFAULT 'hls' CHECK(output_mode IN ('hls', 'mpegts')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provider_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_primary INTEGER NOT NULL DEFAULT 0,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      max_connections INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      account_status TEXT,
      account_expires_at TEXT,
      account_days_left INTEGER,
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_external_profiles_token ON external_profiles(token);
    CREATE INDEX IF NOT EXISTS idx_external_profiles_xc ON external_profiles(xc_username, xc_password);
    CREATE INDEX IF NOT EXISTS idx_provider_profiles_order ON provider_profiles(enabled, sort_order, id);
  `);

  addColumnIfMissing(database, "channels", "channel_number", "INTEGER");
  addColumnIfMissing(database, "channels", "source_id", "TEXT");
  addColumnIfMissing(database, "channels", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "channel_groups", "use_channel_name_for_epg", "INTEGER NOT NULL DEFAULT 0");
  database.exec("CREATE INDEX IF NOT EXISTS idx_channels_enabled_sort ON channels(enabled, channel_number, sort_order, display_name);");
  database.exec("CREATE INDEX IF NOT EXISTS idx_channels_source_id ON channels(source_id);");
  database.exec("CREATE INDEX IF NOT EXISTS idx_channel_groups_enabled_sort ON channel_groups(enabled, sort_order, name);");
  backfillExistingChannelGroups(database);

  seedSettings();
  seedExternalProfiles();
  seedProviderProfiles();
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
  insert.run("external_internal_base_url", "http://sstv-iptv:3025");
  insert.run("external_public_base_url", "");
  insert.run("emby_enabled", "false");
  insert.run("emby_base_url", "");
  insert.run("emby_api_key", "");
  insert.run("emby_refresh_after_provider_refresh", "true");
  insert.run("emby_refresh_task_id", "");
  insert.run("emby_refresh_task_name", "");
  insert.run("emby_last_trigger_status", "");
  insert.run("emby_last_trigger_message", "");
  insert.run("emby_last_triggered_at", "");
  insert.run("setup_complete", "false");
}

function randomCredential(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

function seedExternalProfiles() {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO external_profiles (name, enabled, token, xc_username, xc_password, output_mode)
     VALUES (?, 1, ?, ?, ?, 'hls')`
  );
  insert.run("Emby", randomCredential(), "emby", randomCredential(12));
  insert.run("Others", randomCredential(), "others", randomCredential(12));
}

function seedProviderProfiles() {
  const database = getDb();
  const count = database.prepare("SELECT COUNT(*) AS count FROM provider_profiles").get() as { count: number };
  if (count.count > 0) return;

  const username = setting("xc_username");
  const password = setting("xc_password");
  if (!username || !password) return;

  database
    .prepare(
      `INSERT INTO provider_profiles (name, enabled, is_primary, username, password, max_connections, sort_order)
       VALUES ('Primary', 1, 1, ?, ?, 1, 0)`
    )
    .run(username, password);
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
