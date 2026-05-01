import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, Search, Star } from "lucide-react";
import { api, type Airing } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { formatTime, progress } from "../utils/time";

const PAGE_SIZE = 25;
const GUIDE_HOURS = 12;
const SLOT_MINUTES = 30;
const SLOT_WIDTH = 150;
const TIMELINE_WIDTH = (GUIDE_HOURS * 60 / SLOT_MINUTES) * SLOT_WIDTH;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function floorToSlot(value: string) {
  const date = new Date(value);
  date.setSeconds(0, 0);
  date.setMinutes(Math.floor(date.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES);
  return date;
}

function timeRange(start?: string | null, end?: string | null) {
  if (!start || !end) return "";
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function programPosition(start: string, end: string, windowStart: number) {
  const windowEnd = windowStart + GUIDE_HOURS * 60 * 60 * 1000;
  const clippedStart = Math.max(new Date(start).getTime(), windowStart);
  const clippedEnd = Math.min(new Date(end).getTime(), windowEnd);
  const left = ((clippedStart - windowStart) / (SLOT_MINUTES * 60 * 1000)) * SLOT_WIDTH;
  const width = Math.max(72, ((clippedEnd - clippedStart) / (SLOT_MINUTES * 60 * 1000)) * SLOT_WIDTH);
  return { left, width };
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
  const guideStart = useMemo(() => floorToSlot(guideAt), [guideAt]);
  const guideStartMs = guideStart.getTime();
  const visibleGuideEnd = useMemo(() => addMinutes(guideStart, GUIDE_HOURS * 60).toISOString(), [guideStart]);
  const timeline = useMemo(() => {
    return Array.from({ length: GUIDE_HOURS * 2 + 1 }, (_, index) => ({
      time: formatTime(addMinutes(guideStart, index * SLOT_MINUTES).toISOString()),
      offset: index * SLOT_WIDTH
    }));
  }, [guideStart]);

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
      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-semibold text-ink/55">{formatTime(guideStart.toISOString())} - {formatTime(visibleGuideEnd)}</p>
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

      <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel shadow-soft">
        <div className="overflow-x-auto">
          <div className="grid gap-0" style={{ minWidth: `${96 + TIMELINE_WIDTH}px` }}>
            <div className="sticky top-0 z-10 grid grid-cols-[6rem_minmax(0,1fr)] border-b border-line bg-panel/95 backdrop-blur">
              <div className="sticky left-0 z-20 grid place-items-center border-r border-line bg-panel px-2 py-3 text-xs font-semibold text-ink/55">
                Channels
              </div>
              <div className="relative h-11" style={{ width: `${TIMELINE_WIDTH}px` }}>
                {timeline.map((slot) => (
                  <div
                    key={`${slot.time}-${slot.offset}`}
                    className="absolute top-0 h-full border-l border-line px-3 py-3 text-sm font-semibold text-ink/60"
                    style={{ left: `${slot.offset}px`, width: `${SLOT_WIDTH}px` }}
                  >
                    {slot.time}
                  </div>
                ))}
              </div>
            </div>
            {loading && airing.length === 0 && (
              <div className="p-4 text-sm text-ink/60">Loading guide...</div>
            )}
            {!loading && airing.length === 0 && (
              <div className="p-4 text-sm text-ink/60">No channels match this view.</div>
            )}
            {airing.map((item) => (
              <article key={item.channel_id} className="grid min-h-[76px] grid-cols-[6rem_minmax(0,1fr)] border-b border-line/80 last:border-b-0">
                <Link
                  to={`/channel/${item.channel_id}`}
                  className="sticky left-0 z-10 grid place-items-center border-r border-line bg-panel px-2 py-2"
                  title={item.display_name}
                >
                  <div className="grid justify-items-center gap-1">
                    <ChannelLogo src={item.logo_url} name={item.display_name} size="sm" />
                    <span className="text-[0.68rem] font-bold tabular-nums text-ink/55">{item.channel_number ?? item.sort_order + 1}</span>
                  </div>
                </Link>
                <div className="relative bg-mist/50 p-1" style={{ width: `${TIMELINE_WIDTH}px` }}>
                  {timeline.slice(0, -1).map((slot) => (
                    <div
                      key={`line-${item.channel_id}-${slot.offset}`}
                      className="absolute top-0 h-full border-l border-line/70"
                      style={{ left: `${slot.offset}px` }}
                    />
                  ))}
                  {(item.programs ?? []).map((program) => {
                    const style = programPosition(program.start_time, program.end_time, guideStartMs);
                    const isCurrent = new Date(program.start_time).getTime() <= Date.now() && new Date(program.end_time).getTime() > Date.now();
                    return (
                      <Link
                        key={program.id}
                        to={`/channel/${item.channel_id}`}
                        className={`group/program absolute top-1 min-w-0 overflow-hidden rounded-[3px] border px-3 py-2 transition ${
                          isCurrent
                            ? "border-accent bg-panel text-ink shadow-sm hover:border-accent"
                            : "border-line bg-panel/85 text-ink hover:border-accent hover:bg-panel"
                        }`}
                        style={{ left: `${style.left}px`, width: `${style.width - 4}px`, height: "68px" }}
                        title={`${program.title} ${timeRange(program.start_time, program.end_time)}`}
                      >
                        {isCurrent && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-ink/10">
                            <div className="h-full bg-accent" style={{ width: `${progress(program.start_time, program.end_time)}%` }} />
                          </div>
                        )}
                        <div className="truncate text-xs font-semibold text-ink/45">{timeRange(program.start_time, program.end_time)}</div>
                        <div className="mt-1 truncate font-semibold">{program.title}</div>
                        <div className="mt-1 truncate text-xs text-ink/55">{program.category || program.subtitle || item.group_title}</div>
                      </Link>
                    );
                  })}
                  {(item.programs ?? []).length === 0 && (
                    <Link
                      to={`/channel/${item.channel_id}`}
                      className="absolute top-1 rounded-[3px] border border-line bg-panel/70 px-3 py-2 text-sm text-ink/50"
                      style={{ left: 0, width: `${Math.min(420, TIMELINE_WIDTH - 4)}px`, height: "68px" }}
                    >
                      No guide data for this window
                    </Link>
                  )}
                  <div className="sticky right-1 ml-auto grid h-[68px] w-11 place-items-center">
                    <FavoriteButton active={Boolean(item.favorite)} onClick={() => toggleFavorite(item).catch(() => undefined)} />
                  </div>
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
