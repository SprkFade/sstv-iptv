import type Database from "better-sqlite3";
import { getDb, setting } from "../db/database.js";
import type { ProviderProfile } from "../types/app.js";

type ProviderAccountResponse = {
  user_info?: {
    active_cons?: number | string;
    exp_date?: number | string | null;
    max_connections?: number | string;
    status?: string;
  };
};

export type ProviderProfileInput = {
  enabled?: boolean;
  name?: string;
  username?: string;
  password?: string;
  maxConnections?: number;
};

export type GeneratedProviderProfileInput = {
  maxConnections?: number;
  name: string;
  passwordPattern: string;
  passwordReplacement: string;
  usernamePattern: string;
  usernameReplacement: string;
};

export function listProviderProfiles(db = getDb()) {
  syncPrimaryProviderProfile(undefined, undefined, db);
  return db
    .prepare(
      `SELECT id, name, enabled, is_primary, username, password, max_connections, sort_order,
              account_status, account_expires_at, account_days_left, last_checked_at,
              created_at, updated_at
       FROM provider_profiles
       ORDER BY sort_order, id`
    )
    .all() as ProviderProfile[];
}

export function syncPrimaryProviderProfile(username?: string, password?: string, db = getDb()) {
  const primaryUsername = username ?? setting("xc_username");
  const primaryPassword = password ?? setting("xc_password");
  if (!primaryUsername || !primaryPassword) return null;

  const existing = db.prepare("SELECT id FROM provider_profiles WHERE is_primary = 1 LIMIT 1").get() as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE provider_profiles
       SET name = 'Primary',
           enabled = 1,
           username = ?,
           password = ?,
           sort_order = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(primaryUsername, primaryPassword, existing.id);
    return existing.id;
  }

  const result = db.prepare(
    `INSERT INTO provider_profiles (name, enabled, is_primary, username, password, max_connections, sort_order)
     VALUES ('Primary', 1, 1, ?, ?, 1, 0)`
  ).run(primaryUsername, primaryPassword);
  return Number(result.lastInsertRowid);
}

export function updateProviderProfile(id: number, body: ProviderProfileInput, db = getDb()) {
  const existing = db.prepare("SELECT id, is_primary FROM provider_profiles WHERE id = ?").get(id) as { id: number; is_primary: number } | undefined;
  if (!existing) return null;

  if (typeof body.enabled === "boolean" && !existing.is_primary) {
    db.prepare("UPDATE provider_profiles SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.enabled ? 1 : 0, id);
  }
  if (body.name && !existing.is_primary) {
    db.prepare("UPDATE provider_profiles SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.name, id);
  }
  if (body.username && !existing.is_primary) {
    db.prepare("UPDATE provider_profiles SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.username, id);
  }
  if (body.password && !existing.is_primary) {
    db.prepare("UPDATE provider_profiles SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.password, id);
  }
  if (typeof body.maxConnections === "number") {
    db.prepare("UPDATE provider_profiles SET max_connections = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(Math.max(1, Math.round(body.maxConnections)), id);
  }

  return listProviderProfiles(db).find((profile) => profile.id === id) ?? null;
}

export function createGeneratedProviderProfile(body: GeneratedProviderProfileInput, db = getDb()) {
  const primary = listProviderProfiles(db).find((profile) => profile.is_primary);
  if (!primary) throw new Error("Primary provider profile is not configured.");

  const usernameRegex = new RegExp(body.usernamePattern);
  const passwordRegex = new RegExp(body.passwordPattern);
  const username = primary.username.replace(usernameRegex, body.usernameReplacement);
  const password = primary.password.replace(passwordRegex, body.passwordReplacement);
  if (username === primary.username && password === primary.password) {
    throw new Error("Regex replacements did not change the primary username or password.");
  }

  const nextSort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM provider_profiles").get() as { next: number };
  const result = db.prepare(
    `INSERT INTO provider_profiles (name, enabled, is_primary, username, password, max_connections, sort_order)
     VALUES (?, 1, 0, ?, ?, ?, ?)`
  ).run(body.name, username, password, Math.max(1, Math.round(body.maxConnections ?? 1)), nextSort.next);
  return listProviderProfiles(db).find((profile) => profile.id === Number(result.lastInsertRowid)) ?? null;
}

export function deleteProviderProfile(id: number, db = getDb()) {
  const result = db.prepare("DELETE FROM provider_profiles WHERE id = ? AND is_primary = 0").run(id);
  return result.changes > 0;
}

export function providerStreamUrl(streamUrl: string, profile: Pick<ProviderProfile, "username" | "password">) {
  try {
    const url = new URL(streamUrl);
    const segments = url.pathname.split("/");
    const liveIndex = segments.findIndex((segment) => segment.toLowerCase() === "live");
    if (liveIndex >= 0 && segments[liveIndex + 1] && segments[liveIndex + 2]) {
      segments[liveIndex + 1] = encodeURIComponent(profile.username);
      segments[liveIndex + 2] = encodeURIComponent(profile.password);
      url.pathname = segments.join("/");
      return url.toString();
    }
    if (url.searchParams.has("username")) url.searchParams.set("username", profile.username);
    if (url.searchParams.has("password")) url.searchParams.set("password", profile.password);
    return url.toString();
  } catch {
    return streamUrl
      .replace(/(\/live\/)[^/\s]+\/[^/\s]+\//, `$1${encodeURIComponent(profile.username)}/${encodeURIComponent(profile.password)}/`);
  }
}

export async function refreshProviderAccount(profileId: number, db = getDb()) {
  const profile = listProviderProfiles(db).find((item) => item.id === profileId);
  if (!profile) return null;

  const baseUrl = setting("xc_base_url").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("XtremeCodes server URL is not configured.");

  const url = new URL(`${baseUrl}/player_api.php`);
  url.searchParams.set("username", profile.username);
  url.searchParams.set("password", profile.password);

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "SSTV IPTV/1.0"
    }
  });
  if (!response.ok) throw new Error(`Provider account check failed: ${response.status} ${response.statusText}`);

  const body = await response.json() as ProviderAccountResponse;
  const userInfo = body.user_info ?? {};
  const expDate = Number(userInfo.exp_date ?? NaN);
  const maxConnections = Number(userInfo.max_connections ?? NaN);
  const expiresAt = Number.isFinite(expDate) && expDate > 0 ? new Date(expDate * 1000) : null;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)) : null;

  db.prepare(
    `UPDATE provider_profiles
     SET account_status = ?,
         account_expires_at = ?,
         account_days_left = ?,
         max_connections = CASE WHEN ? > 0 THEN ? ELSE max_connections END,
         last_checked_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    userInfo.status ?? "",
    expiresAt?.toISOString() ?? null,
    daysLeft,
    Number.isFinite(maxConnections) ? maxConnections : 0,
    Number.isFinite(maxConnections) ? maxConnections : 0,
    profile.id
  );

  return listProviderProfiles(db).find((item) => item.id === profile.id) ?? null;
}
