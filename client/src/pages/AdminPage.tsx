import { useEffect, useState } from "react";
import { Activity, Copy, Database, KeyRound, RefreshCw, Search, Server, Users } from "lucide-react";
import { api, type EmbyTask, type EpgDiagnostic, type ExternalProfile, type ProviderProfile, type RefreshProgress } from "../api/client";

type Settings = Awaited<ReturnType<typeof api.settings>>;

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatRunDuration(run: Record<string, string | number | null>) {
  const seconds = Number(run.duration_seconds ?? 0);
  if (!Number.isFinite(seconds)) return "";
  const duration = formatDuration(Math.max(0, Math.floor(seconds)));
  return run.status === "running" ? `${duration} so far` : duration;
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

function formatMatchScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2);
}

function trimBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function externalUrls(baseUrl: string, profile: ExternalProfile) {
  const base = trimBaseUrl(baseUrl);
  if (!base) return null;
  const output = profile.output_mode === "mpegts" ? "ts" : "hls";
  return {
    m3u: `${base}/external/m3u?token=${encodeURIComponent(profile.token)}&output=${output}`,
    xmltv: `${base}/external/xmltv?token=${encodeURIComponent(profile.token)}`,
    xcServer: base,
    xcM3u: `${base}/get.php?username=${encodeURIComponent(profile.xc_username)}&password=${encodeURIComponent(profile.xc_password)}&type=m3u_plus&output=${output}`,
    xcXmltv: `${base}/xmltv.php?username=${encodeURIComponent(profile.xc_username)}&password=${encodeURIComponent(profile.xc_password)}`
  };
}

