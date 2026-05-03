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
  programs?: Program[];
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

export interface StreamStatus {
  active: boolean;
  exitCode?: number | null;
  files: Array<{ name: string; size: number; modified: string }>;
  mode?: "normal" | "videoOnly" | "audioOnly";
  playlist?: string;
  stderr?: string;
  message?: string;
  trace?: {
    completedSegmentCount: number;
    events: Array<{ at: string; message: string }>;
    inputBytes: number;
    inputMode?: "ffmpeg-direct" | "node-pipe";
    lastInputAgeMs: number | null;
    latestSegment: { name: string; size: number; modified: string } | null;
    latestSegmentAgeMs: number | null;
    playlistAgeMs: number | null;
    playlistStats: {
      mediaSequence: number;
      segmentCount: number;
      targetDuration: number;
      windowSeconds: number;
    };
    quality: StreamQualityPair;
    requests: {
      playlist: number;
      segment: number;
      lastPlaylistAgeMs: number | null;
      lastSegmentAgeMs: number | null;
      lastSegmentName: string;
    };
    runtimeMs: number;
    settings: {
      inputMode: "ffmpeg-direct" | "node-pipe";
      dvrWindowMinutes: number;
      reconnectDelayMax: number;
      rwTimeoutSeconds: number;
      segmentSeconds: number;
      staleRestartSeconds: number;
    };
    startedAt: string;
    tempFiles: string[];
  };
}

export interface StreamQuality {
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
}

export interface StreamQualityPair {
  input: StreamQuality;
  output: StreamQuality;
}

export interface StreamMonitorClient {
  id: string;
  bytesServed: number;
  externalProfileId: number | null;
  externalProfileName: string | null;
  firstSeen: string;
  ip: string;
  lastPlaylistAt: string | null;
  lastRequestKind: "playlist" | "segment" | "stream";
  lastSeen: string;
  lastSeenAgeMs: number;
  lastSegmentAt: string | null;
  lastSegmentName: string;
  playlistRequests: number;
  providerProfileId: number | null;
  providerProfileName: string | null;
  providerProfileUsername: string | null;
  role: string;
  segmentRequests: number;
  source: "browser" | "external";
  userAgent: string;
  userId: number | null;
  username: string;
}

export interface StreamMonitorStream {
  active: boolean;
  channelId: number;
  channelLogoUrl: string;
  channelName: string;
  channelNumber: number | null;
  clientCount: number;
  clients: StreamMonitorClient[];
  exitCode: number | null;
  ffmpegSpeed: string | null;
  groupTitle: string;
  inputBytes: number;
  inputMode: "ffmpeg-direct" | "node-pipe";
  lastAccess: string;
  latestSegmentAgeMs: number | null;
  mode: "normal" | "videoOnly" | "audioOnly";
  outputType: "hls" | "mpegts";
  playlistRequests: number;
  providerProfileId: number | null;
  providerProfileName: string | null;
  providerProfileUsername: string | null;
  providerConnectionCount: number;
  quality: StreamQualityPair;
  runtimeMs: number;
  segmentRequests: number;
  startedAt: string;
  tempFileCount: number;
}

export interface StreamMonitor {
  activeClientCount: number;
  providerConnectionCount: number;
  refreshedAt: string;
  streamCount: number;
  streams: StreamMonitorStream[];
}

export interface ChannelGroup {
  id: number;
  name: string;
  enabled: 0 | 1;
  sort_order: number;
  use_channel_name_for_epg: 0 | 1;
  channel_count: number;
  first_channel_number: number | null;
  last_channel_number: number | null;
}

export interface ExternalProfile {
  id: number;
  name: string;
  enabled: 0 | 1;
  token: string;
  xc_username: string;
  xc_password: string;
  output_mode: "hls" | "mpegts";
  created_at: string;
  updated_at: string;
}

