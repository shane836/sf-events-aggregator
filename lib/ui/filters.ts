import type { Category } from "@/lib/sources/types";

/**
 * Filter state derived from URL search params. The URL is the single source
 * of truth — filters survive refresh and are shareable (B6).
 */

export const VALID_CATEGORIES: ReadonlyArray<Category> = [
  "music",
  "comedy",
  "lectures",
  "dancing",
  "food",
];

export type DatePreset = "today" | "weekend" | "week" | "next-week" | "custom";

export const PRESET_LABELS: Record<Exclude<DatePreset, "custom">, string> = {
  today: "Today",
  weekend: "This Weekend",
  week: "This Week",
  "next-week": "Next Week",
};

export type FilterState = {
  categories: Category[];
  preset: DatePreset;
  /** ISO date YYYY-MM-DD (custom only). */
  from: string | null;
  to: string | null;
  neighborhood: string | null;
};

export function parseFilters(
  searchParams: Record<string, string | string[] | undefined>,
): FilterState {
  const categories = readMultiCategory(searchParams.category);
  const preset = readPreset(searchParams.preset);
  const from = readSingle(searchParams.from);
  const to = readSingle(searchParams.to);
  const neighborhood = readSingle(searchParams.neighborhood);

  return { categories, preset, from, to, neighborhood };
}

function readSingle(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function readMultiCategory(
  v: string | string[] | undefined,
): Category[] {
  const arr = Array.isArray(v) ? v : v != null ? v.split(",") : [];
  const set = new Set<Category>();
  for (const item of arr) {
    if (VALID_CATEGORIES.includes(item as Category)) {
      set.add(item as Category);
    }
  }
  return Array.from(set);
}

function readPreset(v: string | string[] | undefined): DatePreset {
  const s = readSingle(v);
  if (s === "today" || s === "weekend" || s === "week" || s === "next-week" || s === "custom") {
    return s;
  }
  return "week";
}

/**
 * Resolve a preset to (from, to) ISO datetimes in UTC. We anchor "today" in
 * Los Angeles time since every SF event is PT. Quasi-deterministic for
 * tests by accepting `now`.
 */
export function presetToRange(
  preset: DatePreset,
  now: Date,
  customFrom?: string | null,
  customTo?: string | null,
): { from: string; to: string } {
  if (preset === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }

  const tz = "America/Los_Angeles";
  const todayKey = formatLocalDateKey(now, tz);
  const todayWeekday = localWeekday(now, tz); // 0=Sun..6=Sat

  if (preset === "today") {
    return { from: toUtcDay(todayKey, false), to: toUtcDay(todayKey, true) };
  }
  if (preset === "weekend") {
    // Fri-Sun. If today is Sun, it's still "the weekend".
    let toFri = 5 - todayWeekday;
    if (todayWeekday === 0) toFri = -2; // already in weekend
    if (todayWeekday === 6) toFri = -1;
    const fri = addDaysToKey(todayKey, toFri);
    const sun = addDaysToKey(fri, 2);
    return { from: toUtcDay(fri, false), to: toUtcDay(sun, true) };
  }
  if (preset === "week") {
    // Today through end of Sunday (next Sun if today is Sun? -> 7 days fwd).
    const daysToSun = (7 - todayWeekday) % 7;
    const end = addDaysToKey(todayKey, daysToSun === 0 && todayWeekday !== 0 ? 0 : daysToSun);
    return { from: toUtcDay(todayKey, false), to: toUtcDay(end, true) };
  }
  if (preset === "next-week") {
    const daysToNextMon = ((1 - todayWeekday + 7) % 7) || 7;
    const mon = addDaysToKey(todayKey, daysToNextMon);
    const sun = addDaysToKey(mon, 6);
    return { from: toUtcDay(mon, false), to: toUtcDay(sun, true) };
  }
  // Fallback (custom without args)
  const end = addDaysToKey(todayKey, 30);
  return { from: toUtcDay(todayKey, false), to: toUtcDay(end, true) };
}

function formatLocalDateKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function localWeekday(d: Date, tz: string): number {
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wk] ?? 0;
}

function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Convert a local-date key (in PT) to a UTC ISO datetime at start (00:00 PT)
 * or end (23:59:59 PT). We over-approximate by a few hours rather than
 * fight DST math; the API does a `>=` and `<=` filter so a slightly wider
 * window is fine.
 */
function toUtcDay(key: string, endOfDay: boolean): string {
  // PT is UTC-7 in summer, UTC-8 in winter. Use UTC-8 to err wider.
  const [y, m, d] = key.split("-").map(Number);
  if (endOfDay) {
    // 23:59:59 PT ≈ 07:59:59 UTC next day
    const dt = new Date(Date.UTC(y, m - 1, d + 1, 7, 59, 59));
    return dt.toISOString();
  }
  // 00:00:00 PT ≈ 08:00:00 UTC same day
  const dt = new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
  return dt.toISOString();
}

/** Encode filter state back to a URLSearchParams instance. */
export function buildSearchString(state: FilterState): string {
  const sp = new URLSearchParams();
  for (const c of state.categories) sp.append("category", c);
  if (state.preset && state.preset !== "week") sp.set("preset", state.preset);
  if (state.preset === "custom") {
    if (state.from) sp.set("from", state.from);
    if (state.to) sp.set("to", state.to);
  }
  if (state.neighborhood) sp.set("neighborhood", state.neighborhood);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