export function AdminPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Array<Record<string, string | number | null>>>([]);
  const [users, setUsers] = useState<Array<Record<string, string | number | null>>>([]);
  const [epgDiagnostics, setEpgDiagnostics] = useState<EpgDiagnostic[]>([]);
  const [epgSearch, setEpgSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [xcPassword, setXcPassword] = useState("");
  const [embyApiKey, setEmbyApiKey] = useState("");
  const [embyTasks, setEmbyTasks] = useState<EmbyTask[]>([]);
  const [loadingEmbyTasks, setLoadingEmbyTasks] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshProgress | null>(null);
  const [now, setNow] = useState(Date.now());
  const [providerDraft, setProviderDraft] = useState({
    maxConnections: 1,
    name: "Profile 2",
    password: "",
    username: ""
  });

  const load = async () => {
    const [settingsResult, runResult, userResult, statusResult, epgResult] = await Promise.allSettled([
      api.settings(),
      api.refreshRuns(),
      api.users(),
      api.refreshStatus(),
      api.epgDiagnostics()
    ]);
    const failures = [settingsResult, runResult, userResult, statusResult, epgResult].filter((result) => result.status === "rejected");
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (runResult.status === "fulfilled") setRuns(runResult.value.runs);
    if (userResult.status === "fulfilled") setUsers(userResult.value.users);
    if (statusResult.status === "fulfilled") {
      setRefreshStatus(statusResult.value);
      setRefreshing(statusResult.value.active);
    }
    if (epgResult.status === "fulfilled") setEpgDiagnostics(epgResult.value.diagnostics);
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

  const copyText = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  };

  const setExternalProfiles = (profiles: ExternalProfile[]) => setSettings({ ...settings, externalProfiles: profiles });
  const setProviderProfiles = (profiles: ProviderProfile[]) => setSettings({ ...settings, providerProfiles: profiles });
  const filteredDiagnostics = epgDiagnostics.filter((diagnostic) => {
    const query = epgSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      diagnostic.display_name,
      diagnostic.group_title,
      diagnostic.source_id,
      diagnostic.tvg_id,
      diagnostic.tvg_name,
      diagnostic.xmltv_channel_id,
      diagnostic.xmltv_match_name,
      diagnostic.xmltv_match_method,
      diagnostic.warnings.join(" ")
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const visibleDiagnostics = filteredDiagnostics.slice(0, 300);

  const settingsPayload = () => ({
    ...settings,
    xcPassword,
    embyEnabled: settings.emby.enabled,
    embyBaseUrl: settings.emby.baseUrl,
    embyApiKey,
    embyRefreshAfterProviderRefresh: settings.emby.refreshAfterProviderRefresh,
    embyRefreshTaskId: settings.emby.refreshTaskId,
    embyRefreshTaskName: settings.emby.refreshTaskName
  });

  const discoverEmbyTasks = async () => {
    setLoadingEmbyTasks(true);
    setMessage("");
    setError("");
    try {
      await api.saveSettings(settingsPayload());
      const response = await api.embyTasks();
      setEmbyTasks(response.tasks);
      const selected = response.tasks.find((task) => task.id === (settings.emby.refreshTaskId || response.suggestedTaskId));
      if (selected) {
        setSettings({
          ...settings,
          emby: {
            ...settings.emby,
            refreshTaskId: selected.id,
            refreshTaskName: selected.name
          }
        });
      }
      setMessage(response.tasks.length ? "Emby tasks loaded." : "No Emby scheduled tasks were returned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Emby tasks");
    } finally {
      setLoadingEmbyTasks(false);
    }
  };

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
              await api.saveSettings(settingsPayload());
              setXcPassword("");
              setEmbyApiKey("");
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
          <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-mist p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Provider profiles</h2>
                <p className="mt-1 text-sm text-ink/60">Upstream XC credentials are used in order. Each active channel stream consumes one connection from the assigned profile.</p>
              </div>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold"
                onClick={async () => {
                  const results = await Promise.allSettled(settings.providerProfiles.map((profile) => api.checkProviderProfile(profile.id)));
                  const latest = [...results].reverse().find((result) => result.status === "fulfilled");
                  if (latest?.status === "fulfilled") setProviderProfiles(latest.value.profiles);
                  const failed = results.find((result) => result.status === "rejected");
                  if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "Provider account check failed");
                }}
              >
                <RefreshCw size={15} /> Check accounts
              </button>
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {settings.providerProfiles.map((profile) => (
                <article key={profile.id} className={`rounded-md border border-line bg-panel p-3 ${profile.enabled ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold">{profile.name}</h3>
                        {profile.is_primary ? <span className="rounded-md bg-accent/15 px-2 py-1 text-xs font-bold text-accent">Primary</span> : null}
                        <span className="rounded-md border border-line px-2 py-1 text-xs font-bold text-ink/70">{profile.max_connections} max</span>
                        {profile.account_days_left !== null && <span className="rounded-md border border-line px-2 py-1 text-xs font-bold text-ink/70">{profile.account_days_left} days left</span>}
                      </div>
                      <p className="mt-1 text-sm text-ink/60">
                        {profile.account_status || "Not checked"}
                        {profile.last_checked_at ? ` · checked ${formatRefreshTimestamp(profile.last_checked_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={Boolean(profile.enabled)}
                          disabled={Boolean(profile.is_primary)}
                          onChange={async (event) => {
                            const response = await api.updateProviderProfile(profile.id, { enabled: event.target.checked });
                            setProviderProfiles(response.profiles);
                          }}
                        />
                        Enabled
                      </label>
                      {!profile.is_primary && (
                        <button
                          type="button"
                          className="rounded-md border border-line px-3 text-sm font-semibold"
                          onClick={async () => {
                            const response = await api.deleteProviderProfile(profile.id);
                            setProviderProfiles(response.profiles);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-sm font-medium">
                      Name
                      <input
                        className="min-h-10 rounded-md border border-line px-3 disabled:opacity-70"
                        disabled={Boolean(profile.is_primary)}
                        value={profile.name}
                        onChange={(event) => setProviderProfiles(settings.providerProfiles.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item))}
                        onBlur={async (event) => {
                          if (profile.is_primary) return;
                          const response = await api.updateProviderProfile(profile.id, { name: event.target.value });
                          setProviderProfiles(response.profiles);
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Max connections
                      <input
                        className="min-h-10 rounded-md border border-line px-3"
                        type="number"
                        min={1}
                        max={100}
                        value={profile.max_connections}
                        onChange={(event) => setProviderProfiles(settings.providerProfiles.map((item) => item.id === profile.id ? { ...item, max_connections: Number(event.target.value) } : item))}
                        onBlur={async (event) => {
                          const response = await api.updateProviderProfile(profile.id, { maxConnections: Number(event.target.value) });
                          setProviderProfiles(response.profiles);
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Username
                      <input
                        className="min-h-10 rounded-md border border-line px-3 disabled:opacity-70"
                        disabled={Boolean(profile.is_primary)}
                        value={profile.username}
                        onChange={(event) => setProviderProfiles(settings.providerProfiles.map((item) => item.id === profile.id ? { ...item, username: event.target.value } : item))}
                        onBlur={async (event) => {
                          if (profile.is_primary) return;
                          const response = await api.updateProviderProfile(profile.id, { username: event.target.value });
                          setProviderProfiles(response.profiles);
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Password
                      <input
                        className="min-h-10 rounded-md border border-line px-3 disabled:opacity-70"
                        disabled={Boolean(profile.is_primary)}
                        type="password"
                        value={profile.password}
                        onChange={(event) => setProviderProfiles(settings.providerProfiles.map((item) => item.id === profile.id ? { ...item, password: event.target.value } : item))}
                        onBlur={async (event) => {
                          if (profile.is_primary) return;
                          const response = await api.updateProviderProfile(profile.id, { password: event.target.value });
                          setProviderProfiles(response.profiles);
                        }}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-line bg-panel p-3">
              <h3 className="font-bold">Add provider profile</h3>
              <p className="mt-1 text-sm text-ink/60">Streams will keep the same provider server and channel URL, but replace the primary username/password with this profile&apos;s credentials.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Name
                  <input className="min-h-10 rounded-md border border-line px-3" value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Max connections
                  <input className="min-h-10 rounded-md border border-line px-3" type="number" min={1} max={100} value={providerDraft.maxConnections} onChange={(event) => setProviderDraft({ ...providerDraft, maxConnections: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Username
                  <input className="min-h-10 rounded-md border border-line px-3" value={providerDraft.username} onChange={(event) => setProviderDraft({ ...providerDraft, username: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Password
                  <input className="min-h-10 rounded-md border border-line px-3" type="password" value={providerDraft.password} onChange={(event) => setProviderDraft({ ...providerDraft, password: event.target.value })} />
                </label>
              </div>
              <button
                type="button"
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
                disabled={!providerDraft.name.trim() || !providerDraft.username.trim() || !providerDraft.password}
                onClick={async () => {
                  const response = await api.createProviderProfile(providerDraft);
                  setProviderProfiles(response.profiles);
                  setProviderDraft({
                    maxConnections: 1,
                    name: `Profile ${response.profiles.length + 1}`,
                    password: "",
                    username: ""
                  });
                }}
              >
                Add provider profile
              </button>
            </div>
          </div>
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
                <select
                  className="min-h-11 w-full min-w-0 rounded-md border border-line bg-panel py-2 pl-3"
                  value={settings.ffmpegHlsInputMode}
                  onChange={(event) => setSettings({ ...settings, ffmpegHlsInputMode: event.target.value as Settings["ffmpegHlsInputMode"] })}
                >
                  <option value="direct">Direct FFmpeg input</option>
                  <option value="pipe">Node pipe fallback</option>
                </select>
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
          <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-mist p-3">
            <h2 className="text-base font-bold">External access</h2>
            <p className="mt-1 text-sm text-ink/60">M3U, XMLTV, and XC-compatible HLS or MPEG-TS access for Emby and IPTV clients.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Internal Docker base URL
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  value={settings.externalInternalBaseUrl}
                  onChange={(event) => setSettings({ ...settings, externalInternalBaseUrl: event.target.value })}
                  placeholder="http://sstv-iptv:3025"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Public base URL
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  value={settings.externalPublicBaseUrl}
                  onChange={(event) => setSettings({ ...settings, externalPublicBaseUrl: event.target.value })}
                  placeholder="https://tv.example.com"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {settings.externalProfiles.map((profile) => {
                const internal = externalUrls(settings.externalInternalBaseUrl, profile);
                const external = externalUrls(settings.externalPublicBaseUrl || settings.externalInternalBaseUrl, profile);
                return (
                  <article key={profile.id} className="rounded-md border border-line bg-panel p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">{profile.name}</h3>
                        <p className="text-sm text-ink/60">{profile.name === "Emby" ? "Use internal URLs for Docker-to-Docker setup." : "Use public URLs for phones, tablets, and IPTV apps."}</p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={Boolean(profile.enabled)}
                          onChange={async (event) => {
                            const response = await api.updateExternalProfile(profile.id, { enabled: event.target.checked });
                            setExternalProfiles(response.profiles);
                          }}
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <label className="grid gap-1 font-medium">
                        Stream output
                        <select
                          className="min-h-10 rounded-md border border-line px-3"
                          value={profile.output_mode}
                          onChange={async (event) => {
                            const outputMode = event.target.value as ExternalProfile["output_mode"];
                            setExternalProfiles(settings.externalProfiles.map((item) => item.id === profile.id ? { ...item, output_mode: outputMode } : item));
                            const response = await api.updateExternalProfile(profile.id, { outputMode });
                            setExternalProfiles(response.profiles);
                          }}
                        >
                          <option value="hls">HLS (.m3u8)</option>
                          <option value="mpegts">MPEG-TS (.ts)</option>
                        </select>
                      </label>
                      <label className="grid gap-1 font-medium">
                        XC username
                        <input
                          className="min-h-10 rounded-md border border-line px-3"
                          value={profile.xc_username}
                          onChange={(event) => setExternalProfiles(settings.externalProfiles.map((item) => item.id === profile.id ? { ...item, xc_username: event.target.value } : item))}
                          onBlur={async (event) => {
                            const response = await api.updateExternalProfile(profile.id, { xcUsername: event.target.value });
                            setExternalProfiles(response.profiles);
                          }}
                        />
                      </label>
                      <div className="rounded-md border border-line bg-mist p-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">XC password</div>
                        <div className="mt-1 break-all font-mono text-xs">{profile.xc_password}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      {internal && (
                        <div className="rounded-md border border-line p-2">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Internal URLs</div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} internal M3U`, internal.m3u)}><Copy size={15} /> M3U {profile.output_mode === "mpegts" ? "TS" : "HLS"}</button>
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} internal XMLTV`, internal.xmltv)}><Copy size={15} /> XMLTV</button>
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} XC server`, internal.xcServer)}><Copy size={15} /> XC server</button>
                          </div>
                        </div>
                      )}
                      {external && (
                        <div className="rounded-md border border-line p-2">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Public URLs</div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} public M3U`, external.m3u)}><Copy size={15} /> M3U {profile.output_mode === "mpegts" ? "TS" : "HLS"}</button>
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} public XMLTV`, external.xmltv)}><Copy size={15} /> XMLTV</button>
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 font-semibold" onClick={() => copyText(`${profile.name} XC M3U`, external.xcM3u)}><Copy size={15} /> XC M3U {profile.output_mode === "mpegts" ? "TS" : "HLS"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold" onClick={async () => {
                        const response = await api.regenerateExternalToken(profile.id);
                        setExternalProfiles(response.profiles);
                      }}><KeyRound size={15} /> Regenerate token</button>
                      <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold" onClick={async () => {
                        const response = await api.regenerateExternalPassword(profile.id);
                        setExternalProfiles(response.profiles);
                      }}><KeyRound size={15} /> Reset XC password</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-mist p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Emby guide refresh</h2>
                <p className="mt-1 text-sm text-ink/60">Trigger Emby&apos;s Live TV guide task after SSTV IPTV refreshes provider data.</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={settings.emby.enabled}
                  onChange={(event) => setSettings({ ...settings, emby: { ...settings.emby, enabled: event.target.checked } })}
                />
                Enabled
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Emby server URL
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  value={settings.emby.baseUrl}
                  onChange={(event) => setSettings({ ...settings, emby: { ...settings.emby, baseUrl: event.target.value } })}
                  placeholder="http://emby:8096"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Emby API key
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-line px-3"
                  type="password"
                  placeholder={settings.emby.apiKeySet ? "Leave blank to keep current API key" : ""}
                  value={embyApiKey}
                  onChange={(event) => setEmbyApiKey(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Guide refresh task
                <select
                  className="min-h-11 w-full min-w-0 rounded-md border border-line bg-panel py-2 pl-3 text-ink"
                  value={settings.emby.refreshTaskId}
                  onChange={(event) => {
                    const task = embyTasks.find((item) => item.id === event.target.value);
                    setSettings({
                      ...settings,
                      emby: {
                        ...settings.emby,
                        refreshTaskId: event.target.value,
                        refreshTaskName: task?.name ?? settings.emby.refreshTaskName
                      }
                    });
                  }}
                >
                  <option value="">{settings.emby.refreshTaskName || "Auto-detect guide refresh task"}</option>
                  {embyTasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"
                  disabled={loadingEmbyTasks}
                  onClick={discoverEmbyTasks}
                >
                  <RefreshCw size={16} className={loadingEmbyTasks ? "animate-spin" : ""} /> Load tasks
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold"
                  onClick={async () => {
                    setMessage("");
                    setError("");
                    try {
                      await api.saveSettings(settingsPayload());
                      setEmbyApiKey("");
                      const response = await api.triggerEmbyRefresh();
                      setMessage(response.message);
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Unable to trigger Emby guide refresh");
                    }
                  }}
                >
                  <RefreshCw size={16} /> Test trigger
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={settings.emby.refreshAfterProviderRefresh}
                  onChange={(event) => setSettings({ ...settings, emby: { ...settings.emby, refreshAfterProviderRefresh: event.target.checked } })}
                />
                Trigger after provider refresh completes
              </label>
              <span className="text-ink/60">
                {settings.emby.configured ? "Configured" : "Not configured"}
                {settings.emby.refreshTaskName ? ` · ${settings.emby.refreshTaskName}` : ""}
              </span>
            </div>
            {settings.emby.lastStatus && (
              <div className="mt-3 rounded-md border border-line bg-panel p-3 text-sm">
                <div className="font-semibold">Last Emby trigger: {settings.emby.lastStatus}</div>
                <div className="mt-1 text-ink/60">
                  {settings.emby.lastTriggeredAt ? `${formatRefreshTimestamp(settings.emby.lastTriggeredAt)} · ` : ""}
                  {settings.emby.lastMessage}
                </div>
              </div>
            )}
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">EPG match diagnostics</h2>
            <p className="text-sm text-ink/60">
              Shows how each enabled channel was matched during the last provider refresh.
              {epgDiagnostics.length ? ` ${filteredDiagnostics.length}/${epgDiagnostics.length} shown.` : " Run a refresh to populate diagnostics."}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold"
            onClick={async () => {
              const response = await api.epgDiagnostics();
              setEpgDiagnostics(response.diagnostics);
            }}
          >
            <RefreshCw size={16} /> Reload
          </button>
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" size={18} />
          <input
            className="min-h-11 w-full rounded-md border border-line bg-mist py-2 pl-10 pr-3 text-sm outline-none focus:border-accent"
            value={epgSearch}
            onChange={(event) => setEpgSearch(event.target.value)}
            placeholder="Search channel, group, provider EPG id, XMLTV id, method, or warning"
          />
        </label>
        {filteredDiagnostics.length > visibleDiagnostics.length && (
          <p className="mt-2 text-xs text-ink/55">Showing the first {visibleDiagnostics.length} matches. Narrow the search to compare specific channels.</p>
        )}
        <div className="mt-3 grid gap-2 md:hidden">
          {visibleDiagnostics.map((diagnostic) => (
            <article key={diagnostic.id} className="rounded-md border border-line bg-mist p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{diagnostic.channel_number ? `CH ${diagnostic.channel_number} · ` : ""}{diagnostic.display_name}</div>
                  <div className="text-xs text-ink/55">{diagnostic.group_title || "No group"}</div>
                </div>
                <span className="rounded-md border border-line bg-panel px-2 py-1 text-xs font-bold">
                  {diagnostic.xmltv_match_method || "unmatched"} {formatMatchScore(diagnostic.xmltv_match_score)}
                </span>
              </div>
              <div className="mt-3 grid gap-1 text-xs">
                <div><span className="text-ink/50">Provider EPG:</span> {diagnostic.tvg_id || "none"}</div>
                <div><span className="text-ink/50">XMLTV:</span> {diagnostic.xmltv_channel_id || "none"}{diagnostic.xmltv_match_name ? ` · ${diagnostic.xmltv_match_name}` : ""}</div>
              </div>
              {diagnostic.warnings.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {diagnostic.warnings.map((warning) => (
                    <span key={warning} className="rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-semibold text-ink/70">{warning}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr>
                <th className="py-2">Channel</th>
                <th>Group</th>
                <th>Source</th>
                <th>Provider EPG</th>
                <th>XMLTV match</th>
                <th>Method</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {visibleDiagnostics.map((diagnostic) => (
                <tr key={diagnostic.id} className="border-b border-line align-top">
                  <td className="py-2">
                    <div className="font-semibold">{diagnostic.channel_number ? `CH ${diagnostic.channel_number} · ` : ""}{diagnostic.display_name}</div>
                    <div className="text-xs text-ink/50">{diagnostic.tvg_name && diagnostic.tvg_name !== diagnostic.display_name ? diagnostic.tvg_name : ""}</div>
                  </td>
                  <td>{diagnostic.group_title || "No group"}</td>
                  <td className="font-mono text-xs">{diagnostic.source_id || diagnostic.id}</td>
                  <td className="font-mono text-xs">
                    {diagnostic.tvg_id || "none"}
                    {diagnostic.tvg_id_count > 1 ? <span className="ml-1 text-gold">x{diagnostic.tvg_id_count}</span> : null}
                  </td>
                  <td>
                    <div className="font-mono text-xs">{diagnostic.xmltv_channel_id || "none"}</div>
                    <div className="max-w-56 truncate text-xs text-ink/55">{diagnostic.xmltv_match_name || ""}</div>
                  </td>
                  <td>
                    <span className={`rounded-md px-2 py-1 text-xs font-bold ${
                      diagnostic.xmltv_match_method === "tvg-id"
                        ? "bg-accent/15 text-accent"
                        : diagnostic.xmltv_match_method === "fuzzy"
                          ? "bg-gold/15 text-gold"
                          : diagnostic.xmltv_match_method
                            ? "border border-line text-ink/75"
                            : "bg-rose-500/15 text-rose-700"
                    }`}>
                      {diagnostic.xmltv_match_method || "unmatched"} {formatMatchScore(diagnostic.xmltv_match_score)}
                    </span>
                  </td>
                  <td>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {diagnostic.warnings.map((warning) => (
                        <span key={warning} className="rounded-md border border-line bg-mist px-2 py-1 text-xs text-ink/70">{warning}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <div className="mt-3 text-xs">
                <div className="text-ink/50">Duration</div>
                <div className="font-bold">{formatRunDuration(run)}</div>
              </div>
              {run.error && <p className="mt-2 line-clamp-2 text-xs text-rose-700">{String(run.error)}</p>}
            </article>
          ))}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr><th className="py-2">Status</th><th>Started</th><th>Duration</th><th>Channels</th><th>Programs</th><th>Matched</th><th>Error</th></tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={String(run.id)} className="border-b border-line">
                  <td className="py-2 font-semibold">{String(run.status)}</td>
                  <td>{formatRefreshTimestamp(run.started_at)}</td>
                  <td>{formatRunDuration(run)}</td>
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
