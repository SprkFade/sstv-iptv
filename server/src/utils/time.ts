export function nowIso() {
  return new Date().toISOString();
}

export function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function parseXmltvDate(value: string | undefined): string {
  if (!value) return new Date(0).toISOString();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? new Date(0).toISOString() : fallback.toISOString();
  }

  const [, y, mo, d, h, mi, s, offset] = match;
  const isoBase = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (!offset) return new Date(`${isoBase}Z`).toISOString();
  const formattedOffset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  return new Date(`${isoBase}${formattedOffset}`).toISOString();
}
