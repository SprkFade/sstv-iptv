import type { ParsedM3uChannel, XmltvChannel } from "../types/app.js";
import { normalizeName, similarity } from "../utils/normalize.js";

export function matchChannels(m3uChannels: ParsedM3uChannel[], xmltvChannels: XmltvChannel[]) {
  const byId = new Map(xmltvChannels.map((channel) => [channel.id.toLowerCase(), channel]));
  const byName = new Map(xmltvChannels.map((channel) => [channel.displayName.toLowerCase(), channel]));
  const byNormalizedName = new Map(
    xmltvChannels.map((channel) => [normalizeName(channel.displayName), channel])
  );

  let matchedCount = 0;
  const result = new Map<number, XmltvChannel>();

  m3uChannels.forEach((channel, index) => {
    let match: XmltvChannel | undefined;
    if (channel.tvgId) match = byId.get(channel.tvgId.toLowerCase());
    if (!match && channel.tvgName) match = byName.get(channel.tvgName.toLowerCase());
    if (!match) match = byNormalizedName.get(normalizeName(channel.tvgName || channel.displayName));

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
      if (bestScore < 0.72) match = undefined;
    }

    if (match) {
      matchedCount += 1;
      result.set(index, match);
    }
  });

  return { matches: result, matchedCount };
}
