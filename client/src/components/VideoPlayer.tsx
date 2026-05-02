import Hls from "hls.js";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function isMobile() {
  const touchPoints = navigator.maxTouchPoints || 0;
  return touchPoints > 0
    || ("ontouchstart" in window)
    || window.matchMedia?.("(pointer: coarse)").matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || ((/Macintosh|MacIntel/i.test(navigator.userAgent) || /MacIntel/i.test(navigator.platform)) && touchPoints > 1);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type VideoPlayerProps = {
  channelId: number;
  src: string;
  title: string;
  onTrace?: (message: string) => void;
};

type ScreenWakeLockSentinel = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
  };
};

function formatRanges(ranges: TimeRanges) {
  const values: string[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    values.push(`${ranges.start(index).toFixed(1)}-${ranges.end(index).toFixed(1)}`);
  }
  return values.length ? values.join(",") : "none";
}

export function VideoPlayer({ channelId, src, title, onTrace }: VideoPlayerProps) {
  const mobile = typeof navigator !== "undefined" && isMobile();
  if (mobile) return <MobileNativeVideoPlayer channelId={channelId} src={src} title={title} />;
  return <ManagedVideoPlayer channelId={channelId} src={src} title={title} onTrace={onTrace} />;
}

function MobileNativeVideoPlayer({ channelId, src, title }: VideoPlayerProps) {
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);
  const transcodeSrc = useMemo(() => `/api/stream/${channelId}/transcode`, [channelId]);
  const transcodeHlsSrc = useMemo(() => `/api/stream/${channelId}/hls/index.m3u8`, [channelId]);
  const transcodeStatusSrc = useMemo(() => `/api/stream/${channelId}/hls/status`, [channelId]);
  const [preparedHlsSrc, setPreparedHlsSrc] = useState("");

  useEffect(() => {
    let disposed = false;
    setPreparedHlsSrc("");
    fetch(`${transcodeHlsSrc}?prepare=1&_=${Date.now()}`, { cache: "no-store" })
      .then(() => {
        if (!disposed) setPreparedHlsSrc(transcodeHlsSrc);
      })
      .catch(() => {
        if (!disposed) setPreparedHlsSrc("");
      });
    return () => {
      disposed = true;
    };
  }, [transcodeHlsSrc]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-black">
      <video
        className="aspect-video w-full bg-black"
        controls
        playsInline
        preload="metadata"
        src={preparedHlsSrc || undefined}
        title={title}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-black p-3 text-xs text-white/70">
        <span className="font-semibold text-white">Native mobile playback v4 autoloads the stream</span>
        <a className="inline-flex min-h-9 items-center gap-1 rounded-md border border-white/20 px-2 font-semibold" href={`${transcodeHlsSrc}?prepare=1`} target="_blank" rel="noreferrer">
          HLS <ExternalLink size={14} />
        </a>
        <a className="inline-flex min-h-9 items-center gap-1 rounded-md border border-white/20 px-2 font-semibold" href={transcodeStatusSrc} target="_blank" rel="noreferrer">
          Status <ExternalLink size={14} />
        </a>
        <a className="inline-flex min-h-9 items-center gap-1 rounded-md border border-white/20 px-2 font-semibold" href={transcodeSrc} target="_blank" rel="noreferrer">
          TS <ExternalLink size={14} />
        </a>
        <a className="inline-flex min-h-9 items-center gap-1 rounded-md border border-white/20 px-2 font-semibold" href={proxySrc} target="_blank" rel="noreferrer">
          Proxy <ExternalLink size={14} />
        </a>
        <a className="inline-flex min-h-9 items-center gap-1 rounded-md border border-white/20 px-2 font-semibold" href={src} target="_blank" rel="noreferrer">
          Direct <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

function ManagedVideoPlayer({ channelId, src, title, onTrace }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Preparing stream...");
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const mobile = false;
  const proxySrc = useMemo(() => `/api/stream/${channelId}`, [channelId]);
  const transcodeSrc = useMemo(() => `/api/stream/${channelId}/transcode`, [channelId]);
  const transcodeHlsSrc = useMemo(() => `/api/stream/${channelId}/hls/index.m3u8`, [channelId]);
  const transcodeStatusSrc = useMemo(() => `/api/stream/${channelId}/hls/status`, [channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

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
    let stallTimer: number | undefined;
    let watchdogTimer: number | undefined;
    let lastProgressAt = Date.now();
    let lastRecoveryAt = 0;
    let lastVideoTime = 0;
    let lastLevelEndSn = -1;
    let lastLevelLoadedAt = 0;
    let lastFragmentLoadedAt = Date.now();
    let lastFragmentSn = -1;
    let playlistFragmentLagRecoveries = 0;
    let softRecoveries = 0;
    let hardRecoveries = 0;
    let wakeLock: ScreenWakeLockSentinel | null = null;

    const trace = (message: string) => {
      onTrace?.(`${new Date().toLocaleTimeString()} ${message}`);
    };
    const playerState = () => (
      `t=${video.currentTime.toFixed(1)} ready=${video.readyState} network=${video.networkState} buffered=${formatRanges(video.buffered)} seekable=${formatRanges(video.seekable)}`
    );
    const setPlaybackError = (message: string) => {
      trace(`error: ${message} (${playerState()})`);
      if (!disposed) setError(message);
    };
    const onWakeLockRelease = () => {
      wakeLock = null;
      trace("screen wake lock released");
    };
    const releaseWakeLock = () => {
      const lock = wakeLock;
      wakeLock = null;
      if (!lock) return;
      lock.removeEventListener("release", onWakeLockRelease);
      if (!lock.released) {
        void lock.release().catch((err) => {
          trace(`screen wake lock release failed: ${err instanceof Error ? err.message : "unknown error"}`);
        });
      }
    };
    const requestWakeLock = async () => {
      if (mobile) return;
      if (disposed || video.paused || video.ended || document.visibilityState !== "visible") return;
      if (wakeLock && !wakeLock.released) return;
      const api = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!api) {
        trace("screen wake lock unavailable in this browser");
        return;
      }
      try {
        wakeLock = await api.request("screen");
        wakeLock.addEventListener("release", onWakeLockRelease);
        trace("screen wake lock active");
      } catch (err) {
        wakeLock = null;
        trace(`screen wake lock request failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    };
    const syncWakeLock = () => {
      if (mobile) return;
      if (!video.paused && !video.ended && document.visibilityState === "visible") {
        void requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };
    const waitForPreparedHls = async () => {
      const started = Date.now();
      let lastError = "";
      trace("preparing FFmpeg HLS session");
      while (!disposed && Date.now() - started < 30_000) {
        prepareAbort = new AbortController();
        try {
          const response = await fetch(`${transcodeHlsSrc}?prepare=1&_=${Date.now()}`, {
            cache: "no-store",
            signal: prepareAbort.signal
          });
          if (response.ok) {
            const playlist = await response.text();
            const segmentCount = playlist.match(/segment_\d{5}\.ts/g)?.length ?? 0;
            if (playlist.includes("#EXTINF") && segmentCount >= 2) {
              trace(`prepared HLS playlist with ${segmentCount} segments`);
              return;
            }
            lastError = `FFmpeg is preparing the first video segments (${segmentCount}/2).`;
          } else {
            lastError = `FFmpeg HLS is not ready yet (${response.status}).`;
          }
        } catch (err) {
          if (disposed) return;
          lastError = err instanceof Error ? err.message : "FFmpeg HLS is not ready yet.";
        } finally {
          prepareAbort = null;
        }
        setLoadingMessage(lastError || "Preparing stream...");
        await wait(1000);
      }
      throw new Error(lastError || "Timed out preparing the FFmpeg HLS stream.");
    };
    const requestPlayback = () => {
      if (disposed) return;
      if (mobile) {
        trace(`mobile playback left to native controls (${playerState()})`);
        return;
      }
      trace(`play requested (${playerState()})`);
      const playRequest = video.play();
      if (playRequest) {
        playRequest
          .then(() => {
            trace(`play started (${playerState()})`);
            if (!disposed) setPlaybackBlocked(false);
          })
          .catch(() => {
            trace(`play blocked by browser (${playerState()})`);
            if (!disposed) setPlaybackBlocked(true);
          });
      }
    };
    const clearStallTimer = () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = undefined;
    };
    const hardResetPlayer = (reason: string) => {
      if (disposed || hardRecoveries >= 2) return;
      hardRecoveries += 1;
      trace(`hard player reset ${hardRecoveries}/2: ${reason} (${playerState()})`);
      setRetryKey((value) => value + 1);
    };
    const restartLiveLoad = (reason: string) => {
      if (disposed || video.ended) return;
      const now = Date.now();
      if (now - lastRecoveryAt < 5000) return;
      lastRecoveryAt = now;
      trace(`live reload recovery: ${reason} (${playerState()})`);
      if (hls?.liveSyncPosition && Number.isFinite(hls.liveSyncPosition)) {
        video.currentTime = hls.liveSyncPosition;
      } else if (video.seekable.length > 0) {
        const liveEdge = video.seekable.end(video.seekable.length - 1);
        if (Number.isFinite(liveEdge) && liveEdge > 12) video.currentTime = Math.max(0, liveEdge - 12);
      }
      hls?.stopLoad();
      hls?.recoverMediaError();
      hls?.startLoad(-1);
      requestPlayback();
    };
    const recoverFromStall = () => {
      if (disposed || video.paused || video.ended) return;
      const now = Date.now();
      if (now - lastRecoveryAt < 5000) return;
      lastRecoveryAt = now;
      softRecoveries += 1;
      trace(`stall recovery started (${playerState()})`);
      if (hls?.liveSyncPosition && Number.isFinite(hls.liveSyncPosition)) {
        const drift = Math.abs(video.currentTime - hls.liveSyncPosition);
        if (drift > 2) {
          trace(`seeking to hls.js live sync ${hls.liveSyncPosition.toFixed(1)} from drift ${drift.toFixed(1)}s`);
          video.currentTime = hls.liveSyncPosition;
        }
      } else if (video.seekable.length > 0) {
        const liveEdge = video.seekable.end(video.seekable.length - 1);
        if (Number.isFinite(liveEdge) && liveEdge > 8) {
          const target = Math.max(0, liveEdge - 8);
          trace(`seeking near live edge ${target.toFixed(1)} from edge ${liveEdge.toFixed(1)}`);
          video.currentTime = target;
        }
      }
      hls?.startLoad(-1);
      hls?.recoverMediaError();
      requestPlayback();
      if (softRecoveries >= 3 && now - lastProgressAt > 15_000) {
        hardResetPlayer("playback clock did not resume after hls.js recovery");
      }
    };
    const scheduleStallRecovery = () => {
      if (mobile) return;
      trace(`video stalled/waiting; recovery scheduled (${playerState()})`);
      clearStallTimer();
      stallTimer = window.setTimeout(recoverFromStall, 8000);
    };
    const onVideoError = () => {
      if (!hlsError) setPlaybackError("The browser could not decode the FFmpeg HLS stream.");
    };
    const onPlaying = () => {
      clearStallTimer();
      if (mobile) {
        setPlaybackBlocked(false);
        return;
      }
      void requestWakeLock();
      trace(`video playing (${playerState()})`);
      setPlaybackBlocked(false);
    };
    const onProgressing = () => {
      if (Math.abs(video.currentTime - lastVideoTime) > 0.1) {
        lastProgressAt = Date.now();
        lastVideoTime = video.currentTime;
        softRecoveries = 0;
      }
      clearStallTimer();
    };
    const onCanPlay = () => {
      if (!mobile) trace(`video canplay (${playerState()})`);
    };
    const onVisibilityChange = () => syncWakeLock();
    video.addEventListener("error", onVideoError);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("pause", releaseWakeLock);
    video.addEventListener("ended", releaseWakeLock);
    video.addEventListener("timeupdate", onProgressing);
    video.addEventListener("waiting", scheduleStallRecovery);
    video.addEventListener("stalled", scheduleStallRecovery);
    document.addEventListener("visibilitychange", onVisibilityChange);

    void (async () => {
      try {
        await waitForPreparedHls();
        if (disposed) return;
        setLoadingMessage("");

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = transcodeHlsSrc;
          trace("using native HLS playback");
          if (!mobile) video.addEventListener("canplay", requestPlayback, { once: true });
          return;
        }

        if (!Hls.isSupported()) {
          setPlaybackError("This browser does not support HLS playback through Media Source Extensions.");
          return;
        }

        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          liveSyncDurationCount: 10,
          liveMaxLatencyDurationCount: 45,
          maxLiveSyncPlaybackRate: 1.25,
          liveDurationInfinity: true,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          backBufferLength: 60,
          liveBackBufferLength: 60,
          highBufferWatchdogPeriod: 2,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 12,
          manifestLoadingMaxRetry: 10,
          levelLoadingMaxRetry: 10,
          fragLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 1000,
          levelLoadingRetryDelay: 1000,
          fragLoadingRetryDelay: 1000
        });
        hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
          trace(`manifest loaded levels=${data.levels?.length ?? 0}`);
        });
        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
          lastLevelLoadedAt = Date.now();
          lastLevelEndSn = Number(data.details.endSN);
          trace(`level loaded live=${data.details.live} seq=${data.details.startSN}-${data.details.endSN} window=${data.details.totalduration.toFixed(1)}s`);
        });
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
          const sn = Number(data.frag.sn);
          if (Number.isFinite(sn)) {
            lastFragmentSn = sn;
            lastFragmentLoadedAt = Date.now();
            playlistFragmentLagRecoveries = 0;
          }
          trace(`fragment loaded sn=${data.frag.sn} duration=${data.frag.duration.toFixed(1)}s`);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          trace(`hls.js ${data.fatal ? "fatal " : ""}${data.type}:${data.details} (${playerState()})`);
          const details = String(data.details ?? "");
          if (!data.fatal && /buffer|stalled|nudge/i.test(details)) {
            scheduleStallRecovery();
            return;
          }
          if (!data.fatal && /fragLoad|levelLoad|manifestLoad/i.test(details)) {
            hls?.startLoad(-1);
            return;
          }
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 12) {
            networkRecoveries += 1;
            console.warn("Recovering FFmpeg HLS network error", data);
            hls?.startLoad(-1);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 12) {
            mediaRecoveries += 1;
            console.warn("Recovering FFmpeg HLS media error", data);
            hls?.recoverMediaError();
            hls?.startLoad(-1);
            requestPlayback();
            return;
          }
          hlsError = true;
          console.warn("FFmpeg HLS playback error", data);
          const code = data.response?.code ? ` HTTP ${data.response.code}` : "";
          const reason = [data.type, data.details].filter(Boolean).join(": ");
          setPlaybackError(`FFmpeg HLS failed${reason ? ` (${reason}${code})` : code ? ` (${code.trim()})` : ""}.`);
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          trace("hls.js media attached");
          hls?.loadSource(transcodeHlsSrc);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          trace("hls.js manifest parsed");
          if (!mobile) requestPlayback();
        });
        hls.attachMedia(video);
        watchdogTimer = window.setInterval(() => {
          if (disposed || video.paused || video.ended || !hls) return;
          if (mobile) return;
          const fragmentLag = lastLevelEndSn - lastFragmentSn;
          const fragmentIdleMs = Date.now() - lastFragmentLoadedAt;
          const playlistFreshMs = Date.now() - lastLevelLoadedAt;
          if (lastLevelEndSn > 0 && fragmentLag >= 6 && fragmentIdleMs > 12_000 && playlistFreshMs < 8_000) {
            playlistFragmentLagRecoveries += 1;
            trace(`watchdog detected playlist/fragment lag: live sn=${lastLevelEndSn}, last fragment=${lastFragmentSn}, idle=${Math.round(fragmentIdleMs / 1000)}s`);
            if (playlistFragmentLagRecoveries >= 2) {
              hardResetPlayer(`playlist advanced ${fragmentLag} segments beyond fragment loader`);
            } else {
              restartLiveLoad(`playlist is ${fragmentLag} segments ahead of fragment loader`);
            }
            return;
          }
          const stalledMs = Date.now() - lastProgressAt;
          if (stalledMs > 10_000) {
            trace(`watchdog detected ${Math.round(stalledMs / 1000)}s without playback progress (${playerState()})`);
            recoverFromStall();
          }
        }, 4000);
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
      clearStallTimer();
      releaseWakeLock();
      if (watchdogTimer) window.clearInterval(watchdogTimer);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("pause", releaseWakeLock);
      video.removeEventListener("ended", releaseWakeLock);
      video.removeEventListener("timeupdate", onProgressing);
      video.removeEventListener("waiting", scheduleStallRecovery);
      video.removeEventListener("stalled", scheduleStallRecovery);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [mobile, onTrace, retryKey, transcodeHlsSrc]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-black">
      <div className="relative">
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          autoPlay={!mobile}
          controls
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
