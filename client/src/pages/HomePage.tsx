import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Filter, Search, Star, X } from "lucide-react";
import { api, type Airing, type Program } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";

const PAGE_SIZE = 25;
const GUIDE_STATE_KEY = "sstv-guide-state";
const GUIDE_FUTURE_HOURS = 12;
const GUIDE_LOOKBACK_HOURS = 2;
const GUIDE_TOTAL_HOURS = GUIDE_LOOKBACK_HOURS + GUIDE_FUTURE_HOURS;
const MINUTE_WIDTH = 5;
const CHANNEL_COLUMN_WIDTH = 260;
const TIMELINE_WIDTH = GUIDE_TOTAL_HOURS * 60 * MINUTE_WIDTH;

type GuideState = {
  activeGroup: string;
  favoritesOnly: boolean;
  query: string;
  scrollY: number;
  guideScrollLeft: number;
  loadedCount: number;
  selectedChannelId?: number;
  updatedAt: number;
};

function readGuideState(): Partial<GuideState> {
  try {
    const raw = window.localStorage.getItem(GUIDE_STATE_KEY);
    if (!raw) return {};
    const state = JSON.parse(raw) as Partial<GuideState>;
    if (state.updatedAt && Date.now() - state.updatedAt > 24 * 60 * 60 * 1000) return {};
    return state;
  } catch {
    return {};
  }
}

function uniqueChannels(items: Airing[]) {
  return items.filter((item, index, list) => (
    list.findIndex((candidate) => candidate.channel_id === item.channel_id) === index
  ));
}

function mergeUniqueChannels(current: Airing[], incoming: Airing[]) {
  const seen = new Set(current.map((item) => item.channel_id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (seen.has(item.channel_id)) return false;
      seen.add(item.channel_id);
      return true;
    })
  ];
}

function formatGuideTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / 60000;
}

function buildTimeMarkers(start: Date) {
  const end = new Date(start.getTime() + GUIDE_TOTAL_HOURS * 60 * 60 * 1000);
  const first = new Date(start);
  const minute = first.getMinutes();
  const nextHalfHour = minute === 0 || minute === 30 ? minute : minute < 30 ? 30 : 60;
  first.setMinutes(nextHalfHour, 0, 0);
  const markers: Array<{ label: string; left: number }> = [];
  for (let marker = first; marker <= end; marker = new Date(marker.getTime() + 30 * 60 * 1000)) {
    markers.push({ label: formatGuideTime(marker), left: Math.max(0, minutesBetween(start, marker) * MINUTE_WIDTH) });
  }
  return markers;
}

function programLayout(program: Program, windowStart: Date, windowEnd: Date) {
  const start = new Date(program.start_time);
  const end = new Date(program.end_time);
  const clippedStart = new Date(Math.max(start.getTime(), windowStart.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), windowEnd.getTime()));
  const left = Math.max(0, minutesBetween(windowStart, clippedStart) * MINUTE_WIDTH);
  const width = Math.max(10, minutesBetween(clippedStart, clippedEnd) * MINUTE_WIDTH);
  return { left, width };
}

function currentProgram(item: Airing) {
  const now = Date.now();
  return item.programs?.find((program) => (
    new Date(program.start_time).getTime() <= now && new Date(program.end_time).getTime() > now
  ));
}

