import type { XmltvChannel, XmltvProgram } from "../types/app.js";
import { parseXmltvDate } from "../utils/time.js";

export interface XmltvChannelParseProgress {
  channels: number;
}

export interface XmltvProgramParseProgress {
  scanned: number;
  saved: number;
}

const channelPattern = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi;
const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
const attributePattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function attributes(input: string) {
  const result = new Map<string, string>();
  attributePattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(input))) {
    result.set(match[1], decodeXml(match[3]));
  }
  return result;
}

function tagText(block: string, tagName: string) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(block);
  return match ? decodeXml(stripTags(match[1])).trim() : "";
}

function tagAttribute(block: string, tagName: string, attributeName: string) {
  const match = new RegExp(`<${tagName}\\b([^>]*)\\/?\\s*>`, "i").exec(block);
  return match ? attributes(match[1]).get(attributeName) ?? "" : "";
}

export async function parseXmltvChannels(
  input: string,
  onProgress?: (progress: XmltvChannelParseProgress) => void
): Promise<XmltvChannel[]> {
  const channels: XmltvChannel[] = [];
  let processed = 0;
  let match: RegExpExecArray | null;
  channelPattern.lastIndex = 0;

  while ((match = channelPattern.exec(input))) {
    const [, attributeText, body] = match;
    const attrs = attributes(attributeText);
    const id = attrs.get("id") ?? "";
    if (id) {
      channels.push({
        id,
        displayName: tagText(body, "display-name"),
        icon: tagAttribute(body, "icon", "src")
      });
    }

    processed += 1;
    if (processed % 500 === 0) {
      onProgress?.({ channels: channels.length });
      await yieldToEventLoop();
    }
  }

  onProgress?.({ channels: channels.length });
  return channels;
}

export async function parseSelectedXmltvPrograms(
  input: string,
  selectedXmltvChannelIds: Set<string>,
  onProgram: (program: XmltvProgram) => void,
  options: {
    windowStart: string;
    windowEnd: string;
    onProgress?: (progress: XmltvProgramParseProgress) => void;
  }
) {
  let scanned = 0;
  let saved = 0;
  let match: RegExpExecArray | null;
  programmePattern.lastIndex = 0;

  while ((match = programmePattern.exec(input))) {
    const [, attributeText, body] = match;
    const attrs = attributes(attributeText);
    const channelXmltvId = attrs.get("channel") ?? "";
    scanned += 1;

    if (selectedXmltvChannelIds.has(channelXmltvId)) {
      const startTime = parseXmltvDate(attrs.get("start"));
      const endTime = parseXmltvDate(attrs.get("stop"));
      if (channelXmltvId && startTime < endTime && endTime >= options.windowStart && startTime <= options.windowEnd) {
        onProgram({
          channelXmltvId,
          title: tagText(body, "title") || "Untitled",
          subtitle: tagText(body, "sub-title"),
          description: tagText(body, "desc"),
          category: tagText(body, "category"),
          startTime,
          endTime
        });
        saved += 1;
      }
    }

    if (scanned % 2000 === 0) {
      options.onProgress?.({ scanned, saved });
      await yieldToEventLoop();
    }
  }

  options.onProgress?.({ scanned, saved });
  return { scanned, saved };
}

export async function parseXmltv(
  input: string,
  onProgress?: (progress: { channels: number; programs: number }) => void
): Promise<{ channels: XmltvChannel[]; programs: XmltvProgram[] }> {
  const channels = await parseXmltvChannels(input, (progress) => {
    onProgress?.({ channels: progress.channels, programs: 0 });
  });
  const programs: XmltvProgram[] = [];
  await parseSelectedXmltvPrograms(
    input,
    new Set(channels.map((channel) => channel.id)),
    (program) => programs.push(program),
    {
      windowStart: new Date(0).toISOString(),
      windowEnd: new Date("9999-12-31T23:59:59.999Z").toISOString(),
      onProgress: (progress) => onProgress?.({ channels: channels.length, programs: progress.saved })
    }
  );
  return { channels, programs };
}
