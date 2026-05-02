import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Channel, type Program, type StreamStatus } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { ProgramBar } from "../components/ProgramBar";
import { VideoPlayer } from "../components/VideoPlayer";
import { formatTime } from "../utils/time";

export function ChannelPage() {
  const { id = "" } = useParams();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await api.channelGuide(id);
    setChannel(response.channel);
    setPrograms(response.programs);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load channel"));
  }, [id]);

  if (error) return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>;
  if (!channel) return <div className="text-sm text-ink/60">Loading channel...</div>;

  const current = programs.find((program) => new Date(program.start_time) <= new Date() && new Date(program.end_time) > new Date());
  const hasGuideData = programs.length > 0;

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
        <VideoPlayer channelId={channel.id} src={channel.stream_url} title={channel.display_name} />
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
            {programs.map((program) => (
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

      <StreamStatusLog channelId={channel.id} />
    </div>
  );
}

function StreamStatusLog({ channelId }: { channelId: number }) {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let timeout: number | undefined;

    const poll = async () => {
      try {
        const response = await api.streamStatus(channelId, true);
        if (!disposed) {
          setStatus(response);
          setError("");
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Unable to load stream status");
      } finally {
        if (!disposed) timeout = window.setTimeout(poll, 2000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [channelId]);

  const latestFiles = status?.files.slice(-8).reverse() ?? [];
  const logText = status?.stderr?.trim()
    || status?.message
    || (status ? "FFmpeg HLS session is active; waiting for first segment files." : "Waiting for the player to start an FFmpeg HLS session.");
  const playlistLines = status?.playlist?.trim().split("\n").slice(-12).join("\n") ?? "";

  return (
    <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Live stream log</h2>
          <p className="text-sm text-ink/60">Updates every 2 seconds while this page is open.</p>
        </div>
        <div className="rounded-md border border-line px-3 py-2 text-sm font-semibold">
          {error ? "Status unavailable" : status?.active ? "FFmpeg running" : "FFmpeg stopped"}
          {status?.mode === "videoOnly" ? ", video-only fallback" : ""}
          {typeof status?.exitCode === "number" ? `, exit ${status.exitCode}` : ""}
        </div>
      </div>

      {error && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 rounded-md border border-line bg-black/40 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">FFmpeg stderr</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-ink/80 scrollbar-none">{logText}</pre>
        </div>

        <div className="grid gap-3">
          <div className="rounded-md border border-line bg-mist p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Segments</div>
            <div className="mt-2 text-2xl font-bold">{status?.files.length ?? 0}</div>
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
    </section>
  );
}
