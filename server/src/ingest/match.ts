import type { ParsedM3uChannel, XmltvChannel } from "../types/app.js";
import { normalizeName, similarity } from "../utils/normalize.js";

export type ChannelMatchMethod = "tvg-id" | "exact-name" | "normalized-name" | "fuzzy";

export interface ChannelMatch {
  channel: XmltvChannel;
  method: ChannelMatchMethod;
  score: number;
}

export function matchChannels(m3uChannels: ParsedM3uChannel[], xmltvChannels: XmltvChannel[]) {
  const byId = new Map(xmltvChannels.map((channel) => [channel.id.toLowerCase(), channel]));
  const byName = new Map(xmltvChannels.map((channel) => [channel.displayName.toLowerCase(), channel]));
  const byNormalizedName = new Map(
    xmltvChannels.map((channel) => [normalizeName(channel.displayName), channel])
  );

  let matchedCount = 0;
  const result = new Map<number, ChannelMatch>();

  m3uChannels.forEach((channel, index) => {
    let match: XmltvChannel | undefined;
    let method: ChannelMatchMethod | undefined;
    let score = 0;
    if (channel.tvgId) {
      match = byId.get(channel.tvgId.toLowerCase());
      if (match) {
        method = "tvg-id";
        score = 1;
      }
    }
    if (!match && channel.tvgName) {
      match = byName.get(channel.tvgName.toLowerCase());
      if (match) {
        method = "exact-name";
        score = 1;
      }
    }
    if (!match) {
      match = byNormalizedName.get(normalizeName(channel.tvgName || channel.displayName));
      if (match) {
        method = "normalized-name";
        score = 1;
      }
    }

    if (!match) {
      let bestScore = 0;
      for (const candidate of xmltvChannels) {
        const score = Math.max(
          similarity(channel.displayName, candidate.displayName),
          similarity(channel.tvgName, candidate.displayName)
        );
        if (score > bestScore) {
          bestScore = score;
          match = candidate;
        }
      }
      if (bestScore < 0.72) {
        match = undefined;
      } else {
        method = "fuzzy";
        score = bestScore;
      }
    }

    if (match && method) {
      matchedCount += 1;
      result.set(index, { channel: match, method, score });
    }
  });

  return { matches: result, matchedCount };
}