export interface ProviderProfile {
  id: number;
  name: string;
  enabled: 0 | 1;
  is_primary: 0 | 1;
  username: string;
  password: string;
  max_connections: number;
  sort_order: number;
  account_status: string | null;
  account_expires_at: string | null;
  account_days_left: number | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmbyIntegrationStatus {
  enabled: boolean;
  configured: boolean;
  refreshAfterProviderRefresh: boolean;
  baseUrl: string;
  apiKeySet: boolean;
  refreshTaskId: string;
  refreshTaskName: string;
  lastStatus: string;
  lastMessage: string;
  lastTriggeredAt: string;
}

export interface EmbyTask {
  id: string;
  name: string;
  category: string;
  state: string;
  key: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
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
  currentGuide: (params = "") => request<{ airing: Airing[]; at: string; start: string; end: string; total: number; limit: number; offset: number; hasMore: boolean }>(`/api/guide/current${params}`),
  channels: (params = "") => request<{ channels: Channel[]; groups: string[] }>(`/api/channels${params}`),
  channelGuide: (id: string, params = "") => request<{ channel: Channel; programs: Program[] }>(`/api/guide/channel/${id}${params}`),
  search: (q: string) => request<{ channels: Channel[]; programs: Array<Program & { channel_id: number; channel_name: string; logo_url: string }> }>(`/api/search?q=${encodeURIComponent(q)}`),
  favorites: () => request<{ favorites: Channel[] }>("/api/favorites"),
  addFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "POST" }),
  removeFavorite: (id: number) => request<{ ok: true }>(`/api/favorites/${id}`, { method: "DELETE" }),
  streamStatus: (id: number, ensure = false) =>
    request<StreamStatus>(`/api/stream/${id}/hls/status?ensure=${ensure ? "1" : "0"}&_=${Date.now()}`, {
      cache: "no-store"
    }),
  releaseStream: (id: number, clientSession: string) =>
    request<{ ok: true; stopped: boolean }>(`/api/stream/${id}/hls/release?clientSession=${encodeURIComponent(clientSession)}`, { method: "POST" }),
  settings: () => request<{
    xcBaseUrl: string;
    xcUsername: string;
    xcPasswordSet: boolean;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexServerIdentifier: string;
    ffmpegHlsInputMode: "direct" | "pipe";
    ffmpegHlsDvrWindowMinutes: number;
    ffmpegReconnectDelayMax: number;
    ffmpegRwTimeoutSeconds: number;
    ffmpegStaleRestartSeconds: number;
    externalInternalBaseUrl: string;
    externalPublicBaseUrl: string;
    externalProfiles: ExternalProfile[];
    providerProfiles: ProviderProfile[];
    emby: EmbyIntegrationStatus;
    plex: { configured: boolean; serverReachable: boolean };
  }>("/api/admin/settings"),
  saveSettings: (body: {
    xcBaseUrl: string;
    xcUsername: string;
    xcPassword?: string;
    xmltvUrl: string;
    refreshIntervalHours: number;
    plexServerIdentifier: string;
    ffmpegHlsInputMode: "direct" | "pipe";
    ffmpegHlsDvrWindowMinutes: number;
    ffmpegReconnectDelayMax: number;
    ffmpegRwTimeoutSeconds: number;
    ffmpegStaleRestartSeconds: number;
    externalInternalBaseUrl: string;
    externalPublicBaseUrl: string;
    embyEnabled: boolean;
    embyBaseUrl: string;
    embyRefreshAfterProviderRefresh: boolean;
    embyRefreshTaskId: string;
    embyRefreshTaskName: string;
    embyApiKey?: string;
  }) =>
    request<{ ok: true }>("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
  embyTasks: () => request<{ tasks: EmbyTask[]; suggestedTaskId: string }>("/api/admin/emby/tasks"),
  triggerEmbyRefresh: () => request<{ ok: true; taskId: string; message: string }>("/api/admin/emby/trigger", { method: "POST" }),
  refresh: () => request<{ started: boolean; progress: RefreshProgress }>("/api/admin/refresh", { method: "POST" }),
  refreshStatus: () => request<RefreshProgress>("/api/admin/refresh-status"),
  refreshRuns: () => request<{ runs: Array<Record<string, string | number | null>> }>("/api/admin/refresh-runs"),
  users: () => request<{ users: Array<Record<string, string | number | null>> }>("/api/admin/users"),
  streams: () => request<StreamMonitor>("/api/admin/streams"),
  externalProfiles: () => request<{ profiles: ExternalProfile[] }>("/api/admin/external-profiles"),
  updateExternalProfile: (id: number, body: { enabled?: boolean; outputMode?: "hls" | "mpegts"; xcUsername?: string }) =>
    request<{ profile: ExternalProfile; profiles: ExternalProfile[] }>(`/api/admin/external-profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  regenerateExternalToken: (id: number) =>
    request<{ profile: ExternalProfile; profiles: ExternalProfile[] }>(`/api/admin/external-profiles/${id}/regenerate-token`, { method: "POST" }),
  regenerateExternalPassword: (id: number) =>
    request<{ profile: ExternalProfile; profiles: ExternalProfile[] }>(`/api/admin/external-profiles/${id}/regenerate-password`, { method: "POST" }),
  createProviderProfile: (body: {
    maxConnections?: number;
    name: string;
    password: string;
    username: string;
  }) => request<{ profile: ProviderProfile; profiles: ProviderProfile[] }>("/api/admin/provider-profiles", { method: "POST", body: JSON.stringify(body) }),
  updateProviderProfile: (id: number, body: { enabled?: boolean; maxConnections?: number; name?: string; password?: string; username?: string }) =>
    request<{ profile: ProviderProfile; profiles: ProviderProfile[] }>(`/api/admin/provider-profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProviderProfile: (id: number) =>
    request<{ ok: true; profiles: ProviderProfile[] }>(`/api/admin/provider-profiles/${id}`, { method: "DELETE" }),
  checkProviderProfile: (id: number) =>
    request<{ profile: ProviderProfile; profiles: ProviderProfile[] }>(`/api/admin/provider-profiles/${id}/check`, { method: "POST" }),
  groups: () => request<{ groups: ChannelGroup[] }>("/api/admin/groups"),
  updateGroup: (id: number, body: { enabled?: boolean; useChannelNameForEpg?: boolean }) =>
    request<{ groups: ChannelGroup[] }>(`/api/admin/groups/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  groupChannels: (id: number) => request<{ group: { id: number; name: string }; channels: Channel[] }>(`/api/admin/groups/${id}/channels`),
  saveGroupOrder: (ids: number[]) =>
    request<{ groups: ChannelGroup[] }>("/api/admin/groups/order", { method: "PUT", body: JSON.stringify({ ids }) }),
  defaultGroupSortConfig: () => request<{ prefixes: string[]; order: string[] }>("/api/admin/groups/default-sort"),
  saveDefaultGroupSort: (prefixes: string[]) =>
    request<{ groups: ChannelGroup[]; prefixes: string[]; order: string[] }>("/api/admin/groups/default-sort", { method: "PUT", body: JSON.stringify({ prefixes }) }),
  defaultSortGroups: () => request<{ groups: ChannelGroup[] }>("/api/admin/groups/default-sort", { method: "POST" }),
  recalculateGroups: () => request<{ groups: ChannelGroup[] }>("/api/admin/groups/recalculate", { method: "POST" })
};
