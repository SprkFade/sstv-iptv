import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, Search, Star } from "lucide-react";
import { api, type Airing } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { GuideGrid, type PlaybackSelection } from "../components/GuideGrid";
import { VideoPlayer } from "../components/VideoPlayer";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { formatTime } from "../utils/time";

const PAGE_SIZE = 25;

export function HomePage() {
  const [airing, setAiring] = useState<Airing[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [guideAt, setGuideAt] = useState(() => new Date().toISOString());
  const [selected, setSelected] = useState<PlaybackSelection | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [params] = useSearchParams();
  const isDesktop = useIsDesktop();

  const guideParams = useCallback((offset: number) => {
    const searchParams = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
    if (activeGroup) searchParams.set("group", activeGroup);
    if (favoritesOnly) searchParams.set("favorites", "true");
    return `?${searchParams.toString()}`;
  }, [activeGroup, favoritesOnly]);

  const loadGroups = async () => {
    const channels = await api.channels("?limit=0");
    setGroups(channels.groups);
  };

  const loadGuide = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const guide = await api.currentGuide(guideParams(offset));
      setAiring((current) => append ? [...current, ...guide.airing] : guide.airing);
      setGuideAt(guide.at);
      setTotal(guide.total);
      setHasMore(guide.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load guide");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [guideParams]);

  useEffect(() => {
    loadGroups().catch((err) => setError(err instanceof Error ? err.message : "Unable to load groups"));
  }, []);

  useEffect(() => {
    setSelected(null);
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

  useEffect(() => {
    if (params.get("focus") === "search") {
      window.setTimeout(() => document.getElementById("guide-search")?.focus(), 50);
    }
  }, [params]);

  useEffect(() => {
    if (!query.trim()) {
      setSearch(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.search(query).then(setSearch).catch((err) => setError(err instanceof Error ? err.message : "Search failed"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const toggleFavorite = async (item: Airing) => {
    if (item.favorite) await api.removeFavorite(item.channel_id);
    else await api.addFavorite(item.channel_id);
    await loadGuide(0);
  };

  return (
    <div className="grid gap-4">
      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-semibold text-ink/55">{formatTime(guideAt)}</p>
            <h1 className="text-2xl font-bold">Guide</h1>
            <p className="text-sm text-ink/60">{airing.length} of {total} channels loaded</p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-ink/45" size={18} />
            <input
              id="guide-search"
              className="min-h-11 w-full rounded-md border border-line pl-10 pr-3 md:w-80"
              placeholder="Search channels and programs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 w-full max-w-full overflow-x-auto pb-1 scrollbar-none">
          <div className="flex min-w-max gap-2">
            <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${!activeGroup ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink"}`} onClick={() => setActiveGroup("")}>
              <Filter size={16} /> All
            </button>
            <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${favoritesOnly ? "border-berry bg-berry text-white" : "border-line bg-panel text-ink"}`} onClick={() => setFavoritesOnly(!favoritesOnly)}>
              <Star size={16} /> Favorites
            </button>
            {groups.map((group) => (
              <button key={group} className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-medium ${activeGroup === group ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink"}`} onClick={() => setActiveGroup(group)}>
                {group}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {search && (
        <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
          <h2 className="font-bold">Search results</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {search.channels.map((channel) => (
              <Link className="flex items-center gap-3 rounded-md border border-line p-3 hover:border-accent" key={`c-${channel.id}`} to={`/channel/${channel.id}`}>
                <ChannelLogo src={channel.logo_url} name={channel.display_name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{channel.display_name}</div>
                  <div className="truncate text-sm text-ink/60">{channel.group_title}</div>
                </div>
              </Link>
            ))}
            {search.programs.map((program) => (
              <Link className="rounded-md border border-line p-3 hover:border-accent" key={`p-${program.id}`} to={`/channel/${program.channel_id}`}>
                <div className="truncate font-semibold">{program.title}</div>
                <div className="truncate text-sm text-ink/60">{program.channel_name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
          onToggleFavorite={(item) => toggleFavorite(item).catch(() => undefined)}
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
