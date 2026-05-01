import Hls from "hls.js";
import mpegts from "mpegts.js";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isHlsSource(src: string) {
  return /\.m3u8(?:[?#].*)?$/i.test(src);
}

function hlsCandidate(src: string) {
  try {
    const url = new URL(src);
    if (!/\.ts$/i.test(url.pathname)) return "";
    url.pathname = url.pathname.replace(/\.ts$/i, ".m3u8");
    return url.toString();
  } catch {
    return src.replace(/\.ts([?#].*)?$/i, ".m3u8$1");
  }
}

export function VideoPlayer({ channelId, src, title }: { channelId: number; src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const mobile = typeof navigator !== "undefined" && isMobile();
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);
  const hlsSrc = useMemo(() => isHlsSource(src) ? src : hlsCandidate(src), [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mobile) return;

    setError("");
    video.removeAttribute("src");
    video.load();

    let hls: Hls | null = null;
    let tsPlayer: mpegts.Player | null = null;
    let triedTs = false;
    let disposed = false;

    const setPlaybackError = (message: string) => {
      if (!disposed) setError(message);
    };
    const onVideoError = () => setPlaybackError("The browser could not decode this stream.");
    video.addEventListener("error", onVideoError);

    const startMpegTs = () => {
      if (triedTs || disposed) return;
      triedTs = true;
      hls?.destroy();
      hls = null;
      setError("");

      if (mpegts.getFeatureList().mseLivePlayback) {
        try {
          tsPlayer = mpegts.createPlayer({
            type: "mpegts",
            isLive: true,
            url: proxySrc
          }, {
            enableWorker: true,
            lazyLoad: false,
            liveBufferLatencyChasing: true
          });
          tsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
            const suffix = [type, detail].filter(Boolean).join(": ");
            setPlaybackError(suffix ? `MPEG-TS playback failed (${suffix}).` : "MPEG-TS playback failed.");
            console.warn("MPEG-TS playback error", { type, detail, info });
          });
          tsPlayer.attachMediaElement(video);
          tsPlayer.load();
          return;
        } catch (err) {
          setPlaybackError(err instanceof Error ? err.message : "The MPEG-TS player failed to start.");
        }
      }

      video.src = proxySrc;
    };

    if (hlsSrc) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsSrc;
        return () => {
          disposed = true;
          video.removeEventListener("error", onVideoError);
        };
      }

      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          console.warn("HLS playback error", data);
          startMpegTs();
        });
        hls.loadSource(hlsSrc);
        hls.attachMedia(video);
        return () => {
          disposed = true;
          hls?.destroy();
          tsPlayer?.destroy();
          video.removeEventListener("error", onVideoError);
        };
      }
    }

    startMpegTs();
    return () => {
      disposed = true;
      hls?.destroy();
      tsPlayer?.destroy();
      video.removeEventListener("error", onVideoError);
    };
  }, [hlsSrc, mobile, proxySrc, retryKey]);

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
