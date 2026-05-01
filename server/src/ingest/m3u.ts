import type { ParsedM3uChannel } from "../types/app.js";

const attrPattern = /([\w-]+)="([^"]*)"/g;

export function parseM3u(input: string): ParsedM3uChannel[] {
  const lines = input.replace(/\r/g, "").split("\n");
  const channels: ParsedM3uChannel[] = [];
  let pending: Record<string, string> | null = null;
  let pendingName = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "#EXTM3U") continue;

    if (line.startsWith("#EXTINF")) {
      pending = {};
      pendingName = "";
      for (const match of line.matchAll(attrPattern)) {
        pending[match[1].toLowerCase()] = match[2].trim();
      }
      const commaIndex = line.lastIndexOf(",");
      pendingName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
      continue;
    }

    if (pending && !line.startsWith("#")) {
      const displayName = pendingName || pending["tvg-name"] || pending["tvg-id"] || "Unnamed Channel";
      channels.push({
        tvgId: pending["tvg-id"] ?? "",
        tvgName: pending["tvg-name"] ?? displayName,
        displayName,
        logoUrl: pending["tvg-logo"] ?? "",
        groupTitle: pending["group-title"] ?? "Ungrouped",
        streamUrl: line
      });
      pending = null;
      pendingName = "";
    }
  }

  return channels.filter((channel) => channel.streamUrl);
}
