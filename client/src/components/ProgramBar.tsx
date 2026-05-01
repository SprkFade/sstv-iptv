import { formatTime, progress } from "../utils/time";

export function ProgramBar({ start, end }: { start?: string | null; end?: string | null }) {
  if (!start || !end) return null;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{formatTime(start)}</span>
        <span>{formatTime(end)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress(start, end)}%` }} />
      </div>
    </div>
  );
}
