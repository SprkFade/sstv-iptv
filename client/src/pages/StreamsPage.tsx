import { useCallback, useEffect, useState } from "react";
import { Activity, MonitorPlay, RefreshCw, Users, Wifi } from "lucide-react";
import { api, type StreamMonitor, type StreamQuality } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";

const REFRESH_INTERVAL_OPTIONS = [2, 5, 10, 15] as const;

function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "n/a";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRuntimeSeconds(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "Active";
  return formatDuration(seconds * 1000);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function compactUserAgent(value: string) {
  if (!value || value === "unknown") return "Unknown client";
  const browser = value.match(/(CriOS|Chrome|Version|Firefox|FxiOS|EdgiOS|Edg|Safari)\/[\d.]+/g)?.at(-1)?.replace("Version", "Safari");
  const device = /iPad/i.test(value) ? "iPad" : /iPhone/i.test(value) ? "iPhone" : /Android/i.test(value) ? "Android" : /Macintosh|Mac OS/i.test(value) ? "Mac" : /Windows/i.test(value) ? "Windows" : "";
  return [device, browser].filter(Boolean).join(" / ") || value.slice(0, 80);
}

function compactQuality(quality: StreamQuality) {
  const width = quality.video?.width;
  const height = quality.video?.height;
  const resolution = height
    ? `${height}p`
    : width && width >= 1900
      ? "1080p"
      : width && width >= 1200
        ? "720p"
        : width
          ? `${width}w`
          : "Detecting";
  const fps = quality.video?.fps ? `${Math.round(quality.video.fps)}fps` : "";
  return [resolution, fps].filter(Boolean).join(" / ");
}

export function StreamsPage() {
  const [monitor, setMonitor] = useState<StreamMonitor | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState<(typeof REFRESH_INTERVAL_OPTIONS)[number]>(15);

  const load = useCallback(async () => {
    const response = await api.streams();
    setMonitor(response);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to load stream activity");
      setLoading(false);
    });
    const timer = window.setInterval(() => {
      load().catch((err) => setError(err instanceof Error ? err.message : "Unable to refresh stream activity"));
    }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [load, refreshIntervalSeconds]);

  return (
    <div className="grid min-w-0 gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-accent text-white"><MonitorPlay /></span>
            <div>
              <h1 className="text-2xl font-bold">Streams</h1>
              <p className="text-sm text-ink/60">Active HLS and MPEG-TS sessions with connected clients. Refreshes every {refreshIntervalSeconds} seconds.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Refresh
              <select
                className="min-h-10 rounded-md border border-line bg-panel py-2 pl-3 pr-10 text-sm font-semibold normal-case tracking-normal text-ink"
                value={refreshIntervalSeconds}
                onChange={(event) => setRefreshIntervalSeconds(Number(event.target.value) as (typeof REFRESH_INTERVAL_OPTIONS)[number])}
              >
                {REFRESH_INTERVAL_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} seconds</option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                load().catch((err) => {
                  setError(err instanceof Error ? err.message : "Unable to refresh stream activity");
                  setLoading(false);
                });
              }}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
        {error && <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Wifi className="mb-3 text-accent" />
          <div className="text-sm text-ink/60">Provider connections</div>
          <div className="text-2xl font-bold">{monitor?.providerConnectionCount ?? 0}</div>
        </div>
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Users className="mb-3 text-berry" />
          <div className="text-sm text-ink/60">Connected clients</div>
          <div className="text-2xl font-bold">{monitor?.activeClientCount ?? 0}</div>
        </div>
        <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <Activity className="mb-3 text-gold" />
          <div className="text-sm text-ink/60">Active channels</div>
          <div className="text-2xl font-bold">{monitor?.streamCount ?? 0}</div>
        </div>
      </section>

      {monitor?.embySessionError && (
        <div className="rounded-md border border-gold/40 bg-gold/10 p-3 text-sm text-gold">
          Emby now playing lookup failed: {monitor.embySessionError}
        </div>
      )}

      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">Current sessions</h2>
            <p className="text-sm text-ink/60">
              {monitor ? `Updated ${new Date(monitor.refreshedAt).toLocaleTimeString()}` : "Loading stream activity..."}
            </p>
          </div>
        </div>

        {!loading && monitor?.streams.length === 0 && (
          <div className="mt-4 rounded-md border border-line bg-mist p-6 text-center text-sm text-ink/60">
            No active stream clients right now.
          </div>
        )}

        <div className="mt-4 grid gap-3">
          {monitor?.streams.map((stream) => (
            <article key={`${stream.outputType}-${stream.channelId}`} className="overflow-hidden rounded-md border border-line bg-mist">
              <div className="grid gap-3 p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="grid min-w-0 gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-line px-2 py-1 text-xs font-bold text-ink/70">
                        {stream.channelNumber ? `CH ${stream.channelNumber}` : `ID ${stream.channelId}`}
                      </span>
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${stream.active ? "bg-accent text-white" : "bg-rose-500 text-white"}`}>
                        {stream.active ? "Running" : `Exited ${stream.exitCode ?? ""}`}
                      </span>
                      <span className="rounded-md border border-line px-2 py-1 text-xs font-bold text-ink/70">
                        {stream.outputType === "mpegts" ? "MPEG-TS" : "HLS"}
                      </span>
                      {stream.providerProfileName && (
                        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-bold text-accent">
                          {stream.providerProfileName}
                        </span>
                      )}
                      {stream.embySessions && stream.embySessions.length > 0 && (
                        <span className="rounded-md border border-berry/40 bg-berry/10 px-2 py-1 text-xs font-bold text-berry">
                          Emby {stream.embySessions.map((session) => session.userName || session.deviceName || "user").join(", ")}
                        </span>
                      )}
                      {stream.mode === "videoOnly" && <span className="rounded-md bg-gold/20 px-2 py-1 text-xs font-bold text-gold">Video only</span>}
                      {stream.mode === "audioOnly" && <span className="rounded-md bg-accent/15 px-2 py-1 text-xs font-bold text-accent">Audio only</span>}
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <ChannelLogo src={stream.channelLogoUrl} name={stream.channelName} size="sm" />
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold">{stream.channelName}</h3>
                        <p className="text-sm text-ink/60">{stream.groupTitle || "No group"} · {stream.inputMode === "ffmpeg-direct" ? "Direct FFmpeg input" : "Node pipe input"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="rounded-md border border-line bg-panel px-3 py-2 text-xs font-bold text-ink/80" title="FFmpeg speed">
                      {stream.ffmpegSpeed ?? "n/a"}
                    </span>
                    <span className="rounded-md border border-line bg-panel px-3 py-2 text-xs font-bold text-ink/80">
                      Input {compactQuality(stream.quality.input)}
                    </span>
                    <span className="rounded-md border border-line bg-panel px-3 py-2 text-xs font-bold text-ink/80">
                      Output {compactQuality(stream.quality.output)}
                    </span>
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Clients</div>
                    <div className="font-bold">{stream.clientCount}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Runtime</div>
                    <div className="font-bold">{formatDuration(stream.runtimeMs)}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">{stream.outputType === "mpegts" ? "Output" : "Latest segment"}</div>
                    <div className="font-bold">{stream.outputType === "mpegts" ? "Live TS" : `${formatDuration(stream.latestSegmentAgeMs)} ago`}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">{stream.outputType === "mpegts" ? "Streams" : "Requests"}</div>
                    <div className="font-bold">{stream.outputType === "mpegts" ? stream.segmentRequests : `${stream.playlistRequests}/${stream.segmentRequests}`}</div>
                  </div>
                </div>
              </div>

              <div className="border-t border-line">
                {stream.clients.length === 0 ? (
                  <div className="p-4 text-sm text-ink/60">No recent clients for this session.</div>
                ) : (
                  <div className="grid divide-y divide-line">
                    {stream.clients.map((client) => (
                      <div key={client.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">{client.username}</span>
                            <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{client.role}</span>
                            {client.source === "external" && (
                              <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                                {client.externalProfileName ?? "External"}
                              </span>
                            )}
                            {client.providerProfileName && (
                              <span className="rounded-md border border-line bg-panel px-2 py-0.5 text-xs font-semibold text-ink/70">
                                {client.providerProfileName}
                              </span>
                            )}
                            <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{client.lastRequestKind}</span>
                          </div>
                          <p className="mt-1 truncate text-ink/60">{client.ip} · {compactUserAgent(client.userAgent)}</p>
                          {client.lastSegmentName && <p className="mt-1 text-xs text-ink/50">Last segment {client.lastSegmentName}</p>}
                        </div>
                        <div>
                          <div className="text-ink/50">Last seen</div>
                          <div className="font-semibold">{formatDuration(client.lastSeenAgeMs)} ago</div>
                        </div>
                        <div>
                          <div className="text-ink/50">Requests</div>
                          <div className="font-semibold">{client.lastRequestKind === "stream" ? "Live stream" : `${client.playlistRequests}/${client.segmentRequests}`}</div>
                        </div>
                        <div>
                          <div className="text-ink/50">Served</div>
                          <div className="font-semibold">{formatBytes(client.bytesServed)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">Connection log</h2>
            <p className="text-sm text-ink/60">Recent stream client starts, stops, run time, and disconnect reasons.</p>
          </div>
        </div>

        {!loading && monitor?.connectionLogs.length === 0 && (
          <div className="mt-4 rounded-md border border-line bg-mist p-6 text-center text-sm text-ink/60">
            No stream connections have been logged yet.
          </div>
        )}

        <div className="mt-4 hidden overflow-x-auto rounded-md border border-line md:block">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-mist text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Ended</th>
                <th className="px-3 py-2">Runtime</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Served</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {monitor?.connectionLogs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="px-3 py-3">
                    <div className="font-bold">{log.username}</div>
                    <div className="text-xs text-ink/55">{log.ip} · {compactUserAgent(log.user_agent)}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{log.source}</span>
                      <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{log.output_type.toUpperCase()}</span>
                      {log.external_profile_name && <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">{log.external_profile_name}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-bold">{log.channel_number ? `CH ${log.channel_number}` : log.channel_id ? `ID ${log.channel_id}` : ""} {log.channel_name}</div>
                    <div className="text-xs text-ink/55">{log.group_title || "No group"}</div>
                    {log.provider_profile_name && <div className="mt-1 text-xs font-semibold text-accent">{log.provider_profile_name}</div>}
                  </td>
                  <td className="px-3 py-3 text-ink/75">{formatDateTime(log.started_at)}</td>
                  <td className="px-3 py-3 text-ink/75">{log.ended_at ? formatDateTime(log.ended_at) : "Active"}</td>
                  <td className="px-3 py-3 font-semibold">{formatRuntimeSeconds(log.runtime_seconds)}</td>
                  <td className="px-3 py-3 text-ink/75">{log.stop_reason || "Active"}</td>
                  <td className="px-3 py-3">
                    <div className="font-semibold">{formatBytes(log.bytes_served)}</div>
                    <div className="text-xs text-ink/55">{log.playlist_requests}/{log.segment_requests} requests</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 md:hidden">
          {monitor?.connectionLogs.map((log) => (
            <article key={log.id} className="rounded-md border border-line bg-mist p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{log.username}</span>
                <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{log.output_type.toUpperCase()}</span>
                <span className="rounded-md border border-line px-2 py-0.5 text-xs text-ink/60">{log.ended_at ? "Ended" : "Active"}</span>
              </div>
              <div className="mt-2 font-semibold">{log.channel_number ? `CH ${log.channel_number}` : ""} {log.channel_name}</div>
              <div className="mt-1 text-ink/60">{formatDateTime(log.started_at)} · {formatRuntimeSeconds(log.runtime_seconds)}</div>
              <div className="mt-1 text-ink/60">{log.stop_reason || "Active"} · {formatBytes(log.bytes_served)}</div>
              <div className="mt-1 truncate text-xs text-ink/50">{log.ip} · {compactUserAgent(log.user_agent)}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
