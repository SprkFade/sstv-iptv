import { createReadStream } from "node:fs";
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

async function parseBlocksFromFile(
  filePath: string,
  tagName: "channel" | "programme",
  onBlock: (attributeText: string, body: string) => Promise<void> | void
) {
  const closeTag = `</${tagName}>`;
  const startPattern = new RegExp(`<${tagName}\\b`, "i");
  const blockPattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i");
  let buffer = "";

  for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
    buffer += chunk;

    while (true) {
      const start = buffer.search(startPattern);
      if (start < 0) {
        buffer = buffer.slice(-128);
        break;
      }

      const end = buffer.toLowerCase().indexOf(closeTag, start);
      if (end < 0) {
        buffer = buffer.slice(start);
        break;
      }

      const blockEnd = end + closeTag.length;
      const block = buffer.slice(start, blockEnd);
      buffer = buffer.slice(blockEnd);

      const match = blockPattern.exec(block);
      if (match) await onBlock(match[1], match[2]);
    }
  }
}

function parseChannelBlock(attributeText: string, body: string) {
  const attrs = attributes(attributeText);
  const id = attrs.get("id") ?? "";
  if (!id) return null;
  return {
    id,
    displayName: tagText(body, "display-name"),
    icon: tagAttribute(body, "icon", "src")
  };
}

function parseProgramBlock(attributeText: string, body: string, selectedXmltvChannelIds: Set<string>, windowStart: string, windowEnd: string) {
  const attrs = attributes(attributeText);
  const channelXmltvId = attrs.get("channel") ?? "";
  if (!selectedXmltvChannelIds.has(channelXmltvId)) return null;

  const startTime = parseXmltvDate(attrs.get("start"));
  const endTime = parseXmltvDate(attrs.get("stop"));
  if (!channelXmltvId || startTime >= endTime || endTime < windowStart || startTime > windowEnd) return null;

  return {
    channelXmltvId,
    title: tagText(body, "title") || "Untitled",
    subtitle: tagText(body, "sub-title"),
    description: tagText(body, "desc"),
    category: tagText(body, "category"),
    startTime,
    endTime
  };
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
    const channel = parseChannelBlock(attributeText, body);
    if (channel) channels.push(channel);

    processed += 1;
    if (processed % 500 === 0) {
      onProgress?.({ channels: channels.length });
      await yieldToEventLoop();
    }
  }

  onProgress?.({ channels: channels.length });
  return channels;
}

export async function parseXmltvChannelsFromFile(
  filePath: string,
  onProgress?: (progress: XmltvChannelParseProgress) => void
): Promise<XmltvChannel[]> {
  const channels: XmltvChannel[] = [];
  let processed = 0;

  await parseBlocksFromFile(filePath, "channel", async (attributeText, body) => {
    const channel = parseChannelBlock(attributeText, body);
    if (channel) channels.push(channel);

    processed += 1;
    if (processed % 500 === 0) {
      onProgress?.({ channels: channels.length });
      await yieldToEventLoop();
    }
  });

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
    scanned += 1;

    const program = parseProgramBlock(attributeText, body, selectedXmltvChannelIds, options.windowStart, options.windowEnd);
    if (program) {
      onProgram(program);
      saved += 1;
    }

    if (scanned % 500 === 0) {
      options.onProgress?.({ scanned, saved });
      await yieldToEventLoop();
    }
  }

  options.onProgress?.({ scanned, saved });
  return { scanned, saved };
}

export async function parseSelectedXmltvProgramsFromFile(
  filePath: string,
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

  await parseBlocksFromFile(filePath, "programme", async (attributeText, body) => {
    scanned += 1;
    const program = parseProgramBlock(attributeText, body, selectedXmltvChannelIds, options.windowStart, options.windowEnd);
    if (program) {
      onProgram(program);
      saved += 1;
    }

    if (scanned % 500 === 0) {
      options.onProgress?.({ scanned, saved });
      await yieldToEventLoop();
    }
  });

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
