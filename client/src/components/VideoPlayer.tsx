import Hls from "hls.js";
import { ExternalLink, Play } from "lucide-react";
import { useEffect, useRef } from "react";

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function VideoPlayer({ src, title }: { src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mobile = typeof navigator !== "undefined" && isMobile();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mobile) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = src;
  }, [src, mobile]);

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
    <video
      ref={videoRef}
      className="aspect-video w-full rounded-md bg-black"
      controls
      playsInline
      title={title}
    />
  );
}
