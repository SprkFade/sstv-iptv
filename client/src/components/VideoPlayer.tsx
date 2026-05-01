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

export function VideoPlayer({ channelId, src, title }: { channelId: number; src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const mobile = typeof navigator !== "undefined" && isMobile();
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mobile) return;

    setError("");
    video.removeAttribute("src");
    video.load();

    const onVideoError = () => setError("The browser could not decode this stream.");
    video.addEventListener("error", onVideoError);

    if (isHlsSource(src)) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        return () => video.removeEventListener("error", onVideoError);
      }
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setError(data.details || "The HLS stream failed to load.");
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        return () => {
          hls.destroy();
          video.removeEventListener("error", onVideoError);
        };
      }
    }

    if (mpegts.getFeatureList().mseLivePlayback) {
      const player = mpegts.createPlayer({
        type: "mpegts",
        isLive: true,
        url: proxySrc
      }, {
        enableWorker: true,
        lazyLoad: false,
        liveBufferLatencyChasing: true
      });
      player.on(mpegts.Events.ERROR, (_type, detail) => {
        setError(detail || "The MPEG-TS stream failed to load.");
      });
      player.attachMediaElement(video);
      player.load();
      return () => {
        player.destroy();
        video.removeEventListener("error", onVideoError);
      };
    }

    video.src = proxySrc;
    return () => video.removeEventListener("error", onVideoError);
  }, [mobile, proxySrc, retryKey, src]);

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
          <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 font-semibold" onClick={() => setRetryKey((value) => value + 1)}>
            <RotateCcw size={16} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
