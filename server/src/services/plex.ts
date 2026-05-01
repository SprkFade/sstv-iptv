import { config } from "../config.js";
import { setting } from "../db/database.js";

const plexBase = "https://plex.tv";

function plexHeaders(token?: string) {
  return {
    accept: "application/json",
    "x-plex-product": config.plexProductName,
    "x-plex-client-identifier": config.plexClientIdentifier,
    ...(token ? { "x-plex-token": token } : {})
  };
}

export async function createPlexPin() {
  const response = await fetch(`${plexBase}/api/v2/pins?strong=true`, {
    method: "POST",
    headers: plexHeaders()
  });
  if (!response.ok) throw new Error("Unable to start Plex login.");
  const pin = (await response.json()) as { id: number; code: string };
  const authUrl = new URL("https://app.plex.tv/auth");
  authUrl.hash = new URLSearchParams({
    clientID: config.plexClientIdentifier,
    code: pin.code,
    "context[device][product]": config.plexProductName
  }).toString();
  return { id: pin.id, code: pin.code, authUrl: authUrl.toString() };
}

export async function pollPlexPin(id: string) {
  const response = await fetch(`${plexBase}/api/v2/pins/${id}`, {
    headers: plexHeaders()
  });
  if (!response.ok) throw new Error("Unable to check Plex login.");
  return (await response.json()) as { authToken?: string | null };
}

export async function getPlexUser(token: string) {
  const response = await fetch(`${plexBase}/api/v2/user`, {
    headers: plexHeaders(token)
  });
  if (!response.ok) throw new Error("Unable to fetch Plex user.");
  return (await response.json()) as {
    id: number;
    username?: string;
    title?: string;
    email?: string;
  };
}

export async function verifyPlexServerAccess(userToken: string) {
  const serverIdentifier = setting("plex_server_identifier", config.plexServerIdentifier);
  if (!serverIdentifier) throw new Error("PLEX_SERVER_IDENTIFIER is not configured.");

  const resourcesResponse = await fetch(`${plexBase}/api/v2/resources?includeHttps=1`, {
    headers: plexHeaders(userToken)
  });
  if (!resourcesResponse.ok) throw new Error("Unable to verify Plex server access.");
  const resources = (await resourcesResponse.json()) as Array<{ clientIdentifier?: string; name?: string }>;
  return resources.some((resource) => resource.clientIdentifier === serverIdentifier);
}

export async function plexAdminStatus() {
  const serverIdentifier = setting("plex_server_identifier", config.plexServerIdentifier);
  if (!serverIdentifier || !config.plexToken) {
    return { configured: Boolean(serverIdentifier), serverReachable: false };
  }
  try {
    const resourcesResponse = await fetch(`${plexBase}/api/v2/resources?includeHttps=1`, {
      headers: plexHeaders(config.plexToken)
    });
    const resources = resourcesResponse.ok
      ? ((await resourcesResponse.json()) as Array<{ clientIdentifier?: string }>)
      : [];
    return {
      configured: true,
      serverReachable: resources.some((resource) => resource.clientIdentifier === serverIdentifier)
    };
  } catch {
    return { configured: true, serverReachable: false };
  }
}
