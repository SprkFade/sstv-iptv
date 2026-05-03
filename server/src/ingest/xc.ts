import type { ParsedM3uChannel } from "../types/app.js";

interface XcLiveStream {
  name?: string;
  num?: number | string;
  stream_id?: number | string;
  stream_icon?: string;
  epg_channel_id?: string;
  category_id?: string | number;
  direct_source?: string;
  custom_sid?: string;
}

interface XcCategory {
  category_id?: string | number;
  category_name?: string;
}

export interface XcCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

function normalizedBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function xcApiUrl(credentials: XcCredentials, action?: string) {
  const base = normalizedBaseUrl(credentials.baseUrl);
  const url = new URL(`${base}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  if (action) url.searchParams.set("action", action);
  return url.toString();
}

export function xcXmltvUrl(credentials: XcCredentials) {
  const base = normalizedBaseUrl(credentials.baseUrl);
  const url = new URL(`${base}/xmltv.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  return url.toString();
}

function xcStreamUrl(credentials: XcCredentials, streamId: string) {
  const base = normalizedBaseUrl(credentials.baseUrl);
  return `${base}/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${encodeURIComponent(streamId)}.ts`;
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "SSTV IPTV/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${label}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchXcChannels(credentials: XcCredentials): Promise<ParsedM3uChannel[]> {
  const [streams, categories] = await Promise.all([
    fetchJson<XcLiveStream[]>(xcApiUrl(credentials, "get_live_streams"), "XtremeCodes live streams"),
    fetchJson<XcCategory[]>(xcApiUrl(credentials, "get_live_categories"), "XtremeCodes categories").catch(() => [])
  ]);

  if (!Array.isArray(streams)) {
    throw new Error("XtremeCodes live stream response was not a channel list.");
  }

  const categoryNames = new Map(
    (Array.isArray(categories) ? categories : []).map((category) => [
      String(category.category_id ?? ""),
      category.category_name || "Ungrouped"
    ])
  );

  return streams
    .map((stream, index) => {
      const streamId = String(stream.stream_id ?? "");
      const channelNumber = Number(stream.num);
      const displayName = stream.name?.trim() || `Channel ${streamId}`;
      const tvgId = stream.epg_channel_id?.trim() || stream.custom_sid?.trim() || "";
      const groupTitle = categoryNames.get(String(stream.category_id ?? "")) ?? "Ungrouped";
      return {
        sourceId: streamId ? `xc:${streamId}` : undefined,
        tvgId,
        tvgName: displayName,
        displayName,
        logoUrl: stream.stream_icon?.trim() || "",
        groupTitle,
        streamUrl: stream.direct_source?.trim() || (streamId ? xcStreamUrl(credentials, streamId) : ""),
        channelNumber: Number.isFinite(channelNumber) && channelNumber > 0 ? channelNumber : null,
        sortOrder: index
      };
    })
    .filter((channel) => channel.streamUrl);
}
