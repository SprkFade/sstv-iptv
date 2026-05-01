import type { Request } from "express";

export type Role = "admin" | "user";

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  auth_provider: "local" | "plex";
  plex_user_id: string | null;
  plex_username: string | null;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export interface ParsedM3uChannel {
  tvgId: string;
  tvgName: string;
  displayName: string;
  logoUrl: string;
  groupTitle: string;
  streamUrl: string;
}

export interface XmltvChannel {
  id: string;
  displayName: string;
  icon: string;
}

export interface XmltvProgram {
  channelXmltvId: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  startTime: string;
  endTime: string;
}
