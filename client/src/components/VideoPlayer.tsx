import Hls from "hls.js";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function VideoPlayer({ channelId, src, title }: { channelId: number; src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Preparing stream...");
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const mobile = typeof navigator !== "undefined" && isMobile();
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);
  const transcodeSrc = useMemo(() => `/api/stream/${channelId}/transcode`, [channelId]);
  const transcodeHlsSrc = useMemo(() => `/api/stream/${channelId}/hls/index.m3u8`, [channelId]);
  const transcodeStatusSrc = useMemo(() => `/api/stream/${channelId}/hls/status`, [channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mobile) return;

    setError("");
    setLoadingMessage("Preparing stream...");
    setPlaybackBlocked(false);
    video.removeAttribute("src");
    video.load();

    let hls: Hls | null = null;
    let disposed = false;
    let hlsError = false;
    let mediaRecoveries = 0;
    let networkRecoveries = 0;
    let prepareAbort: AbortController | null = null;

    const setPlaybackError = (message: string) => {
      if (!disposed) setError(message);
    };
    const waitForPreparedHls = async () => {
      const started = Date.now();
      let lastError = "";
      while (!disposed && Date.now() - started < 60_000) {
        prepareAbort = new AbortController();
        try {
          const response = await fetch(`${transcodeHlsSrc}?prepare=${Date.now()}`, {
            cache: "no-store",
            signal: prepareAbort.signal
          });
          if (response.ok) {
            const playlist = await response.text();
            if (playlist.includes("#EXTINF") && /segment_\d{5}\.ts/.test(playlist)) return;
            lastError = "FFmpeg is preparing the first video segments.";
          } else {
            lastError = `FFmpeg HLS is not ready yet (${response.status}).`;
          }
        } catch (err) {
          if (disposed) return;
          lastError = err instanceof Error ? err.message : "FFmpeg HLS is not ready yet.";
        } finally {
          prepareAbort = null;
        }
        setLoadingMessage("Preparing stream...");
        await wait(1000);
      }
      throw new Error(lastError || "Timed out preparing the FFmpeg HLS stream.");
    };
    const requestPlayback = () => {
      if (disposed) return;
      video.muted = true;
      const playRequest = video.play();
      if (playRequest) {
        playRequest
          .then(() => {
            if (!disposed) setPlaybackBlocked(false);
          })
          .catch(() => {
            if (!disposed) setPlaybackBlocked(true);
          });
      }
    };
    const onVideoError = () => {
      if (!hlsError) setPlaybackError("The browser could not decode the FFmpeg HLS stream.");
    };
    const onPlaying = () => setPlaybackBlocked(false);
    video.addEventListener("error", onVideoError);
    video.addEventListener("playing", onPlaying);

    void (async () => {
      try {
        await waitForPreparedHls();
        if (disposed) return;
        setLoadingMessage("");

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = transcodeHlsSrc;
          video.addEventListener("canplay", requestPlayback, { once: true });
          return;
        }

        if (!Hls.isSupported()) {
          setPlaybackError("This browser does not support HLS playback through Media Source Extensions.");
          return;
        }

        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          liveSyncDurationCount: 5,
          liveMaxLatencyDurationCount: 14,
          maxLiveSyncPlaybackRate: 1.25
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 5) {
            networkRecoveries += 1;
            console.warn("Recovering FFmpeg HLS network error", data);
            hls?.startLoad(-1);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
            mediaRecoveries += 1;
            console.warn("Recovering FFmpeg HLS media error", data);
            hls?.recoverMediaError();
            return;
          }
          hlsError = true;
          console.warn("FFmpeg HLS playback error", data);
          const code = data.response?.code ? ` HTTP ${data.response.code}` : "";
          const reason = [data.type, data.details].filter(Boolean).join(": ");
          setPlaybackError(`FFmpeg HLS failed${reason ? ` (${reason}${code})` : code ? ` (${code.trim()})` : ""}.`);
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(transcodeHlsSrc));
        hls.on(Hls.Events.MANIFEST_PARSED, requestPlayback);
        hls.attachMedia(video);
      } catch (err) {
        if (!disposed) {
          setLoadingMessage("");
          setPlaybackError(err instanceof Error ? err.message : "Unable to prepare the FFmpeg HLS stream.");
        }
      }
    })();

    return () => {
      disposed = true;
      prepareAbort?.abort();
      hls?.destroy();
      video.removeEventListener("canplay", requestPlayback);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("playing", onPlaying);
    };
  }, [mobile, retryKey, transcodeHlsSrc]);

  if (mobile) {
    return (
      <div className="grid min-h-64 place-items-center rounded-md border border-line bg-black p-6 text-center text-white">
        <div>
          <Play className="mx-auto mb-4" size={34} />
          <a className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-white" href={src}>
            Open stream <ExternalLink size={18} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-black">
      <div className="relative">
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          autoPlay
          controls
          muted
          playsInline
          title={title}
        />
        {loadingMessage && !error && (
          <div className="absolute inset-0 grid place-items-center bg-black text-white">
            <div className="grid justify-items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
              <span className="text-sm font-semibold">{loadingMessage}</span>
            </div>
          </div>
        )}
        {playbackBlocked && !error && (
          <button
            className="absolute inset-0 grid place-items-center bg-black/35 text-white"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = true;
              void video.play().then(() => setPlaybackBlocked(false));
            }}
          >
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/15 backdrop-blur">
              <Play size={30} fill="currentColor" />
            </span>
          </button>
        )}
      </div>
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black p-3 text-sm text-white">
          <span>{error}</span>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-3 font-semibold" href={transcodeHlsSrc} target="_blank" rel="noreferrer">
              HLS <ExternalLink size={16} />
            </a>
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-3 font-semibold" href={transcodeStatusSrc} target="_blank" rel="noreferrer">
              Status <ExternalLink size={16} />
            </a>
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-3 font-semibold" href={transcodeSrc} target="_blank" rel="noreferrer">
              TS <ExternalLink size={16} />
            </a>
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-3 font-semibold" href={proxySrc} target="_blank" rel="noreferrer">
              Proxy <ExternalLink size={16} />
            </a>
            <a className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-3 font-semibold" href={src} target="_blank" rel="noreferrer">
              Direct <ExternalLink size={16} />
            </a>
            <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 font-semibold" onClick={() => setRetryKey((value) => value + 1)}>
              <RotateCcw size={16} /> Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
