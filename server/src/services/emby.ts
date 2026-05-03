import { setSetting, setting } from "../db/database.js";

export interface EmbyTask {
  id: string;
  name: string;
  category: string;
  state: string;
  key: string;
}

export interface EmbyStatus {
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

export interface EmbyNowPlayingSession {
  id: string;
  userId: string;
  userName: string;
  client: string;
  deviceName: string;
  deviceId: string;
  remoteEndPoint: string;
  lastActivityDate: string;
  playState: {
    isPaused: boolean | null;
    playMethod: string;
    positionTicks: number | null;
  };
  nowPlaying: {
    id: string;
    name: string;
    type: string;
    mediaType: string;
    channelId: string;
    channelName: string;
    mediaSourceId: string;
    mediaSourcePath: string;
    sstvChannelId: number | null;
  } | null;
}

function boolSetting(key: string, fallback = false) {
  const value = setting(key, fallback ? "true" : "false").toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function embyApiPath(baseUrl: string, path: string) {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base.endsWith("/emby") ? `${base}${normalizedPath}` : `${base}/emby${normalizedPath}`;
}

function embyCredentials() {
  return {
    baseUrl: setting("emby_base_url"),
    apiKey: setting("emby_api_key")
  };
}

function getEmbyFetchHeaders() {
  return {
    "accept": "application/json",
    "user-agent": "SSTV IPTV/1.0",
    "x-emby-token": setting("emby_api_key")
  };
}

function asString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => record(item)) : [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = asString(value).trim();
    if (text) return text;
  }
  return "";
}

function parseSstvChannelId(...values: unknown[]) {
  const text = values.map((value) => asString(value)).filter(Boolean).join(" ");
  const tvgMatch = text.match(/\bsstv-(\d+)\b/i);
  if (tvgMatch) return Number(tvgMatch[1]);

  const tokenMatch = text.match(/\/external\/live\/[^/\s]+\/(\d+)(?:\.ts|\/hls|\/|(?:\?|$))/i);
  if (tokenMatch) return Number(tokenMatch[1]);

  const xcMatch = text.match(/\/live\/[^/\s]+\/[^/\s]+\/(\d+)(?:\.ts|\/hls|\/|(?:\?|$))/i);
  if (xcMatch) return Number(xcMatch[1]);

  return null;
}

function mapTask(task: Record<string, unknown>): EmbyTask {
  return {
    id: asString(task.Id ?? task.id),
    name: asString(task.Name ?? task.name),
    category: asString(task.Category ?? task.category),
    state: asString(task.State ?? task.state),
    key: asString(task.Key ?? task.key)
  };
}

function guideTaskScore(task: EmbyTask) {
  const haystack = `${task.name} ${task.category} ${task.key}`.toLowerCase();
  let score = 0;
  if (haystack.includes("guide")) score += 4;
  if (haystack.includes("refresh")) score += 3;
  if (haystack.includes("live")) score += 2;
  if (haystack.includes("tv")) score += 1;
  if (haystack.includes("xmltv")) score += 1;
  return score;
}

function rememberEmbyTrigger(status: "success" | "failed" | "skipped", message: string) {
  setSetting("emby_last_trigger_status", status);
  setSetting("emby_last_trigger_message", message.slice(0, 1000));
  setSetting("emby_last_triggered_at", new Date().toISOString());
}

export function embyStatus(): EmbyStatus {
  const { baseUrl, apiKey } = embyCredentials();
  return {
    enabled: boolSetting("emby_enabled"),
    configured: Boolean(baseUrl && apiKey),
    refreshAfterProviderRefresh: boolSetting("emby_refresh_after_provider_refresh"),
    baseUrl,
    apiKeySet: Boolean(apiKey),
    refreshTaskId: setting("emby_refresh_task_id"),
    refreshTaskName: setting("emby_refresh_task_name"),
    lastStatus: setting("emby_last_trigger_status"),
    lastMessage: setting("emby_last_trigger_message"),
    lastTriggeredAt: setting("emby_last_triggered_at")
  };
}

