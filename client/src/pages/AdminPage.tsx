import { useEffect, useState } from "react";
import { Activity, ChevronDown, Database, RefreshCw, Server, Users } from "lucide-react";
import { api, type RefreshProgress } from "../api/client";

type Settings = Awaited<ReturnType<typeof api.settings>>;

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatRefreshTimestamp(value: string | number | null | undefined) {
  if (!value) return "";
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const hours = date.getHours();
  const hour12 = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  return `${month}/${day}/${year} ${hour12}:${minutes} ${period}`;
}

export function AdminPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Array<Record<string, string | number | null>>>([]);
  const [users, setUsers] = useState<Array<Record<string, string | number | null>>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [xcPassword, setXcPassword] = useState("");
  const [refreshStatus, setRefreshStatus] = useState<RefreshProgress | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const [settingsResult, runResult, userResult, statusResult] = await Promise.allSettled([
      api.settings(),
      api.refreshRuns(),
      api.users(),
      api.refreshStatus()
    ]);
    const failures = [settingsResult, runResult, userResult, statusResult].filter((result) => result.status === "rejected");
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (runResult.status === "fulfilled") setRuns(runResult.value.runs);
    if (userResult.status === "fulfilled") setUsers(userResult.value.users);
    if (statusResult.status === "fulfilled") {
      setRefreshStatus(statusResult.value);
      setRefreshing(statusResult.value.active);
    }
    if (failures.length) {
      const first = failures[0] as PromiseRejectedResult;
      setError(first.reason instanceof Error ? first.reason.message : "Unable to load all admin data");
    }
  };

  const loadRefreshState = async () => {
    const statusResponse = await api.refreshStatus();
    setRefreshStatus(statusResponse);
    setRefreshing(statusResponse.active);
    if (!statusResponse.active) {
      const runResponse = await api.refreshRuns();
      setRuns(runResponse.runs);
    }
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load admin data"));
  }, []);

  useEffect(() => {
    if (!refreshing && !refreshStatus?.active) return;
    const timer = window.setInterval(() => {
      loadRefreshState().catch((err) => setError(err instanceof Error ? err.message : "Unable to load refresh status"));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refreshing, refreshStatus?.active]);

  useEffect(() => {
    if (!refreshStatus?.active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [refreshStatus?.active]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!settings) {
    return (
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-1 text-sm text-ink/60">Loading admin settings...</p>
        {error && <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
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
          className="grid min-w-0 max-w-full gap-3"
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
            <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" value={settings.xcBaseUrl} onChange={(event) => setSettings({ ...settings, xcBaseUrl: event.target.value })} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              XC username
              <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" value={settings.xcUsername} onChange={(event) => setSettings({ ...settings, xcUsername: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              XC password
              <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" type="password" placeholder={settings.xcPasswordSet ? "Leave blank to keep current password" : ""} value={xcPassword} onChange={(event) => setXcPassword(event.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            XMLTV URL (optional)
            <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" value={settings.xmltvUrl} onChange={(event) => setSettings({ ...settings, xmltvUrl: event.target.value })} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              Refresh interval hours
              <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" type="number" min={1} max={168} value={settings.refreshIntervalHours} onChange={(event) => setSettings({ ...settings, refreshIntervalHours: Number(event.target.value) })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Plex server identifier
              <input className="min-h-11 w-full min-w-0 rounded-md border border-line px-3" value={settings.plexServerIdentifier} onChange={(event) => setSettings({ ...settings, plexServerIdentifier: event.target.value })} />
            </label>
          </div>
          <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-mist p-3">
            <h2 className="text-base font-bold">Stream proxy</h2>
            <p className="mt-1 text-sm text-ink/60">FFmpeg HLS input and recovery settings apply to new playback sessions.</p>
            <div className="mt-3 grid min-w-0 max-w-full grid-cols-1 items-start gap-3 lg:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm font-medium">
                HLS input mode
                <span className="relative block min-w-0">
                  <select
                    className="min-h-11 w-full min-w-0 appearance-none rounded-md border border-line bg-panel py-2 pl-3 pr-11"
                    value={settings.ffmpegHlsInputMode}
                    onChange={(event) => setSettings({ ...settings, ffmpegHlsInputMode: event.target.value as Settings["ffmpegHlsInputMode"] })}
                  >
                    <option value="direct">Direct FFmpeg input</option>
                    <option value="pipe">Node pipe fallback</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink/70" size={18} />
                </span>
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">
                Stale restart seconds
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  type="number"
                  min={0}
                  max={300}
                  value={settings.ffmpegStaleRestartSeconds}
                  onChange={(event) => setSettings({ ...settings, ffmpegStaleRestartSeconds: Number(event.target.value) })}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">
                Rewind window minutes
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  type="number"
                  min={0}
                  max={60}
                  value={settings.ffmpegHlsDvrWindowMinutes}
                  onChange={(event) => setSettings({ ...settings, ffmpegHlsDvrWindowMinutes: Number(event.target.value) })}
                />
                <span className="text-xs font-normal text-ink/55">0 keeps only the live playback buffer. Applies to new streams.</span>
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">
                Reconnect delay max seconds
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  type="number"
                  min={1}
                  max={60}
                  value={settings.ffmpegReconnectDelayMax}
                  onChange={(event) => setSettings({ ...settings, ffmpegReconnectDelayMax: Number(event.target.value) })}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">
                Read timeout seconds
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  type="number"
                  min={5}
                  max={120}
                  value={settings.ffmpegRwTimeoutSeconds}
                  onChange={(event) => setSettings({ ...settings, ffmpegRwTimeoutSeconds: Number(event.target.value) })}
                />
              </label>
            </div>
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
                  setRefreshStatus(result.progress);
                  setRefreshing(true);
                  setMessage(result.started ? "Refresh started." : "Refresh is already running.");
                  await loadRefreshState();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Refresh failed");
                  await loadRefreshState().catch(() => undefined);
                } finally {
                  await loadRefreshState().catch(() => undefined);
                }
              }}
            >
              <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} /> Refresh now
            </button>
          </div>
        </form>
      </section>

      {refreshStatus && (
        <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
          {(() => {
            const updatedAgo = refreshStatus.updatedAt ? Math.max(0, Math.floor((now - new Date(refreshStatus.updatedAt).getTime()) / 1000)) : null;
            const elapsed = refreshStatus.startedAt ? Math.max(0, Math.floor((now - new Date(refreshStatus.startedAt).getTime()) / 1000)) : null;
            const saving = refreshStatus.active && (refreshStatus.stage === "Saving guide data" || refreshStatus.stage === "Saving guide programs");
            const channelValue = saving && refreshStatus.savedChannelCount < refreshStatus.channelCount
              ? `${refreshStatus.savedChannelCount}/${refreshStatus.channelCount}`
              : String(refreshStatus.channelCount);
            const programTotal = refreshStatus.totalProgramCount || refreshStatus.programCount;
            const programValue = saving && refreshStatus.savedProgramCount < programTotal
              ? `${refreshStatus.savedProgramCount}/${programTotal}`
              : String(refreshStatus.programCount);
            return (
              <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Refresh status</h2>
              <p className="text-sm text-ink/60">{refreshStatus.detail || "No refresh is running."}</p>
              {refreshStatus.active && (
                <p className="mt-1 text-xs text-ink/50">
                  {elapsed !== null ? `Elapsed ${formatDuration(elapsed)}` : "Refresh running"}
                  {updatedAgo !== null ? `, status updated ${formatDuration(updatedAgo)} ago` : ""}
                </p>
              )}
            </div>
            <span className={`rounded-md border px-3 py-1 text-sm font-semibold ${refreshStatus.active ? "border-accent text-accent" : "border-line text-ink/70"}`}>
              {refreshStatus.stage}
            </span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/15">
            <div className={`h-full rounded-full bg-accent ${refreshStatus.active ? "w-2/3 animate-pulse" : "w-full"}`} />
          </div>
          {refreshStatus.active && updatedAgo !== null && updatedAgo > 30 && (
            <p className="mt-3 rounded-md border border-gold/40 bg-gold/10 p-3 text-sm text-ink/70">
              This step is still running. Large XMLTV files can spend a while parsing or saving before the next count update appears.
            </p>
          )}
          {refreshStatus.error && (
            <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{refreshStatus.error}</p>
          )}
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <div className="text-ink/60">Channels</div>
              <div className="font-bold">{channelValue}</div>
            </div>
            <div>
              <div className="text-ink/60">Programs</div>
              <div className="font-bold">{programValue}</div>
            </div>
            <div>
              <div className="text-ink/60">Matched</div>
              <div className="font-bold">{refreshStatus.matchedCount}</div>
            </div>
          </div>
              </>
            );
          })()}
        </section>
      )}

      <section className="grid min-w-0 gap-3 md:grid-cols-3">
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

      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <h2 className="text-xl font-bold">Refresh runs</h2>
        <div className="mt-3 grid gap-2 md:hidden">
          {runs.map((run) => (
            <article key={String(run.id)} className="rounded-md border border-line bg-mist p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{String(run.status)}</span>
                <span className="text-xs text-ink/60">{formatRefreshTimestamp(run.started_at)}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-ink/50">Channels</div>
                  <div className="font-bold">{String(run.channel_count ?? 0)}</div>
                </div>
                <div>
                  <div className="text-ink/50">Programs</div>
                  <div className="font-bold">{String(run.program_count ?? 0)}</div>
                </div>
                <div>
                  <div className="text-ink/50">Matched</div>
                  <div className="font-bold">{String(run.matched_count ?? 0)}</div>
                </div>
              </div>
              {run.error && <p className="mt-2 line-clamp-2 text-xs text-rose-700">{String(run.error)}</p>}
            </article>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="py-2">Status</th><th>Started</th><th>Channels</th><th>Programs</th><th>Matched</th><th>Error</th></tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={String(run.id)} className="border-b border-line">
                  <td className="py-2 font-semibold">{String(run.status)}</td>
                  <td>{formatRefreshTimestamp(run.started_at)}</td>
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
