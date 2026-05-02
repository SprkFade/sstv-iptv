import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { setting } from "../db/database.js";
import {
  findExternalProfileByToken,
  findExternalProfileByXc,
  visibleExternalChannels,
  visibleExternalGroups,
  visibleExternalPrograms,
  visibleExternalProgramsForChannel
} from "../services/externalAccess.js";
import type { AuthedRequest, ExternalProfile } from "../types/app.js";

export const externalRouter = Router();

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeTextEntities(value: unknown) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrEscape(value: unknown) {
  return xmlEscape(value).replace(/\r?\n/g, " ");
}

function m3uEscape(value: unknown) {
  return decodeTextEntities(value).replace(/\r?\n/g, " ").replace(/"/g, "'");
}

function xmltvDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

function publicBaseUrl(req: AuthedRequest) {
  const requestedBase = typeof req.query.base === "string" ? req.query.base : "";
  if (requestedBase === "internal") {
    const internal = setting("external_internal_base_url", "http://sstv-iptv:3025").trim();
    if (internal) return internal.replace(/\/+$/, "");
  }
  if (requestedBase === "public") {
    const configured = setting("external_public_base_url").trim();
    if (configured) return configured.replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function profileToken(req: AuthedRequest) {
  const token = req.query.token;
  return typeof token === "string" ? token : "";
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function requireTokenProfile(req: AuthedRequest, res: Response) {
  const profile = findExternalProfileByToken(profileToken(req));
  if (!profile) {
    res.status(401).json({ error: "Invalid external access token" });
    return null;
  }
  return profile;
}

function xcCredentials(req: AuthedRequest) {
  const username = typeof req.query.username === "string" ? req.query.username : "";
  const password = typeof req.query.password === "string" ? req.query.password : "";
  return { username, password };
}

function requireXcProfile(req: AuthedRequest, res: Response) {
  const { username, password } = xcCredentials(req);
  const profile = findExternalProfileByXc(username, password);
  if (!profile) {
    res.status(401).json({ user_info: { auth: 0 }, server_info: {} });
    return null;
  }
  return profile;
}

export function externalTokenStreamAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = routeParam(req.params.token);
  const profile = findExternalProfileByToken(token);
  if (!profile) return res.status(401).json({ error: "Invalid external access token" });
  req.externalProfile = profile;
  next();
}

export function externalXcStreamAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const profile = findExternalProfileByXc(routeParam(req.params.username), routeParam(req.params.password));
  if (!profile) return res.status(401).json({ error: "Invalid external access credentials" });
  req.externalProfile = profile;
  next();
}

type ExternalOutputMode = "hls" | "mpegts";

function requestedOutputMode(req: AuthedRequest, profile: ExternalProfile): ExternalOutputMode {
  const output = typeof req.query.output === "string" ? req.query.output.toLowerCase() : "";
  if (output === "ts" || output === "mpegts" || output === "mpeg-ts") return "mpegts";
  if (output === "hls" || output === "m3u8") return "hls";
  return profile.output_mode;
}

function outputExtension(mode: ExternalOutputMode) {
  return mode === "mpegts" ? "ts" : "m3u8";
}

function streamUrl(baseUrl: string, profile: ExternalProfile, channelId: number, style: "token" | "xc" = "token", mode: ExternalOutputMode = profile.output_mode) {
  if (mode === "mpegts") {
    if (style === "xc") {
      return `${baseUrl}/live/${encodeURIComponent(profile.xc_username)}/${encodeURIComponent(profile.xc_password)}/${channelId}.ts`;
    }
    return `${baseUrl}/external/live/${encodeURIComponent(profile.token)}/${channelId}.ts`;
  }

  if (style === "xc") {
    return `${baseUrl}/live/${encodeURIComponent(profile.xc_username)}/${encodeURIComponent(profile.xc_password)}/${channelId}/hls/index.m3u8?start=1`;
  }
  return `${baseUrl}/external/live/${encodeURIComponent(profile.token)}/${channelId}/hls/index.m3u8?start=1`;
}

function buildM3u(req: AuthedRequest, profile: ExternalProfile, style: "token" | "xc" = "token") {
  const baseUrl = publicBaseUrl(req);
  const mode = requestedOutputMode(req, profile);
  const channels = visibleExternalChannels();
  const lines = ["#EXTM3U"];
  for (const channel of channels) {
    const tvgId = `sstv-${channel.id}`;
    const channelNumber = channel.channel_number ?? channel.sort_order ?? channel.id;
    const displayName = m3uEscape(channel.display_name);
    const groupTitle = m3uEscape(channel.group_title ?? "Channels");
    lines.push(
      `#EXTINF:-1 tvg-id="${m3uEscape(tvgId)}" tvg-chno="${m3uEscape(channelNumber)}" tvg-name="${displayName}" tvg-logo="${m3uEscape(channel.logo_url ?? "")}" group-title="${groupTitle}",${displayName}`
    );
    lines.push(streamUrl(baseUrl, profile, channel.id, style, mode));
  }
  return `${lines.join("\n")}\n`;
}

function buildXmltv() {
  const channels = visibleExternalChannels();
  const programs = visibleExternalPrograms();
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="SSTV IPTV">'];
  for (const channel of channels) {
    const channelNumber = channel.channel_number ? `${channel.channel_number} ` : "";
    const displayName = decodeTextEntities(channel.display_name);
    lines.push(`  <channel id="sstv-${channel.id}">`);
    lines.push(`    <display-name>${xmlEscape(`${channelNumber}${displayName}`)}</display-name>`);
    if (channel.logo_url) lines.push(`    <icon src="${attrEscape(decodeTextEntities(channel.logo_url))}" />`);
    lines.push("  </channel>");
  }
  for (const program of programs) {
    lines.push(`  <programme channel="sstv-${program.channel_id}" start="${xmltvDate(program.start_time)}" stop="${xmltvDate(program.end_time)}">`);
    lines.push(`    <title>${xmlEscape(decodeTextEntities(program.title))}</title>`);
    if (program.subtitle) lines.push(`    <sub-title>${xmlEscape(decodeTextEntities(program.subtitle))}</sub-title>`);
    if (program.description) lines.push(`    <desc>${xmlEscape(decodeTextEntities(program.description))}</desc>`);
    if (program.category) lines.push(`    <category>${xmlEscape(decodeTextEntities(program.category))}</category>`);
    lines.push("  </programme>");
  }
  lines.push("</tv>");
  return `${lines.join("\n")}\n`;
}

externalRouter.get("/external/m3u", (req: AuthedRequest, res) => {
  const profile = requireTokenProfile(req, res);
  if (!profile) return;
  res.type("audio/x-mpegurl").send(buildM3u(req, profile));
});

externalRouter.get("/external/xmltv", (req: AuthedRequest, res) => {
  const profile = requireTokenProfile(req, res);
  if (!profile) return;
  res.type("application/xml").send(buildXmltv());
});

externalRouter.get("/get.php", (req: AuthedRequest, res) => {
  const profile = requireXcProfile(req, res);
  if (!profile) return;
  res.type("audio/x-mpegurl").send(buildM3u(req, profile, "xc"));
});

externalRouter.get("/xmltv.php", (req: AuthedRequest, res) => {
  const profile = requireXcProfile(req, res);
  if (!profile) return;
  res.type("application/xml").send(buildXmltv());
});

externalRouter.get("/live/:username/:password/:channelId.:ext", (req: AuthedRequest, res) => {
  const profile = findExternalProfileByXc(routeParam(req.params.username), routeParam(req.params.password));
  if (!profile) return res.status(401).json({ error: "Invalid external access credentials" });
  const channelId = routeParam(req.params.channelId);
  const ext = routeParam(req.params.ext).toLowerCase();
  if (ext === "ts") {
    return res.redirect(302, `/live/${encodeURIComponent(profile.xc_username)}/${encodeURIComponent(profile.xc_password)}/${channelId}/transcode`);
  }
  return res.redirect(302, `/live/${encodeURIComponent(profile.xc_username)}/${encodeURIComponent(profile.xc_password)}/${channelId}/hls/index.m3u8?start=1`);
});

const shortEpgSchema = z.object({
  stream_id: z.coerce.number().int().positive().optional().default(0)
});

externalRouter.get("/player_api.php", (req: AuthedRequest, res) => {
  const profile = requireXcProfile(req, res);
  if (!profile) return;

  const action = typeof req.query.action === "string" ? req.query.action : "";
  const now = Math.floor(Date.now() / 1000);
  const baseUrl = publicBaseUrl(req);

  if (!action) {
    return res.json({
      user_info: {
        username: profile.xc_username,
        password: profile.xc_password,
        message: "SSTV IPTV external access",
        auth: 1,
        status: "Active",
        exp_date: null,
        is_trial: "0",
        active_cons: "0",
        created_at: String(now),
        max_connections: "0",
        allowed_output_formats: ["m3u8", "ts"]
      },
      server_info: {
        url: req.hostname,
        port: req.socket.localPort ? String(req.socket.localPort) : "3025",
        https_port: "443",
        server_protocol: req.protocol,
        timestamp_now: now,
        time_now: new Date().toISOString()
      }
    });
  }

  if (action === "get_live_categories") {
    return res.json(visibleExternalGroups().map((group, index) => ({
      category_id: String(index + 1),
      category_name: decodeTextEntities(group.name),
      parent_id: 0
    })));
  }

  if (action === "get_live_streams") {
    const groups = visibleExternalGroups();
    const groupIdByName = new Map(groups.map((group, index) => [group.name, String(index + 1)]));
    const mode = requestedOutputMode(req, profile);
    return res.json(visibleExternalChannels().map((channel) => ({
      num: channel.channel_number ?? channel.sort_order ?? channel.id,
      name: decodeTextEntities(channel.display_name),
      stream_type: "live",
      stream_id: channel.id,
      stream_icon: channel.logo_url ?? "",
      epg_channel_id: `sstv-${channel.id}`,
      added: "",
      category_id: groupIdByName.get(channel.group_title ?? "") ?? "0",
      custom_sid: "",
      tv_archive: 0,
      direct_source: streamUrl(baseUrl, profile, channel.id, "xc", mode),
      container_extension: outputExtension(mode),
      tv_archive_duration: 0
    })));
  }

  if (action === "get_short_epg") {
    const parsed = shortEpgSchema.parse(req.query);
    const epg_listings = visibleExternalProgramsForChannel(parsed.stream_id).map((program, index) => ({
      id: index + 1,
      epg_id: program.channel_id,
      title: Buffer.from(decodeTextEntities(program.title)).toString("base64"),
      lang: "en",
      start: program.start_time,
      end: program.end_time,
      description: Buffer.from(decodeTextEntities(program.description ?? "")).toString("base64"),
      channel_id: `sstv-${program.channel_id}`,
      start_timestamp: Math.floor(new Date(program.start_time).getTime() / 1000),
      stop_timestamp: Math.floor(new Date(program.end_time).getTime() / 1000)
    }));
    return res.json({ epg_listings });
  }

  if (action === "get_simple_data_table") {
    return res.json({ epg_listings: visibleExternalPrograms().map((program, index) => ({
      id: index + 1,
      title: decodeTextEntities(program.title),
      lang: "en",
      start: program.start_time,
      end: program.end_time,
      description: decodeTextEntities(program.description ?? ""),
      channel_id: `sstv-${program.channel_id}`,
      start_timestamp: Math.floor(new Date(program.start_time).getTime() / 1000),
      stop_timestamp: Math.floor(new Date(program.end_time).getTime() / 1000)
    })) });
  }

  return res.json([]);
});