function mapEmbySession(session: Record<string, unknown>): EmbyNowPlayingSession {
  const item = record(session.NowPlayingItem ?? session.nowPlayingItem);
  const playState = record(session.PlayState ?? session.playState);
  const mediaSources = recordArray(item.MediaSources ?? item.mediaSources);
  const mediaSource = mediaSources[0] ?? {};
  const mediaSourcePath = firstString(
    item.Path,
    item.path,
    item.Url,
    item.url,
    item.MediaUrl,
    item.mediaUrl,
    mediaSource.Path,
    mediaSource.path,
    mediaSource.Url,
    mediaSource.url
  );
  const mediaSourceId = firstString(
    item.MediaSourceId,
    item.mediaSourceId,
    mediaSource.Id,
    mediaSource.id
  );
  const channelId = firstString(
    item.ChannelId,
    item.channelId,
    item.ExternalId,
    item.externalId,
    item.ProviderIds && record(item.ProviderIds).Sstv,
    item.ProviderIds && record(item.ProviderIds).XmlTv
  );
  const channelName = firstString(item.ChannelName, item.channelName, item.SeriesName, item.seriesName);
  const itemName = firstString(item.Name, item.name);
  const itemId = firstString(item.Id, item.id);
  const sstvChannelId = parseSstvChannelId(
    itemId,
    channelId,
    channelName,
    itemName,
    mediaSourceId,
    mediaSourcePath
  );

  return {
    id: firstString(session.Id, session.id),
    userId: firstString(session.UserId, session.userId),
    userName: firstString(session.UserName, session.userName),
    client: firstString(session.Client, session.client),
    deviceName: firstString(session.DeviceName, session.deviceName),
    deviceId: firstString(session.DeviceId, session.deviceId),
    remoteEndPoint: firstString(session.RemoteEndPoint, session.remoteEndPoint),
    lastActivityDate: firstString(session.LastActivityDate, session.lastActivityDate),
    playState: {
      isPaused: asBoolean(playState.IsPaused ?? playState.isPaused),
      playMethod: firstString(playState.PlayMethod, playState.playMethod),
      positionTicks: asNumber(playState.PositionTicks ?? playState.positionTicks)
    },
    nowPlaying: Object.keys(item).length === 0 ? null : {
      id: itemId,
      name: itemName,
      type: firstString(item.Type, item.type),
      mediaType: firstString(item.MediaType, item.mediaType),
      channelId,
      channelName,
      mediaSourceId,
      mediaSourcePath,
      sstvChannelId
    }
  };
}

export async function listEmbyTasks() {
  const { baseUrl, apiKey } = embyCredentials();
  if (!baseUrl || !apiKey) throw new Error("Emby server URL and API key are required.");

  const response = await fetch(embyApiPath(baseUrl, "/ScheduledTasks"), {
    headers: getEmbyFetchHeaders()
  });
  if (!response.ok) {
    throw new Error(`Emby scheduled tasks request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("Emby returned an unexpected scheduled tasks response.");

  const tasks = body.map((task) => mapTask(task as Record<string, unknown>)).filter((task) => task.id && task.name);
  const suggestedTask = [...tasks].sort((a, b) => guideTaskScore(b) - guideTaskScore(a))[0] ?? null;
  const suggestedTaskId = suggestedTask && guideTaskScore(suggestedTask) > 0 ? suggestedTask.id : "";
  return { tasks, suggestedTaskId };
}

export async function listEmbySessions() {
  const { baseUrl, apiKey } = embyCredentials();
  if (!baseUrl || !apiKey) throw new Error("Emby server URL and API key are required.");

  const response = await fetch(embyApiPath(baseUrl, "/Sessions?IsPlaying=true"), {
    headers: getEmbyFetchHeaders()
  });
  if (!response.ok) {
    throw new Error(`Emby sessions request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("Emby returned an unexpected sessions response.");
  return {
    sessions: body
      .map((session) => mapEmbySession(record(session)))
      .filter((session) => session.id || session.userName || session.nowPlaying)
  };
}

export async function triggerEmbyGuideRefresh(taskId?: string) {
  const { baseUrl, apiKey } = embyCredentials();
  if (!baseUrl || !apiKey) throw new Error("Emby server URL and API key are required.");

  let id = taskId || setting("emby_refresh_task_id");
  if (!id) {
    const discovery = await listEmbyTasks();
    id = discovery.suggestedTaskId;
    const task = discovery.tasks.find((item) => item.id === id);
    if (task) {
      setSetting("emby_refresh_task_id", task.id);
      setSetting("emby_refresh_task_name", task.name);
    }
  }
  if (!id) throw new Error("Unable to find an Emby guide refresh scheduled task.");

  const response = await fetch(embyApiPath(baseUrl, `/ScheduledTasks/Running/${encodeURIComponent(id)}`), {
    method: "POST",
    headers: getEmbyFetchHeaders()
  });
  if (!response.ok) {
    throw new Error(`Emby guide refresh trigger failed: ${response.status} ${response.statusText}`);
  }

  const message = "Emby guide refresh started.";
  rememberEmbyTrigger("success", message);
  return { ok: true, taskId: id, message };
}

export async function triggerEmbyGuideRefreshAfterProviderRefresh() {
  const status = embyStatus();
  if (!status.enabled || !status.refreshAfterProviderRefresh) return null;
  if (!status.configured) {
    rememberEmbyTrigger("skipped", "Emby integration is enabled, but the server URL or API key is missing.");
    return null;
  }

  try {
    return await triggerEmbyGuideRefresh(status.refreshTaskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberEmbyTrigger("failed", message);
    return { ok: false, taskId: status.refreshTaskId, message };
  }
}
