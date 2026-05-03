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
  externalProfile?: ExternalProfile;
}

export interface ExternalProfile {
  id: number;
  name: string;
  enabled: number;
  token: string;
  xc_username: string;
  xc_password: string;
  output_mode: "hls" | "mpegts";
  created_at: string;
  updated_at: string;
}

export interface ProviderProfile {
  id: number;
  name: string;
  enabled: number;
  is_primary: number;
  username: string;
  password: string;
  max_connections: number;
  sort_order: number;
  account_status: string | null;
  account_expires_at: string | null;
  account_days_left: number | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedM3uChannel {
  tvgId: string;
  tvgName: string;
  displayName: string;
  logoUrl: string;
  groupTitle: string;
  streamUrl: string;
  channelNumber: number | null;
  sortOrder: number;
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
