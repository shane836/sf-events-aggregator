/**
 * Local-time formatters keyed by per-event IANA `timezone`.
 *
 * Why per-event: an event at SFJAZZ and an event at a venue elsewhere could
 * (in theory) have different timezones; the schema makes timezone required
 * specifically so we never slice ISO strings for date. See docs/IDENTITY.md.
 *
 * All functions are pure and safe for both server and client components.
 */

/** YYYY-MM-DD in the event's local timezone. Stable key for calendar grouping. */
export function localDateKey(isoUtc: string, timezone: string): string {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** Hour:Minute in local TZ, e.g. "7:30 PM". */
export function formatLocalTime(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoUtc));
}

/** Day-of-week + month-day, e.g. "Fri, Jun 5". */
export function formatLocalDayLabel(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(isoUtc));
}

/** Full date label for modal headers, e.g. "Friday, June 5, 2026". */
export function formatLocalFullDate(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoUtc));
}

/** Combined time + date for accessible aria-labels. */
export function formatLocalDateTime(isoUtc: string, timezone: string): string {
  return `${formatLocalFullDate(isoUtc, timezone)} at ${formatLocalTime(isoUtc, timezone)}`;
}

// --- Calendar grid helpers (operate on YYYY-MM-DD keys, no Date math) ---

/** Build the grid of date keys (YYYY-MM-DD) for a month, padded to full weeks. */
export function monthGridDays(
  year: number,
  month: number /* 0-indexed */,
): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const startWeekday = first.getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: string[] = [];

  // Leading days from previous month
  for (let i = startWeekday; i > 0; i--) {
    const d = new Date(Date.UTC(year, month, 1 - i));
    cells.push(toIsoDate(d));
  }
  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push(toIsoDate(new Date(Date.UTC(year, month, i))));
  }
  // Trailing days to complete the last week
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const next = addDaysIso(last, 1);
    cells.push(next);
  }
  return cells;
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysIso(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toIsoDate(dt);
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}

/**
 * Human label for a date+view ("May 2026", "Week of May 25", "Friday, May 30").
 * Used by the calendar-nav header so prev/next clicks always show what period
 * is active. Computed from the date key directly (no timezone math — the date
 * key IS the local date).
 */
export function viewLabel(view: "day" | "week" | "month", dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (view === "month") {
    return monthLabel(y, m - 1);
  }
  if (view === "day") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  // week
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const sun = new Date(Date.UTC(y, m - 1, d - dow));
  return `Week of ${new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(sun)}`;
}
