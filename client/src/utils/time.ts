export function formatTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function progress(start?: string, end?: string) {
  if (!start || !end) return 0;
  const total = new Date(end).getTime() - new Date(start).getTime();
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((Date.now() - new Date(start).getTime()) / total) * 100));
}
