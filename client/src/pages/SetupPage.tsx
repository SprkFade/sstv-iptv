import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, KeyRound, Link as LinkIcon, Server, Shield } from "lucide-react";
import { api, type PlexServer } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function SetupPage() {
  const navigate = useNavigate();
  const { setupRequired, loading, refreshUser } = useAuth();
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [xcBaseUrl, setXcBaseUrl] = useState("");
  const [xcUsername, setXcUsername] = useState("");
  const [xcPassword, setXcPassword] = useState("");
  const [xmltvUrl, setXmltvUrl] = useState("");
  const [refreshIntervalHours, setRefreshIntervalHours] = useState(12);
  const [plexPin, setPlexPin] = useState<{ id: number; code: string; authUrl: string } | null>(null);
  const [plexToken, setPlexToken] = useState("");
  const [plexUser, setPlexUser] = useState("");
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingPlex, setCheckingPlex] = useState(false);

  useEffect(() => {
    if (!loading && !setupRequired) navigate("/", { replace: true });
  }, [loading, setupRequired, navigate]);

  useEffect(() => {
    api.setupDefaults()
      .then((defaults) => {
        setXcBaseUrl(defaults.xcBaseUrl);
        setXcUsername(defaults.xcUsername);
        setXmltvUrl(defaults.xmltvUrl);
        setRefreshIntervalHours(defaults.refreshIntervalHours);
      })
      .catch(() => undefined);
  }, []);

  const checkPlexPin = async () => {
    if (!plexPin || plexToken || checkingPlex) return;
    setCheckingPlex(true);
    try {
      const result = await api.pollSetupPlexPin(plexPin.id);
      if (!result.authenticated) return;
      const availableServers = result.servers ?? [];
      setError("");
      setPlexToken(result.token ?? "");
      setPlexUser(result.user?.username ?? "Plex user");
      setServers(availableServers);
      setSelectedServer(availableServers[0]?.clientIdentifier ?? "");
      if (!availableServers.length) setError("Plex connected, but no Plex servers were found for this account.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plex setup failed");
    } finally {
      setCheckingPlex(false);
    }
  };

  useEffect(() => {
    if (!plexPin || plexToken) return;
    const timer = window.setInterval(() => {
      checkPlexPin().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [plexPin, plexToken, checkingPlex]);

  const selectedServerName = useMemo(
    () => servers.find((server) => server.clientIdentifier === selectedServer)?.name ?? "",
    [servers, selectedServer]
  );

  return (
    <div className="mx-auto max-w-4xl">
      <section className="rounded-md border border-line bg-panel p-5 shadow-soft">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Launch setup</h1>
          <p className="text-sm text-ink/60">Create the admin account, connect guide data, and choose your Plex server.</p>
        </div>

        {error && <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setSaving(true);
            try {
              await api.completeSetup({
                adminUsername,
                adminPassword,
                xcBaseUrl,
                xcUsername,
                xcPassword,
                xmltvUrl,
                refreshIntervalHours,
                plexToken,
                plexServerIdentifier: selectedServer,
                plexServerName: selectedServerName
              });
              await refreshUser();
              navigate("/", { replace: true });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Setup failed");
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="rounded-md border border-line p-4">
            <div className="mb-3 flex items-center gap-2 font-bold"><Shield size={18} /> Admin</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Admin username
                <input className="min-h-11 rounded-md border border-line px-3" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Admin password
                <input className="min-h-11 rounded-md border border-line px-3" type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-md border border-line p-4">
            <div className="mb-3 flex items-center gap-2 font-bold"><LinkIcon size={18} /> XtremeCodes source</div>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium">
                Server URL
                <input className="min-h-11 rounded-md border border-line px-3" placeholder="http://provider.example:8080" value={xcBaseUrl} onChange={(event) => setXcBaseUrl(event.target.value)} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  XC username
                  <input className="min-h-11 rounded-md border border-line px-3" value={xcUsername} onChange={(event) => setXcUsername(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  XC password
                  <input className="min-h-11 rounded-md border border-line px-3" type="password" value={xcPassword} onChange={(event) => setXcPassword(event.target.value)} />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                XMLTV guide URL (optional)
                <input className="min-h-11 rounded-md border border-line px-3" value={xmltvUrl} onChange={(event) => setXmltvUrl(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium md:w-64">
                Refresh interval hours
                <input className="min-h-11 rounded-md border border-line px-3" type="number" min={1} max={168} value={refreshIntervalHours} onChange={(event) => setRefreshIntervalHours(Number(event.target.value))} />
              </label>
            </div>
          </div>

          <div className="rounded-md border border-line p-4">
            <div className="mb-3 flex items-center gap-2 font-bold"><Server size={18} /> Plex</div>
            {!plexPin && !plexToken && (
              <button
                className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-white"
                type="button"
                onClick={async () => {
                  setError("");
                  try {
                    setPlexPin(await api.createSetupPlexPin());
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not start Plex login");
                  }
                }}
              >
                <KeyRound size={18} /> Connect Plex
              </button>
            )}

            {plexPin && !plexToken && (
              <div className="grid gap-3">
                <div className="rounded-md border border-line bg-mist p-4 text-center">
                  <div className="text-sm text-ink/60">Plex code</div>
                  <div className="mt-1 text-4xl font-bold tracking-normal">{plexPin.code}</div>
                </div>
                <a className="flex min-h-11 items-center justify-center rounded-md bg-accent px-4 font-semibold text-white" href={plexPin.authUrl} target="_blank" rel="noreferrer">
                  Continue with Plex
                </a>
                <button
                  className="flex min-h-11 items-center justify-center rounded-md border border-line bg-panel px-4 font-semibold text-ink hover:bg-ink/5 disabled:opacity-60"
                  type="button"
                  disabled={checkingPlex}
                  onClick={() => checkPlexPin().catch(() => undefined)}
                >
                  {checkingPlex ? "Checking Plex..." : "Check Plex connection"}
                </button>
              </div>
            )}

            {plexToken && (
              <div className="grid gap-3">
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  <Check size={18} /> Connected as {plexUser}
                </div>
                <label className="grid gap-1 text-sm font-medium">
                  Plex server
                  <select className="min-h-11 rounded-md border border-line px-3" value={selectedServer} onChange={(event) => setSelectedServer(event.target.value)}>
                    {servers.map((server) => (
                      <option key={server.clientIdentifier} value={server.clientIdentifier}>
                        {server.name}{server.owned ? " (owned)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <button className="flex min-h-12 items-center justify-center rounded-md bg-accent px-5 font-bold text-white disabled:opacity-60" disabled={saving}>
            {saving ? "Saving setup..." : "Finish setup"}
          </button>
        </form>
      </section>
    </div>
  );
}
