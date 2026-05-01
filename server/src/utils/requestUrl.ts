import type { Request } from "express";

export function requestOrigin(req: Request) {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");
  return host ? `${proto}://${host}` : "";
}
