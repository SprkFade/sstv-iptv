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
  program_id: number | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  favorite: 0 | 1;
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
  me: () => request<{ user: User | null }>("/api/auth/me"),
  adminLogin: (username: string, password: string) =>
    request<{ ok: true }>("/api/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  createPlexPin: () => request<{ id: number; code: string; authUrl: string }>("/api/auth/plex/pin", { method: "POST" }),
  pollPlexPin: (id: number) => request<{ authenticated: boolean }>(`/api/auth/plex/pin/${id}`),
  currentGuide: () => request<{ airing: Airing[]; at: string }>("/api/guide/current"),
  channels: (params = "") => request<{ channels: Channel[]; groups: string[] }>(`/api/channels${params}`),
  channelGuide: (id: string) => request<{ channel: Channel; programs: Program[] }>(`/api/guide/channel/${id}`),
  search: (q: string) => request<{ channels: Channel[]; programs: Array<Program & { channel_id: number; channel_name: string; logo_url: string }> }>(`/api/search?q=${encodeURIComponent(q)}`),
  favorites: () => request<{ favorites: Channel[] }>("/api/favorites"),
  addFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "POST" }),
  removeFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "DELETE" }),
  settings: () => request<{
    m3uUrl: string;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexServerIdentifier: string;
    plex: { configured: boolean; serverReachable: boolean };
  }>("/api/admin/settings"),
  saveSettings: (body: { m3uUrl: string; xmltvUrl: string; refreshIntervalHours: number; plexServerIdentifier: string }) =>
    request<{ ok: true }>("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
  refresh: () => request<{ id: number; status: string; channelCount: number; programCount: number; matchedCount: number }>("/api/admin/refresh", { method: "POST" }),
  refreshRuns: () => request<{ runs: Array<Record<string, string | number | null>> }>("/api/admin/refresh-runs"),
  users: () => request<{ users: Array<Record<string, string | number | null>> }>("/api/admin/users")
};
