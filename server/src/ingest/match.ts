import type { ParsedM3uChannel, XmltvChannel } from "../types/app.js";
import { normalizeName, similarity } from "../utils/normalize.js";

export type ChannelMatchMethod = "tvg-id" | "exact-name" | "normalized-name" | "fuzzy";

export interface ChannelMatch {
  channel: XmltvChannel;
  method: ChannelMatchMethod;
  score: number;
  candidate?: ChannelMatchCandidate;
}

export interface ChannelMatchCandidate {
  channel: XmltvChannel;
  method: "fuzzy-candidate";
  score: number;
  scoreGap: number;
}

export function matchChannels(m3uChannels: ParsedM3uChannel[], xmltvChannels: XmltvChannel[]) {
  const byId = uniqueBy(xmltvChannels, (channel) => channel.id.toLowerCase());
  const byName = uniqueBy(xmltvChannels, (channel) => channel.displayName.toLowerCase());
  const byNormalizedName = uniqueBy(xmltvChannels, (channel) => normalizeName(channel.displayName));

  let matchedCount = 0;
  const result = new Map<number, ChannelMatch>();
  const candidates = new Map<number, ChannelMatchCandidate>();

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
      let secondBestScore = 0;
      for (const candidate of xmltvChannels) {
        const candidateScore = Math.max(
          similarity(channel.displayName, candidate.displayName),
          similarity(channel.tvgName, candidate.displayName)
        );
        if (candidateScore > bestScore) {
          secondBestScore = bestScore;
          bestScore = candidateScore;
          match = candidate;
        } else if (candidateScore > secondBestScore) {
          secondBestScore = candidateScore;
        }
      }
      const scoreGap = bestScore - secondBestScore;
      if (match && bestScore >= 0.6) {
        candidates.set(index, { channel: match, method: "fuzzy-candidate", score: bestScore, scoreGap });
      }
      if (bestScore < 0.9 || scoreGap < 0.05) {
        match = undefined;
      } else {
        method = "fuzzy";
        score = bestScore;
      }
    }

    if (match && method) {
      matchedCount += 1;
      result.set(index, { channel: match, method, score, candidate: candidates.get(index) });
    }
  });

  return { matches: result, candidates, matchedCount };
}

function uniqueBy(channels: XmltvChannel[], keyFor: (channel: XmltvChannel) => string) {
  const counts = new Map<string, number>();
  const values = new Map<string, XmltvChannel>();
  for (const channel of channels) {
    const key = keyFor(channel);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    values.set(key, channel);
  }
  for (const [key, count] of counts) {
    if (count > 1) values.delete(key);
  }
  return values;
}
