import { config } from "../config.js";
import { setting } from "../db/database.js";

const plexBase = "https://plex.tv";

function plexHeaders(token?: string) {
  const productName = setting("plex_product_name", config.plexProductName);
  const clientIdentifier = setting("plex_client_identifier", config.plexClientIdentifier);
  return {
    accept: "application/json",
    "x-plex-product": productName,
    "x-plex-client-identifier": clientIdentifier,
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
    clientID: setting("plex_client_identifier", config.plexClientIdentifier),
    code: pin.code,
    "context[device][product]": setting("plex_product_name", config.plexProductName)
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
  if (!serverIdentifier) throw new Error("Plex server is not configured.");

  const resources = await getPlexResources(userToken);
  return resources.some((resource) => resource.clientIdentifier === serverIdentifier);
}

export async function getPlexResources(token: string) {
  const resourcesResponse = await fetch(`${plexBase}/api/v2/resources?includeHttps=1`, {
    headers: plexHeaders(token)
  });
  if (!resourcesResponse.ok) throw new Error("Unable to fetch Plex servers.");
  return (await resourcesResponse.json()) as Array<{
    name?: string;
    product?: string;
    clientIdentifier?: string;
    provides?: string;
    owned?: boolean;
    accessToken?: string;
  }>;
}

export async function plexAdminStatus() {
  const serverIdentifier = setting("plex_server_identifier", config.plexServerIdentifier);
  const plexToken = setting("plex_token", config.plexToken);
  if (!serverIdentifier || !plexToken) {
    return { configured: Boolean(serverIdentifier), serverReachable: false };
  }
  try {
    const resources = await getPlexResources(plexToken);
    return {
      configured: true,
      serverReachable: resources.some((resource) => resource.clientIdentifier === serverIdentifier)
    };
  } catch {
    return { configured: true, serverReachable: false };
  }
}
