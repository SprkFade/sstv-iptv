import { useCallback, useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { api, type Airing } from "../api/client";
import { GuideGrid, type PlaybackSelection } from "../components/GuideGrid";
import { VideoPlayer } from "../components/VideoPlayer";
import { useIsDesktop } from "../hooks/useIsDesktop";

const PAGE_SIZE = 25;

export function FavoritesPage() {
  const [airing, setAiring] = useState<Airing[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [guideAt, setGuideAt] = useState(() => new Date().toISOString());
  const [selected, setSelected] = useState<PlaybackSelection | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();

  const loadGuide = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const guide = await api.currentGuide(`?favorites=true&limit=${PAGE_SIZE}&offset=${offset}`);
      setAiring((current) => append ? [...current, ...guide.airing] : guide.airing);
      setGuideAt(guide.at);
      setTotal(guide.total);
      setHasMore(guide.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load favorites");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadGuide(0).catch(() => undefined);
  }, [loadGuide]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadGuide(airing.length, true).catch(() => undefined);
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [airing.length, hasMore, loading, loadingMore, loadGuide]);

  const removeFavorite = async (item: Airing) => {
    await api.removeFavorite(item.channel_id);
    if (selected?.item.channel_id === item.channel_id) setSelected(null);
    await loadGuide(0);
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md bg-berry text-white"><Heart /></span>
          <div>
            <h1 className="text-2xl font-bold">Favorites</h1>
            <p className="text-sm text-ink/60">{total} saved channels</p>
          </div>
        </div>
      </section>
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {!loading && total === 0 ? (
        <section className="rounded-md border border-line bg-panel p-8 text-center shadow-soft">
          <Heart className="mx-auto mb-3 text-ink/35" size={34} />
          <h2 className="text-lg font-bold">No favorites yet</h2>
          <p className="mt-1 text-sm text-ink/60">Add channels from the guide and they will show up here.</p>
        </section>
      ) : (
        <div className={`grid gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
          <GuideGrid
            airing={airing}
            guideAt={guideAt}
            loading={loading}
            loadingMore={loadingMore}
            loadMoreRef={loadMoreRef}
            selectedChannelId={selected?.item.channel_id}
            selectedProgramId={selected?.program?.id ?? null}
            onSelect={setSelected}
            onToggleFavorite={(item) => removeFavorite(item).catch(() => undefined)}
          />
          {selected && isDesktop && (
            <aside className="hidden h-fit rounded-md border border-line bg-panel p-3 shadow-soft xl:sticky xl:top-5 xl:block">
              <VideoPlayer channelId={selected.item.channel_id} src={selected.item.stream_url} title={selected.item.display_name} />
              <div className="mt-3">
                <div className="text-sm text-ink/60">{selected.item.display_name}</div>
                <h2 className="mt-1 text-lg font-bold">{selected.program?.title ?? selected.item.title ?? "Live TV"}</h2>
                <p className="mt-1 line-clamp-3 text-sm text-ink/65">{selected.program?.description || selected.item.description || selected.item.group_title}</p>
              </div>
            </aside>
          )}
        </div>
      )}
      {selected && !isDesktop && (
        <div className="fixed inset-x-3 bottom-[4.75rem] z-40 overflow-hidden rounded-md border border-line bg-panel shadow-soft xl:hidden">
          <div className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 p-2">
            <div className="overflow-hidden rounded bg-black">
              <VideoPlayer channelId={selected.item.channel_id} src={selected.item.stream_url} title={selected.item.display_name} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{selected.program?.title ?? selected.item.title ?? "Live TV"}</div>
              <div className="truncate text-xs text-ink/60">{selected.item.display_name}</div>
            </div>
            <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
