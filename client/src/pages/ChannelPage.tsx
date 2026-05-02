import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Channel, type Program, type StreamStatus } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { ProgramBar } from "../components/ProgramBar";
import { VideoPlayer } from "../components/VideoPlayer";
import { formatTime } from "../utils/time";

const UPCOMING_WINDOW_HOURS = 12;
const UPCOMING_LIMIT = 5;

function guideWindowParams() {
  const start = new Date();
  const end = new Date(start.getTime() + UPCOMING_WINDOW_HOURS * 60 * 60 * 1000);
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString()
  });
  return `?${params.toString()}`;
}

export function ChannelPage() {
  const { id = "" } = useParams();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [error, setError] = useState("");
  const [playerTrace, setPlayerTrace] = useState<string[]>([]);

  const load = async () => {
    const response = await api.channelGuide(id, guideWindowParams());
    setChannel(response.channel);
    setPrograms(response.programs);
  };

  useEffect(() => {
    setPlayerTrace([]);
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load channel"));
  }, [id]);

  const addPlayerTrace = useCallback((message: string) => {
    setPlayerTrace((current) => [...current, message].slice(-80));
  }, []);

  if (error) return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>;
  if (!channel) return <div className="text-sm text-ink/60">Loading channel...</div>;

  const current = programs.find((program) => new Date(program.start_time) <= new Date() && new Date(program.end_time) > new Date());
  const hasGuideData = programs.length > 0;
  const upcomingPrograms = programs.slice(0, UPCOMING_LIMIT);

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChannelLogo src={channel.logo_url} name={channel.display_name} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{channel.display_name}</h1>
              <p className="truncate text-sm text-ink/60">{channel.group_title}</p>
            </div>
          </div>
          <FavoriteButton
            active={Boolean(channel.favorite)}
            onClick={async () => {
              if (channel.favorite) await api.removeFavorite(channel.id);
              else await api.addFavorite(channel.id);
              await load();
            }}
          />
        </div>
        <VideoPlayer channelId={channel.id} src={channel.stream_url} title={channel.display_name} onTrace={addPlayerTrace} />
        {current && (
          <div className="mt-4 rounded-md border border-line bg-mist p-4">
            <div className="text-sm font-semibold text-ink/60">Now playing</div>
            <h2 className="mt-1 text-xl font-bold">{current.title}</h2>
            <p className="mt-1 text-sm text-ink/70">{current.description}</p>
            <ProgramBar start={current.start_time} end={current.end_time} />
          </div>
        )}
      </section>

      {hasGuideData && (
        <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <h2 className="text-xl font-bold">Upcoming</h2>
          <div className="mt-3 grid gap-2">
            {upcomingPrograms.map((program) => (
              <article key={program.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{program.title}</h3>
                    <p className="line-clamp-2 text-sm text-ink/70">{program.description || program.subtitle}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs font-semibold text-ink/60">
                    {formatTime(program.start_time)}<br />{formatTime(program.end_time)}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <StreamStatusLog channelId={channel.id} playerTrace={playerTrace} />
    </div>
  );
}

function formatAge(ageMs: number | null | undefined) {
  if (ageMs === null || ageMs === undefined) return "n/a";
  if (ageMs < 1000) return `${Math.max(0, Math.round(ageMs))} ms`;
  return `${Math.max(0, Math.round(ageMs / 1000))}s ago`;
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StreamStatusLog({ channelId, playerTrace }: { channelId: number; playerTrace: string[] }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timeout: number | undefined;

    const poll = async () => {
      try {
        const response = await api.streamStatus(channelId, false);
        if (!disposed) {
          setStatus(response);
          setError("");
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Unable to load stream status");
      } finally {
        if (!disposed) timeout = window.setTimeout(poll, expanded ? 2000 : 10000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [channelId, expanded]);

  const latestFiles = status?.files.filter((file) => /^segment_\d{5}\.ts$/.test(file.name)).slice(-8).reverse() ?? [];
  const logText = status?.stderr?.trim()
    || status?.message
    || (status ? "FFmpeg HLS session is active; waiting for first segment files." : "Waiting for the player to start an FFmpeg HLS session.");
  const playlistLines = status?.playlist?.trim().split("\n").slice(-12).join("\n") ?? "";
  const eventLines = status?.trace?.events.slice(-12).map((event) => `${new Date(event.at).toLocaleTimeString()} ${event.message}`).join("\n") ?? "";
  const playerLines = playerTrace.slice(-18).join("\n");
  const statusText = error ? "Status unavailable" : status?.active ? "FFmpeg running" : "FFmpeg stopped";
  const statusDetail = [
    status?.mode === "videoOnly" ? "video-only fallback" : "",
    status?.mode === "audioOnly" ? "audio-only output" : "",
    typeof status?.exitCode === "number" ? `exit ${status.exitCode}` : "",
    status?.trace?.latestSegment ? `latest segment ${formatAge(status.trace.latestSegmentAgeMs)}` : ""
  ].filter(Boolean).join(" · ");

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="rounded-md border border-line bg-panel shadow-soft"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-base font-bold">Stream diagnostics</h2>
          <p className="text-sm text-ink/60">{expanded ? "Updates every 2 seconds while open." : statusDetail || "Open for stream logs and segment details."}</p>
        </div>
        <div className="rounded-md border border-line px-3 py-2 text-sm font-semibold">
          {statusText}
        </div>
      </summary>

      <div className="border-t border-line p-4">
        {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        {status?.trace && (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Newest segment</div>
            <div className="mt-1 text-sm font-bold">{status.trace.latestSegment?.name ?? "none"}</div>
            <div className="text-xs text-ink/60">{formatAge(status.trace.latestSegmentAgeMs)}</div>
          </div>
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Playlist</div>
            <div className="mt-1 text-sm font-bold">seq {status.trace.playlistStats.mediaSequence}</div>
            <div className="text-xs text-ink/60">{status.trace.playlistStats.segmentCount} seg / {status.trace.playlistStats.windowSeconds}s / age {formatAge(status.trace.playlistAgeMs)}</div>
          </div>
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Player requests</div>
            <div className="mt-1 text-sm font-bold">{status.trace.requests.playlist} playlists / {status.trace.requests.segment} segments</div>
            <div className="text-xs text-ink/60">last {status.trace.requests.lastSegmentName || "none"} {formatAge(status.trace.requests.lastSegmentAgeMs)}</div>
          </div>
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Provider input</div>
            <div className="mt-1 text-sm font-bold">
              {status.trace.inputMode === "ffmpeg-direct" ? "FFmpeg direct" : formatBytes(status.trace.inputBytes)}
            </div>
            <div className="text-xs text-ink/60">
              {status.trace.inputMode === "ffmpeg-direct" ? "upstream handled by FFmpeg" : `last byte ${formatAge(status.trace.lastInputAgeMs)}`}
            </div>
          </div>
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Input quality</div>
            <div className="mt-1 text-sm font-bold">{status.trace.quality.input.label}</div>
            <div className="text-xs text-ink/60">provider stream</div>
          </div>
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Output quality</div>
            <div className="mt-1 text-sm font-bold">{status.trace.quality.output.label}</div>
            <div className="text-xs text-ink/60">browser HLS</div>
          </div>
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 rounded-md border border-line bg-black/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">FFmpeg stderr</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ink/80 scrollbar-none">{logText}</pre>
          </div>

          <div className="grid gap-3">
            <div className="rounded-md border border-line bg-mist p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Segments</div>
              <div className="mt-2 text-2xl font-bold">{status?.trace?.completedSegmentCount ?? latestFiles.length}</div>
              <div className="mt-2 grid gap-1 text-xs text-ink/60">
                {latestFiles.length > 0 ? latestFiles.map((file) => (
                  <div key={file.name} className="flex justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0">{Math.round(file.size / 1024)} KB</span>
                  </div>
                )) : <span>No segment files yet.</span>}
              </div>
            </div>

            <div className="rounded-md border border-line bg-mist p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Playlist tail</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ink/70 scrollbar-none">{playlistLines || "No playlist yet."}</pre>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-line bg-black/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Session events</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ink/80 scrollbar-none">{eventLines || "No session events yet."}</pre>
          </div>
          <div className="rounded-md border border-line bg-black/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Player events</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ink/80 scrollbar-none">{playerLines || "Waiting for player events."}</pre>
          </div>
        </div>
      </div>
    </details>
  );
}
