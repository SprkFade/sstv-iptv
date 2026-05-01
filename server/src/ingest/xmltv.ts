import { XMLParser } from "fast-xml-parser";
import type { XmltvChannel, XmltvProgram } from "../types/app.js";
import { parseXmltvDate } from "../utils/time.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  processEntities: {
    enabled: true,
    maxEntitySize: 1024,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 50_000_000,
    maxEntityCount: 20
  }
});

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object" && "#text" in value) {
    return text((value as Record<string, unknown>)["#text"]);
  }
  return "";
}

export function parseXmltv(input: string): { channels: XmltvChannel[]; programs: XmltvProgram[] } {
  const parsed = parser.parse(input) as {
    tv?: {
      channel?: unknown;
      programme?: unknown;
    };
  };

  const channels = arrayify(parsed.tv?.channel).map((item) => {
    const channel = item as Record<string, unknown>;
    const displayName = text(channel["display-name"]);
    const icon = channel.icon as Record<string, unknown> | undefined;
    return {
      id: String(channel["@_id"] ?? ""),
      displayName,
      icon: String(icon?.["@_src"] ?? "")
    };
  }).filter((channel) => channel.id);

  const programs = arrayify(parsed.tv?.programme).map((item) => {
    const program = item as Record<string, unknown>;
    return {
      channelXmltvId: String(program["@_channel"] ?? ""),
      title: text(program.title) || "Untitled",
      subtitle: text(program["sub-title"]),
      description: text(program.desc),
      category: text(program.category),
      startTime: parseXmltvDate(String(program["@_start"] ?? "")),
      endTime: parseXmltvDate(String(program["@_stop"] ?? ""))
    };
  }).filter((program) => program.channelXmltvId && program.startTime < program.endTime);

  return { channels, programs };
}
