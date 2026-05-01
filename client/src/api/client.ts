export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  auth_provider: "local" | "plex";
}

export interface Channel {
  id: number;
  display_name: string;
  logo_url: string;
  group_title: string;
  stream_url: string;
  channel_number: number | null;
  sort_order: number;
  favorite?: 0 | 1;
}

export interface Program {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  start_time: string;
  end_time: string;
}

export interface Airing {
  channel_id: number;
  display_name: string;
  logo_url: string;
  group_title: string;
  stream_url: string;
  channel_number: number | null;
  sort_order: number;
  program_id: number | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  favorite: 0 | 1;
  upcoming?: Program[];
}

export interface PlexServer {
  name: string;
  product: string;
  clientIdentifier: string;
  owned: boolean;
}

export interface RefreshProgress {
  active: boolean;
  runId: number | null;
  stage: string;
  detail: string;
  channelCount: number;
  programCount: number;
  totalProgramCount: number;
  savedChannelCount: number;
  savedProgramCount: number;
  matchedCount: number;
  startedAt: string | null;
  updatedAt: string | null;
  error: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export const api = {
  setupStatus: () => request<{ setupRequired: boolean }>("/api/setup/status"),
  setupDefaults: () => request<{
    xcBaseUrl: string;
    xcUsername: string;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexProductName: string;
  }>("/api/setup/defaults"),
  createSetupPlexPin: () => request<{ id: number; code: string; authUrl: string }>("/api/setup/plex/pin", { method: "POST" }),
  pollSetupPlexPin: (id: number) => request<{
    authenticated: boolean;
    token?: string;
    user?: { id: number; username: string };
    servers?: PlexServer[];
  }>(`/api/setup/plex/pin/${id}`),
  completeSetup: (body: {
    adminUsername: string;
    adminPassword: string;
    xcBaseUrl: string;
    xcUsername: string;
    xcPassword: string;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexToken?: string;
    plexServerIdentifier?: string;
    plexServerName?: string;
  }) => request<{ ok: true }>("/api/setup/complete", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<{ user: User | null; setupRequired: boolean }>("/api/auth/me"),
  adminLogin: (username: string, password: string) =>
    request<{ ok: true }>("/api/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  createPlexPin: () => request<{ id: number; code: string; authUrl: string }>("/api/auth/plex/pin", { method: "POST" }),
  pollPlexPin: (id: number) => request<{ authenticated: boolean }>(`/api/auth/plex/pin/${id}`),
  currentGuide: (params = "") => request<{ airing: Airing[]; at: string; total: number; limit: number; offset: number; hasMore: boolean }>(`/api/guide/current${params}`),
  channels: (params = "") => request<{ channels: Channel[]; groups: string[] }>(`/api/channels${params}`),
  channelGuide: (id: string) => request<{ channel: Channel; programs: Program[] }>(`/api/guide/channel/${id}`),
  search: (q: string) => request<{ channels: Channel[]; programs: Array<Program & { channel_id: number; channel_name: string; logo_url: string }> }>(`/api/search?q=${encodeURIComponent(q)}`),
  favorites: () => request<{ favorites: Channel[] }>("/api/favorites"),
  addFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "POST" }),
  removeFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "DELETE" }),
  settings: () => request<{
    xcBaseUrl: string;
    xcUsername: string;
    xcPasswordSet: boolean;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexServerIdentifier: string;
    plex: { configured: boolean; serverReachable: boolean };
  }>("/api/admin/settings"),
  saveSettings: (body: { xcBaseUrl: string; xcUsername: string; xcPassword?: string; xmltvUrl: string; refreshIntervalHours: number; plexServerIdentifier: string }) =>
    request<{ ok: true }>("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
  refresh: () => request<{ started: boolean; progress: RefreshProgress }>("/api/admin/refresh", { method: "POST" }),
  refreshStatus: () => request<RefreshProgress>("/api/admin/refresh-status"),
  refreshRuns: () => request<{ runs: Array<Record<string, string | number | null>> }>("/api/admin/refresh-runs"),
  users: () => request<{ users: Array<Record<string, string | number | null>> }>("/api/admin/users")
};