export function HomePage() {
  const restoredState = useRef(readGuideState());
  const guideNowRef = useRef(new Date());
  const guideStartRef = useRef(new Date(guideNowRef.current.getTime() - GUIDE_LOOKBACK_HOURS * 60 * 60 * 1000));
  const guideEndRef = useRef(new Date(guideNowRef.current.getTime() + GUIDE_FUTURE_HOURS * 60 * 60 * 1000));
  const [airing, setAiring] = useState<Airing[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState(() => restoredState.current.activeGroup ?? "");
  const [favoritesOnly, setFavoritesOnly] = useState(() => Boolean(restoredState.current.favoritesOnly));
  const [query, setQuery] = useState(() => restoredState.current.query ?? "");
  const [search, setSearch] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasLoadedGuide, setHasLoadedGuide] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const guideScrollRef = useRef<HTMLDivElement | null>(null);
  const filterScrollRef = useRef<HTMLDivElement | null>(null);
  const channelListRef = useRef<HTMLDivElement | null>(null);
  const initialLoadRef = useRef(true);
  const restoredScrollRef = useRef(false);
  const selectedChannelIdRef = useRef(restoredState.current.selectedChannelId);
  const guideRequestSeqRef = useRef(0);
  const [params] = useSearchParams();

  useEffect(() => {
    document.body.classList.add("guide-page-locked");
    return () => document.body.classList.remove("guide-page-locked");
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const saveGuideState = useCallback((overrides: Partial<GuideState> = {}) => {
    if (Object.prototype.hasOwnProperty.call(overrides, "selectedChannelId")) {
      selectedChannelIdRef.current = overrides.selectedChannelId;
    }
    const state: GuideState = {
      activeGroup,
      favoritesOnly,
      query,
      scrollY: channelListRef.current?.scrollTop ?? window.scrollY,
      guideScrollLeft: guideScrollRef.current?.scrollLeft ?? 0,
      loadedCount: airing.length,
      selectedChannelId: selectedChannelIdRef.current,
      updatedAt: Date.now(),
      ...overrides
    };
    window.localStorage.setItem(GUIDE_STATE_KEY, JSON.stringify(state));
  }, [activeGroup, airing.length, favoritesOnly, query]);

  const guideParams = useCallback((offset: number, limit = PAGE_SIZE) => {
    const searchParams = new URLSearchParams({
      at: guideNowRef.current.toISOString(),
      start: guideStartRef.current.toISOString(),
      end: guideEndRef.current.toISOString(),
      limit: String(limit),
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

  const loadGuide = useCallback(async (offset = 0, append = false, limit = PAGE_SIZE) => {
    const requestSeq = ++guideRequestSeqRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const guide = await api.currentGuide(guideParams(offset, limit));
      if (requestSeq !== guideRequestSeqRef.current) return;
      setAiring((current) => append ? mergeUniqueChannels(current, guide.airing) : uniqueChannels(guide.airing));
      setTotal(guide.total);
      setHasMore(guide.hasMore);
      setHasLoadedGuide(true);
    } catch (err) {
      if (requestSeq !== guideRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Unable to load guide");
    } finally {
      if (requestSeq !== guideRequestSeqRef.current) return;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [guideParams]);

  useEffect(() => {
    loadGroups().catch((err) => setError(err instanceof Error ? err.message : "Unable to load groups"));
  }, []);

  useEffect(() => {
    const limit = initialLoadRef.current
      ? Math.max(PAGE_SIZE, restoredState.current.loadedCount ?? PAGE_SIZE)
      : PAGE_SIZE;
    initialLoadRef.current = false;
    loadGuide(0, false, limit).catch(() => undefined);
  }, [loadGuide]);

  useEffect(() => {
    if (restoredScrollRef.current || loading || airing.length === 0) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const restoredLeft = typeof restoredState.current.guideScrollLeft === "number" && restoredState.current.guideScrollLeft > 0
          ? restoredState.current.guideScrollLeft
          : initialNowOffset;
        guideScrollRef.current?.scrollTo({ left: restoredLeft });
        const selectedChannelId = selectedChannelIdRef.current;
        const selectedRow = selectedChannelId
          ? document.getElementById(`guide-channel-${selectedChannelId}`)
          : null;
        if (selectedRow) {
          restoredScrollRef.current = true;
          selectedRow.scrollIntoView({ block: "center" });
          selectedChannelIdRef.current = undefined;
        } else if (selectedChannelId && hasMore && !loadingMore) {
          loadGuide(airing.length, true).catch(() => undefined);
        } else {
          restoredScrollRef.current = true;
          channelListRef.current?.scrollTo({ top: restoredState.current.scrollY ?? 0 });
        }
      });
    });
  }, [airing.length, hasMore, loadGuide, loading, loadingMore]);

  useEffect(() => {
    let frame = 0;
    const remember = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => saveGuideState());
    };
    const guideScroll = guideScrollRef.current;
    const channelList = channelListRef.current;
    if (guideScroll && guideScroll !== channelList) guideScroll.addEventListener("scroll", remember, { passive: true });
    channelList?.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      if (guideScroll && guideScroll !== channelList) guideScroll.removeEventListener("scroll", remember);
      channelList?.removeEventListener("scroll", remember);
      saveGuideState();
    };
  }, [saveGuideState]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadGuide(airing.length, true).catch(() => undefined);
      }
    }, { root: channelListRef.current, rootMargin: "600px 0px" });
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
    saveGuideState();
    if (item.favorite) await api.removeFavorite(item.channel_id);
    else await api.addFavorite(item.channel_id);
    await loadGuide(0, false, Math.max(PAGE_SIZE, airing.length));
  };

  const invalidateGuideRequests = () => {
    guideRequestSeqRef.current += 1;
    setLoading(false);
    setLoadingMore(false);
  };

  const changeGroup = (group: string) => {
    if (group === activeGroup) return;
    invalidateGuideRequests();
    restoredScrollRef.current = true;
    selectedChannelIdRef.current = undefined;
    setHasMore(false);
    setActiveGroup(group);
    channelListRef.current?.scrollTo({ left: initialNowOffset, top: 0 });
    saveGuideState({ activeGroup: group, scrollY: 0, guideScrollLeft: GUIDE_LOOKBACK_HOURS * 60 * MINUTE_WIDTH, loadedCount: PAGE_SIZE, selectedChannelId: undefined });
  };

  const toggleFavoritesOnly = () => {
    const next = !favoritesOnly;
    invalidateGuideRequests();
    restoredScrollRef.current = true;
    selectedChannelIdRef.current = undefined;
    setHasMore(false);
    setFavoritesOnly(next);
    channelListRef.current?.scrollTo({ left: initialNowOffset, top: 0 });
    saveGuideState({ favoritesOnly: next, scrollY: 0, guideScrollLeft: GUIDE_LOOKBACK_HOURS * 60 * MINUTE_WIDTH, loadedCount: PAGE_SIZE, selectedChannelId: undefined });
  };

  const rememberBeforeNavigate = (channelId?: number) => {
    saveGuideState({ selectedChannelId: channelId });
  };

  const scrollFilters = (direction: -1 | 1) => {
    const scroller = filterScrollRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * Math.max(240, Math.floor(scroller.clientWidth * 0.75)),
      behavior: "smooth"
    });
  };

  const searchActive = query.trim().length > 0;
  const searchResultCount = (search?.channels.length ?? 0) + (search?.programs.length ?? 0);
  const timeMarkers = buildTimeMarkers(guideStartRef.current);
  const currentOffset = Math.max(0, Math.min(TIMELINE_WIDTH, minutesBetween(guideStartRef.current, now) * MINUTE_WIDTH));
  const initialNowOffset = GUIDE_LOOKBACK_HOURS * 60 * MINUTE_WIDTH;
  const guideTemplateColumns = `${CHANNEL_COLUMN_WIDTH}px ${TIMELINE_WIDTH}px`;

  return (
    <div className="guide-screen flex min-h-0 flex-col gap-4">
      <section className="min-w-0 shrink-0 overflow-hidden rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h1 className="text-2xl font-bold">TV guide</h1>
            <p className="text-sm text-ink/60">{airing.length} of {total} channels loaded</p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" size={18} />
            <input
              id="guide-search"
              className="min-h-11 w-full rounded-md border border-line pl-10 pr-10 md:w-80"
              placeholder="Search channels and programs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink/55 hover:bg-ink/5 hover:text-ink"
                onClick={() => {
                  setQuery("");
                  setSearch(null);
                  document.getElementById("guide-search")?.focus();
                }}
                title="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button
            type="button"
            className="hidden min-h-10 w-10 shrink-0 place-items-center rounded-md border border-line bg-panel text-ink/70 hover:bg-ink/5 hover:text-ink sm:grid"
            onClick={() => scrollFilters(-1)}
            title="Scroll filters left"
          >
            <ChevronLeft size={18} />
          </button>
          <div ref={filterScrollRef} className="w-full max-w-full overflow-x-auto scrollbar-none">
            <div className="flex min-w-max gap-2">
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${!activeGroup ? "border-accent bg-accent text-white" : "border-line bg-panel"}`} onClick={() => changeGroup("")}>
            <Filter size={16} /> All
          </button>
          <button className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium ${favoritesOnly ? "border-berry bg-berry text-white" : "border-line bg-panel"}`} onClick={toggleFavoritesOnly}>
            <Star size={16} /> Favorites
          </button>
          {groups.map((group) => (
            <button key={group} className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-medium ${activeGroup === group ? "border-accent bg-accent text-white" : "border-line bg-panel"}`} onClick={() => changeGroup(group)}>
              {group}
            </button>
          ))}
            </div>
          </div>
          <button
            type="button"
            className="hidden min-h-10 w-10 shrink-0 place-items-center rounded-md border border-line bg-panel text-ink/70 hover:bg-ink/5 hover:text-ink sm:grid"
            onClick={() => scrollFilters(1)}
            title="Scroll filters right"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </section>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-panel shadow-soft">
        {searchActive ? (
          <div className="scrollbar-none h-full overflow-y-auto overscroll-contain p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">Search results</h2>
              <span className="text-sm text-ink/55">{search ? `${searchResultCount} found` : "Searching..."}</span>
            </div>
            <div className="mt-3 grid gap-2">
              {!search && <div className="p-4 text-sm text-ink/60">Searching...</div>}
              {search && searchResultCount === 0 && <div className="p-4 text-sm text-ink/60">No results found.</div>}
              {search?.channels.map((channel) => (
                <Link className="flex items-center gap-3 rounded-md border border-line p-3 hover:border-accent" key={`c-${channel.id}`} to={`/channel/${channel.id}`} onClick={() => rememberBeforeNavigate(channel.id)}>
                  <ChannelLogo src={channel.logo_url} name={channel.display_name} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{channel.display_name}</div>
                    <div className="truncate text-sm text-ink/60">{channel.group_title}</div>
                  </div>
                </Link>
              ))}
              {search?.programs.map((program) => (
                <Link className="rounded-md border border-line p-3 hover:border-accent" key={`p-${program.id}`} to={`/channel/${program.channel_id}`} onClick={() => rememberBeforeNavigate(program.channel_id)}>
                  <div className="truncate font-semibold">{program.title}</div>
                  <div className="truncate text-sm text-ink/60">{program.channel_name}</div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={(node) => {
              channelListRef.current = node;
              guideScrollRef.current = node;
            }}
            className="guide-channel-list scrollbar-none h-full overflow-auto overscroll-contain"
          >
          <div className="relative grid" style={{ width: CHANNEL_COLUMN_WIDTH + TIMELINE_WIDTH, gridTemplateColumns: guideTemplateColumns }}>
            <div
              className="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-accent shadow-[0_0_12px_rgba(77,166,255,0.7)]"
              style={{ left: CHANNEL_COLUMN_WIDTH + currentOffset }}
            />
            <div className="sticky left-0 top-0 z-30 flex h-14 items-center border-b border-r border-line bg-panel px-4">
              <div>
                <div className="text-sm font-bold">Channels</div>
                <div className="text-xs text-ink/50">Back 2h / forward 12h</div>
              </div>
            </div>
            <div className="sticky top-0 z-20 h-14 border-b border-line bg-panel">
              <div className="relative h-full" style={{ width: TIMELINE_WIDTH }}>
                <div className="pointer-events-none absolute top-1 z-50 -translate-x-1/2 rounded border border-accent/40 bg-panel px-1.5 py-0.5 text-xs font-bold leading-none text-accent shadow-soft" style={{ left: currentOffset }}>
                  Now
                </div>
                {timeMarkers.map((marker) => (
                  <div key={`${marker.label}-${marker.left}`} className="absolute inset-y-0 border-l border-line/70" style={{ left: marker.left }}>
                    <span className="absolute left-2 top-3 whitespace-nowrap text-xs font-semibold text-ink/65">{marker.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {loading && airing.length === 0 && !hasLoadedGuide && (
              <div className="col-span-2 p-4 text-sm text-ink/60">Loading guide...</div>
            )}
            {!loading && airing.length === 0 && (
              <div className="col-span-2 p-4 text-sm text-ink/60">No channels match this view.</div>
            )}
            {airing.map((item) => {
              const nowProgram = currentProgram(item);
              const programs = item.programs ?? [];
              return (
                <article id={`guide-channel-${item.channel_id}`} key={item.channel_id} className="contents">
                  <div className="sticky left-0 z-10 grid min-h-24 grid-cols-[4rem_minmax(0,1fr)_2.75rem] items-center gap-3 border-b border-r border-line bg-panel px-3">
                    <Link to={`/channel/${item.channel_id}`} onClick={() => rememberBeforeNavigate(item.channel_id)}>
                      <ChannelLogo src={item.logo_url} name={item.display_name} size="sm" />
                    </Link>
                    <Link to={`/channel/${item.channel_id}`} className="min-w-0" onClick={() => rememberBeforeNavigate(item.channel_id)}>
                      <div className="text-xs font-semibold uppercase text-ink/45">CH {item.channel_number ?? item.sort_order + 1}</div>
                      <div className="truncate text-sm font-bold">{item.display_name}</div>
                      <div className="truncate text-xs text-ink/55">{item.group_title}</div>
                    </Link>
                    <FavoriteButton active={Boolean(item.favorite)} onClick={() => toggleFavorite(item).catch(() => undefined)} />
                  </div>
                  <div className="relative min-h-24 border-b border-line bg-mist/35" style={{ width: TIMELINE_WIDTH }}>
                    {timeMarkers.map((marker) => (
                      <div key={`${item.channel_id}-${marker.left}`} className="pointer-events-none absolute inset-y-0 border-l border-line/45" style={{ left: marker.left }} />
                    ))}
                    {programs.length === 0 ? (
                      <Link
                        to={`/channel/${item.channel_id}`}
                        onClick={() => rememberBeforeNavigate(item.channel_id)}
                        className="absolute inset-x-2 top-2 flex h-20 items-center rounded-md border border-line/70 bg-panel/75 px-4 text-sm font-semibold text-ink/55"
                      >
                        No guide data
                      </Link>
                    ) : programs.map((program) => {
                      const layout = programLayout(program, guideStartRef.current, guideEndRef.current);
                      const active = nowProgram?.id === program.id;
                      return (
                        <Link
                          key={program.id}
                          to={`/channel/${item.channel_id}`}
                          onClick={() => rememberBeforeNavigate(item.channel_id)}
                          className={`absolute top-2 h-20 overflow-hidden rounded-md border px-3 py-2 transition hover:border-accent hover:bg-accent/15 ${active ? "border-accent bg-accent/20" : "border-line bg-panel/80"}`}
                          style={{ left: layout.left + 6, width: Math.max(0, layout.width - 8) }}
                          title={`${program.title} ${formatGuideTime(new Date(program.start_time))} - ${formatGuideTime(new Date(program.end_time))}`}
                        >
                          <div className="truncate text-sm font-bold">{program.title}</div>
                          <div className="mt-1 truncate text-xs text-ink/60">
                            {formatGuideTime(new Date(program.start_time))} - {formatGuideTime(new Date(program.end_time))}
                          </div>
                          {(program.subtitle || program.description) && (
                            <div className="mt-1 line-clamp-1 text-xs text-ink/50">{program.subtitle || program.description}</div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            <div ref={loadMoreRef} className="no-scroll-anchor col-span-2 h-8" />
            {loadingMore && <div className="no-scroll-anchor col-span-2 p-4 text-center text-sm text-ink/60">Loading more channels...</div>}
          </div>
        </div>
        )}
      </section>
    </div>
  );
}
