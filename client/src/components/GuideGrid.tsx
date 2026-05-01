import type { Ref } from "react";
import { type Airing, type Program } from "../api/client";
import { formatTime, progress } from "../utils/time";
import { ChannelLogo } from "./ChannelLogo";
import { FavoriteButton } from "./FavoriteButton";

export const GUIDE_HOURS = 12;
const SLOT_MINUTES = 30;
const SLOT_WIDTH = 150;
const TIMELINE_WIDTH = (GUIDE_HOURS * 60 / SLOT_MINUTES) * SLOT_WIDTH;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function floorGuideStart(value: string) {
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

export type PlaybackSelection = {
  item: Airing;
  program: Program | null;
};

export function GuideGrid({
  airing,
  guideAt,
  loading,
  loadingMore,
  loadMoreRef,
  selectedChannelId,
  selectedProgramId,
  onSelect,
  onToggleFavorite
}: {
  airing: Airing[];
  guideAt: string;
  loading: boolean;
  loadingMore: boolean;
  loadMoreRef: Ref<HTMLDivElement>;
  selectedChannelId?: number;
  selectedProgramId?: number | null;
  onSelect: (selection: PlaybackSelection) => void;
  onToggleFavorite: (item: Airing) => void;
}) {
  const guideStart = floorGuideStart(guideAt);
  const guideStartMs = guideStart.getTime();
  const timeline = Array.from({ length: GUIDE_HOURS * 2 + 1 }, (_, index) => ({
    time: formatTime(addMinutes(guideStart, index * SLOT_MINUTES).toISOString()),
    offset: index * SLOT_WIDTH
  }));

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-line bg-panel shadow-soft">
      <div className="hidden overflow-x-auto md:block">
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
              <button
                className={`sticky left-0 z-10 grid place-items-center border-r border-line bg-panel px-2 py-2 ${selectedChannelId === item.channel_id ? "ring-1 ring-inset ring-accent" : ""}`}
                title={item.display_name}
                onClick={() => onSelect({ item, program: item.programs?.[0] ?? null })}
              >
                <div className="grid justify-items-center gap-1">
                  <ChannelLogo src={item.logo_url} name={item.display_name} size="sm" />
                  <span className="text-[0.68rem] font-bold tabular-nums text-ink/55">{item.channel_number ?? item.sort_order + 1}</span>
                </div>
              </button>
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
                  const isSelected = selectedChannelId === item.channel_id && selectedProgramId === program.id;
                  return (
                    <button
                      key={program.id}
                      className={`group/program absolute top-1 min-w-0 overflow-hidden rounded-[3px] border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-accent bg-accent text-white shadow-sm"
                          : isCurrent
                            ? "border-accent bg-panel text-ink shadow-sm hover:border-accent"
                            : "border-line bg-panel/85 text-ink hover:border-accent hover:bg-panel"
                      }`}
                      style={{ left: `${style.left}px`, width: `${style.width - 4}px`, height: "68px" }}
                      title={`${program.title} ${timeRange(program.start_time, program.end_time)}`}
                      onClick={() => onSelect({ item, program })}
                    >
                      {isCurrent && !isSelected && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-ink/10">
                          <div className="h-full bg-accent" style={{ width: `${progress(program.start_time, program.end_time)}%` }} />
                        </div>
                      )}
                      <div className={`truncate text-xs font-semibold ${isSelected ? "text-white/70" : "text-ink/45"}`}>{timeRange(program.start_time, program.end_time)}</div>
                      <div className="mt-1 truncate font-semibold">{program.title}</div>
                      <div className={`mt-1 truncate text-xs ${isSelected ? "text-white/70" : "text-ink/55"}`}>{program.category || program.subtitle || item.group_title}</div>
                    </button>
                  );
                })}
                {(item.programs ?? []).length === 0 && (
                  <button
                    className="absolute top-1 rounded-[3px] border border-line bg-panel/70 px-3 py-2 text-left text-sm text-ink/50"
                    style={{ left: 0, width: `${Math.min(420, TIMELINE_WIDTH - 4)}px`, height: "68px" }}
                    onClick={() => onSelect({ item, program: null })}
                  >
                    No guide data for this window
                  </button>
                )}
                <div className="sticky right-1 ml-auto grid h-[68px] w-11 place-items-center">
                  <FavoriteButton active={Boolean(item.favorite)} onClick={() => onToggleFavorite(item)} />
                </div>
              </div>
            </article>
          ))}
          {loadingMore && <div className="p-4 text-center text-sm text-ink/60">Loading more channels...</div>}
        </div>
      </div>

      <div className="grid gap-2 p-3 md:hidden">
        {loading && airing.length === 0 && <div className="text-sm text-ink/60">Loading guide...</div>}
        {!loading && airing.length === 0 && <div className="text-sm text-ink/60">No channels match this view.</div>}
        {airing.map((item) => {
          const current = item.programs?.find((program) => new Date(program.start_time) <= new Date() && new Date(program.end_time) > new Date()) ?? item.programs?.[0] ?? null;
          return (
            <article key={item.channel_id} className={`rounded-md border bg-mist/60 p-3 ${selectedChannelId === item.channel_id ? "border-accent" : "border-line"}`}>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                <button onClick={() => onSelect({ item, program: current })}>
                  <ChannelLogo src={item.logo_url} name={item.display_name} size="sm" />
                </button>
                <button className="min-w-0 text-left" onClick={() => onSelect({ item, program: current })}>
                  <div className="truncate text-sm font-bold">{item.channel_number ?? item.sort_order + 1} · {item.display_name}</div>
                  <div className="truncate text-sm text-ink/60">{current?.title ?? "No guide data"}</div>
                </button>
                <FavoriteButton active={Boolean(item.favorite)} onClick={() => onToggleFavorite(item)} />
              </div>
              <div className="mt-3 grid gap-2">
                {(item.programs ?? []).slice(0, 3).map((program) => (
                  <button
                    key={program.id}
                    className={`rounded-md border px-3 py-2 text-left ${selectedProgramId === program.id ? "border-accent bg-accent text-white" : "border-line bg-panel"}`}
                    onClick={() => onSelect({ item, program })}
                  >
                    <div className="truncate text-sm font-semibold">{program.title}</div>
                    <div className={`text-xs ${selectedProgramId === program.id ? "text-white/70" : "text-ink/55"}`}>{timeRange(program.start_time, program.end_time)}</div>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
        {loadingMore && <div className="p-4 text-center text-sm text-ink/60">Loading more channels...</div>}
      </div>
      <div ref={loadMoreRef} className="h-8" />
    </section>
  );
}
