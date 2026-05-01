import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, Search, Star } from "lucide-react";
import { api, type Airing } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { formatTime, progress } from "../utils/time";

const PAGE_SIZE = 25;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function timeRange(start?: string | null, end?: string | null) {
  if (!start || !end) return "";
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function minutesRemaining(end?: string | null) {
  if (!end) return "";
  const minutes = Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 60000));
  if (minutes <= 0) return "ending now";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m left` : `${hours}h left`;
}

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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [params] = useSearchParams();
  const timeline = useMemo(() => {
    const base = new Date(guideAt);
    return [0, 30, 60, 90].map((minutes) => formatTime(addMinutes(base, minutes).toISOString()));
  }, [guideAt]);

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
      <section className="min-w-0 overflow-hidden rounded-md border border-white/10 bg-[#111318] p-4 text-white shadow-soft">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-semibold text-white/55">{formatTime(guideAt)}</p>
            <h1 className="text-3xl font-bold">TV guide</h1>
            <p className="text-sm text-white/55">{airing.length} of {total} channels loaded</p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 text-white/45" size={18} />
            <input
              id="guide-search"
              className="min-h-11 w-full rounded-md border border-white/15 bg-white/10 pl-10 pr-3 text-white placeholder:text-white/40 md:w-80"
              placeholder="Search channels and programs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 w-full max-w-full overflow-x-auto pb-1 scrollbar-none">
          <div className="flex min-w-max gap-2">
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${!activeGroup ? "border-rose-500 bg-rose-600 text-white" : "border-white/15 bg-white/10 text-white/75"}`} onClick={() => setActiveGroup("")}>
            <Filter size={16} /> All
          </button>
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${favoritesOnly ? "border-rose-500 bg-rose-600 text-white" : "border-white/15 bg-white/10 text-white/75"}`} onClick={() => setFavoritesOnly(!favoritesOnly)}>
            <Star size={16} /> Favorites
          </button>
          {groups.map((group) => (
            <button key={group} className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-medium ${activeGroup === group ? "border-rose-500 bg-rose-600 text-white" : "border-white/15 bg-white/10 text-white/75"}`} onClick={() => setActiveGroup(group)}>
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

      <section className="min-w-0 overflow-hidden rounded-md border border-black bg-[#0b0c0f] text-white shadow-soft">
        <div className="overflow-x-auto scrollbar-none">
          <div className="grid min-w-[860px] gap-0">
            <div className="sticky top-0 z-10 grid grid-cols-[4.75rem_minmax(0,1fr)] border-b border-white/10 bg-[#14161a]/95 backdrop-blur">
              <div className="grid place-items-center border-r border-white/10 px-2 py-3 text-white/45">
                <Filter size={18} />
              </div>
              <div className="grid grid-cols-4 text-sm font-semibold text-white/60">
                {timeline.map((time) => (
                  <div key={time} className="border-r border-white/10 px-4 py-3 last:border-r-0">{time}</div>
                ))}
              </div>
            </div>
            {loading && airing.length === 0 && (
              <div className="p-4 text-sm text-white/60">Loading guide...</div>
            )}
            {!loading && airing.length === 0 && (
              <div className="p-4 text-sm text-white/60">No channels match this view.</div>
            )}
            {airing.map((item) => (
              <article key={item.channel_id} className="grid min-h-[74px] grid-cols-[4.75rem_minmax(0,1fr)] border-b border-black/80 last:border-b-0">
                <Link
                  to={`/channel/${item.channel_id}`}
                  className="grid place-items-center border-r border-black/80 bg-[#24272c] px-2 py-2"
                  title={item.display_name}
                >
                  <div className="grid justify-items-center gap-1">
                    <ChannelLogo src={item.logo_url} name={item.display_name} size="sm" />
                    <span className="text-[0.68rem] font-bold tabular-nums text-white/55">{item.channel_number ?? item.sort_order + 1}</span>
                  </div>
                </Link>
                <div className="grid grid-cols-[minmax(22rem,1.45fr)_minmax(14rem,0.8fr)_minmax(14rem,0.8fr)_auto] gap-1 bg-[#15171b] p-1">
                  <Link
                    to={`/channel/${item.channel_id}`}
                    className="group/program relative min-w-0 overflow-hidden rounded-[3px] border border-white/5 bg-[#2b2d31] px-4 py-3 text-left transition hover:border-white hover:bg-white hover:text-[#111318]"
                  >
                    {item.start_time && item.end_time && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                        <div className="h-full bg-red-500" style={{ width: `${progress(item.start_time, item.end_time)}%` }} />
                      </div>
                    )}
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold uppercase text-white/45 group-hover/program:text-black/45">{item.display_name}</div>
                        <h2 className="truncate text-base font-bold">{item.title ?? "No guide data"}</h2>
                        <p className="mt-1 truncate text-sm text-white/55 group-hover/program:text-black/55">
                          {item.subtitle || item.category || item.group_title}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs font-semibold text-red-400 group-hover/program:text-red-600">
                        {minutesRemaining(item.end_time)}
                      </div>
                    </div>
                  </Link>
                  {(item.upcoming ?? []).map((program) => (
                    <Link
                      key={program.id}
                      to={`/channel/${item.channel_id}`}
                      className="min-w-0 overflow-hidden rounded-[3px] border border-white/5 bg-[#222429] px-4 py-3 transition hover:border-white/60 hover:bg-[#30333a]"
                    >
                      <div className="truncate text-xs font-semibold text-white/35">{timeRange(program.start_time, program.end_time)}</div>
                      <div className="mt-1 truncate font-semibold text-white/80">{program.title}</div>
                      <div className="mt-1 truncate text-xs text-white/40">{program.category || program.subtitle}</div>
                    </Link>
                  ))}
                  {Array.from({ length: Math.max(0, 2 - (item.upcoming?.length ?? 0)) }).map((_, index) => (
                    <div key={`empty-${item.channel_id}-${index}`} className="rounded-[3px] border border-white/5 bg-[#1d1f23] px-4 py-3 text-sm text-white/30">
                      Upcoming unavailable
                    </div>
                  ))}
                  <div className="grid place-items-center px-1">
                    <FavoriteButton active={Boolean(item.favorite)} tone="dark" onClick={() => toggleFavorite(item).catch(() => undefined)} />
                  </div>
                </div>
              </article>
            ))}
            <div ref={loadMoreRef} className="h-8" />
            {loadingMore && <div className="p-4 text-center text-sm text-white/60">Loading more channels...</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
