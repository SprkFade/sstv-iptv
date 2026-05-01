import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, Search, Star } from "lucide-react";
import { api, type Airing } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { ProgramBar } from "../components/ProgramBar";

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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [params] = useSearchParams();

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
            <h1 className="text-2xl font-bold">TV guide</h1>
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
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${!activeGroup ? "border-accent bg-accent text-white" : "border-line bg-panel"}`} onClick={() => setActiveGroup("")}>
            <Filter size={16} /> All
          </button>
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${favoritesOnly ? "border-berry bg-berry text-white" : "border-line bg-panel"}`} onClick={() => setFavoritesOnly(!favoritesOnly)}>
            <Star size={16} /> Favorites
          </button>
          {groups.map((group) => (
            <button key={group} className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-medium ${activeGroup === group ? "border-accent bg-accent text-white" : "border-line bg-panel"}`} onClick={() => setActiveGroup(group)}>
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

      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel shadow-soft">
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] gap-0">
            {loading && airing.length === 0 && (
              <div className="p-4 text-sm text-ink/60">Loading guide...</div>
            )}
            {!loading && airing.length === 0 && (
              <div className="p-4 text-sm text-ink/60">No channels match this view.</div>
            )}
            {airing.map((item) => (
          <article key={item.channel_id} className="border-b border-line p-3 last:border-b-0">
            <div className="grid grid-cols-[5.5rem_auto_minmax(0,1fr)_auto] items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-semibold uppercase text-ink/45">CH</div>
                <div className="text-lg font-bold tabular-nums">{item.channel_number ?? item.sort_order + 1}</div>
              </div>
              <Link to={`/channel/${item.channel_id}`}><ChannelLogo src={item.logo_url} name={item.display_name} /></Link>
              <Link to={`/channel/${item.channel_id}`} className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink/60">{item.display_name}</div>
                <h2 className="truncate text-lg font-bold">{item.title ?? "No guide data"}</h2>
                <p className="line-clamp-2 text-sm text-ink/70">{item.description ?? item.group_title}</p>
                <ProgramBar start={item.start_time} end={item.end_time} />
              </Link>
              <FavoriteButton active={Boolean(item.favorite)} onClick={() => toggleFavorite(item).catch(() => undefined)} />
            </div>
          </article>
            ))}
            <div ref={loadMoreRef} className="h-8" />
            {loadingMore && <div className="p-4 text-center text-sm text-ink/60">Loading more channels...</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
