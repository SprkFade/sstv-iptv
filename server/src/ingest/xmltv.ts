import type { XmltvChannel, XmltvProgram } from "../types/app.js";
import { parseXmltvDate } from "../utils/time.js";

export interface XmltvParseProgress {
  channels: number;
  programs: number;
}

const xmltvNodePattern = /<(channel|programme)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
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

export async function parseXmltv(
  input: string,
  onProgress?: (progress: XmltvParseProgress) => void
): Promise<{ channels: XmltvChannel[]; programs: XmltvProgram[] }> {
  const channels: XmltvChannel[] = [];
  const programs: XmltvProgram[] = [];
  let processed = 0;
  let match: RegExpExecArray | null;
  xmltvNodePattern.lastIndex = 0;

  while ((match = xmltvNodePattern.exec(input))) {
    const [, nodeName, attributeText, body] = match;
    const attrs = attributes(attributeText);

    if (nodeName.toLowerCase() === "channel") {
      const id = attrs.get("id") ?? "";
      if (id) {
        channels.push({
          id,
          displayName: tagText(body, "display-name"),
          icon: tagAttribute(body, "icon", "src")
        });
      }
    } else {
      const channelXmltvId = attrs.get("channel") ?? "";
      const startTime = parseXmltvDate(attrs.get("start"));
      const endTime = parseXmltvDate(attrs.get("stop"));
      if (channelXmltvId && startTime < endTime) {
        programs.push({
          channelXmltvId,
          title: tagText(body, "title") || "Untitled",
          subtitle: tagText(body, "sub-title"),
          description: tagText(body, "desc"),
          category: tagText(body, "category"),
          startTime,
          endTime
        });
      }
    }

    processed += 1;
    if (processed % 500 === 0) {
      onProgress?.({ channels: channels.length, programs: programs.length });
      await yieldToEventLoop();
    }
  }

  onProgress?.({ channels: channels.length, programs: programs.length });
  return { channels, programs };
}
