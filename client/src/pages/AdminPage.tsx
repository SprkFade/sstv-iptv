import { useEffect, useState } from "react";
import { Activity, Database, RefreshCw, Server, Users } from "lucide-react";
import { api } from "../api/client";

type Settings = Awaited<ReturnType<typeof api.settings>>;

export function AdminPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Array<Record<string, string | number | null>>>([]);
  const [users, setUsers] = useState<Array<Record<string, string | number | null>>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [xcPassword, setXcPassword] = useState("");

  const load = async () => {
    const [settingsResponse, runResponse, userResponse] = await Promise.all([
      api.settings(),
      api.refreshRuns(),
      api.users()
    ]);
    setSettings(settingsResponse);
    setRuns(runResponse.runs);
    setUsers(userResponse.users);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load admin data"));
  }, []);

  if (!settings) return <div className="text-sm text-ink/60">Loading admin...</div>;

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md bg-accent text-white"><Database /></span>
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-ink/60">XtremeCodes, XMLTV, refresh, and Plex status</p>
          </div>
        </div>
        {message && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setMessage("");
            setError("");
            try {
              await api.saveSettings({ ...settings, xcPassword });
              setXcPassword("");
              setMessage("Settings saved.");
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Save failed");
            }
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            XtremeCodes server URL
            <input className="min-h-11 rounded-md border border-line px-3" value={settings.xcBaseUrl} onChange={(event) => setSettings({ ...settings, xcBaseUrl: event.target.value })} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              XC username
              <input className="min-h-11 rounded-md border border-line px-3" value={settings.xcUsername} onChange={(event) => setSettings({ ...settings, xcUsername: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              XC password
              <input className="min-h-11 rounded-md border border-line px-3" type="password" placeholder={settings.xcPasswordSet ? "Leave blank to keep current password" : ""} value={xcPassword} onChange={(event) => setXcPassword(event.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            XMLTV URL (optional)
            <input className="min-h-11 rounded-md border border-line px-3" value={settings.xmltvUrl} onChange={(event) => setSettings({ ...settings, xmltvUrl: event.target.value })} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              Refresh interval hours
              <input className="min-h-11 rounded-md border border-line px-3" type="number" min={1} max={168} value={settings.refreshIntervalHours} onChange={(event) => setSettings({ ...settings, refreshIntervalHours: Number(event.target.value) })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Plex server identifier
              <input className="min-h-11 rounded-md border border-line px-3" value={settings.plexServerIdentifier} onChange={(event) => setSettings({ ...settings, plexServerIdentifier: event.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-white">
              Save settings
            </button>
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-panel px-4 font-semibold text-ink hover:bg-ink/5 disabled:opacity-60"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                setMessage("");
                setError("");
                try {
                  const result = await api.refresh();
                  setMessage(`Refresh complete: ${result.channelCount} channels, ${result.programCount} programs.`);
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Refresh failed");
                  await load().catch(() => undefined);
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} /> Refresh now
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Server className="mb-3 text-accent" />
          <div className="text-sm text-ink/60">Plex server</div>
          <div className="font-bold">{settings.plex.serverReachable ? "Reachable" : settings.plex.configured ? "Configured" : "Not configured"}</div>
        </div>
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Activity className="mb-3 text-gold" />
          <div className="text-sm text-ink/60">Last refresh</div>
          <div className="font-bold">{runs[0]?.status ?? "None"}</div>
        </div>
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Users className="mb-3 text-berry" />
          <div className="text-sm text-ink/60">Users</div>
          <div className="font-bold">{users.length}</div>
        </div>
      </section>

      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <h2 className="text-xl font-bold">Refresh runs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="py-2">Status</th><th>Started</th><th>Channels</th><th>Programs</th><th>Matched</th><th>Error</th></tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={String(run.id)} className="border-b border-line">
                  <td className="py-2 font-semibold">{String(run.status)}</td>
                  <td>{String(run.started_at ?? "")}</td>
                  <td>{String(run.channel_count ?? 0)}</td>
                  <td>{String(run.program_count ?? 0)}</td>
                  <td>{String(run.matched_count ?? 0)}</td>
                  <td className="max-w-80 truncate text-rose-700">{String(run.error ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
