import { useEffect, useState } from "react";
import { Activity, MonitorPlay, RefreshCw, Users, Wifi } from "lucide-react";
import { api, type StreamMonitor } from "../api/client";

function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "n/a";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
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

export function StreamsPage() {
  const [monitor, setMonitor] = useState<StreamMonitor | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const response = await api.streams();
    setMonitor(response);
    setError("");
    setLoading(false);
  };

  useEffect(() => {
    load().catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to load stream activity");
      setLoading(false);
    });
    const timer = window.setInterval(() => {
      load().catch((err) => setError(err instanceof Error ? err.message : "Unable to refresh stream activity"));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="grid min-w-0 gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-accent text-white"><MonitorPlay /></span>
            <div>
              <h1 className="text-2xl font-bold">Streams</h1>
              <p className="text-sm text-ink/60">Active HLS sessions and connected clients. Refreshes every 15 seconds.</p>
            </div>
          </div>
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
            <article key={stream.channelId} className="overflow-hidden rounded-md border border-line bg-mist">
              <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-line px-2 py-1 text-xs font-bold text-ink/70">
                      {stream.channelNumber ? `CH ${stream.channelNumber}` : `ID ${stream.channelId}`}
                    </span>
                    <span className={`rounded-md px-2 py-1 text-xs font-bold ${stream.active ? "bg-accent text-white" : "bg-rose-500 text-white"}`}>
                      {stream.active ? "Running" : `Exited ${stream.exitCode ?? ""}`}
                    </span>
                    {stream.mode === "videoOnly" && <span className="rounded-md bg-gold/20 px-2 py-1 text-xs font-bold text-gold">Video only</span>}
                  </div>
                  <h3 className="mt-2 truncate text-lg font-bold">{stream.channelName}</h3>
                  <p className="text-sm text-ink/60">{stream.groupTitle || "No group"} · {stream.inputMode === "ffmpeg-direct" ? "Direct FFmpeg input" : "Node pipe input"}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6 xl:min-w-[48rem]">
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Clients</div>
                    <div className="font-bold">{stream.clientCount}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Runtime</div>
                    <div className="font-bold">{formatDuration(stream.runtimeMs)}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Latest segment</div>
                    <div className="font-bold">{formatDuration(stream.latestSegmentAgeMs)} ago</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Requests</div>
                    <div className="font-bold">{stream.playlistRequests}/{stream.segmentRequests}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Input quality</div>
                    <div className="font-bold leading-snug">{stream.quality.input.label}</div>
                  </div>
                  <div className="rounded-md border border-line bg-panel p-3">
                    <div className="text-ink/50">Output quality</div>
                    <div className="font-bold leading-snug">{stream.quality.output.label}</div>
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
                          <div className="font-semibold">{client.playlistRequests}/{client.segmentRequests}</div>
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
    </div>
  );
}
