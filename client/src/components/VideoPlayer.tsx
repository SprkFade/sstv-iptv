import Hls from "hls.js";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function VideoPlayer({ channelId, src, title }: { channelId: number; src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const mobile = typeof navigator !== "undefined" && isMobile();
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);
  const transcodeSrc = useMemo(() => `/api/stream/${channelId}/transcode`, [channelId]);
  const transcodeHlsSrc = useMemo(() => `/api/stream/${channelId}/hls/index.m3u8`, [channelId]);
  const transcodeStatusSrc = useMemo(() => `/api/stream/${channelId}/hls/status`, [channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mobile) return;

    setError("");
    video.removeAttribute("src");
    video.load();

    let hls: Hls | null = null;
    let disposed = false;
    let hlsError = false;
    let mediaRecoveries = 0;
    let networkRecoveries = 0;

    const setPlaybackError = (message: string) => {
      if (!disposed) setError(message);
    };
    const onVideoError = () => {
      if (!hlsError) setPlaybackError("The browser could not decode the FFmpeg HLS stream.");
    };
    video.addEventListener("error", onVideoError);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = transcodeHlsSrc;
      return () => {
        disposed = true;
        video.removeEventListener("error", onVideoError);
      };
    }

    if (!Hls.isSupported()) {
      setPlaybackError("This browser does not support HLS playback through Media Source Extensions.");
      return () => {
        disposed = true;
        video.removeEventListener("error", onVideoError);
      };
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
    hls.loadSource(transcodeHlsSrc);
    hls.attachMedia(video);
    return () => {
      disposed = true;
      hls?.destroy();
      video.removeEventListener("error", onVideoError);
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
      <video
        ref={videoRef}
        className="aspect-video w-full bg-black"
        controls
        playsInline
        title={title}
      />
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
