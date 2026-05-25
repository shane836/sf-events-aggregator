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

export type ViewMode = "month" | "week" | "day";
export const VALID_VIEW_MODES: ReadonlyArray<ViewMode> = ["month", "week", "day"];

export type FilterState = {
  categories: Category[];
  preset: DatePreset;
  /** ISO date YYYY-MM-DD (custom only). */
  from: string | null;
  to: string | null;
  neighborhood: string | null;
  /**
   * Calendar view mode. Separate axis from `preset`: when `view` is set the
   * calendar layout switches (month grid / week strip / day agenda) and the
   * date range is derived from `view` + `date` instead of `preset`.
   */
  view: ViewMode;
  /** YYYY-MM-DD anchor date for the view. Defaults to today in PT. */
  date: string | null;
};

export function parseFilters(
  searchParams: Record<string, string | string[] | undefined>,
): FilterState {
  const categories = readMultiCategory(searchParams.category);
  const preset = readPreset(searchParams.preset);
  const from = readSingle(searchParams.from);
  const to = readSingle(searchParams.to);
  const neighborhood = readSingle(searchParams.neighborhood);
  const view = readView(searchParams.view);
  const date = readDateKey(searchParams.date);

  return { categories, preset, from, to, neighborhood, view, date };
}

function readView(v: string | string[] | undefined): ViewMode {
  const s = readSingle(v);
  if (s === "month" || s === "week" || s === "day") return s;
  return "month";
}

function readDateKey(v: string | string[] | undefined): string | null {
  const s = readSingle(v);
  if (s == null) return null;
  // Strict YYYY-MM-DD validation — anything malformed falls back to today.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
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
  if (state.view !== "month") sp.set("view", state.view);
  if (state.date) sp.set("date", state.date);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * Resolve a view + anchor date to (from, to) UTC ISO datetimes. The page uses
 * this when `view` is set (i.e., the user opted into a real calendar-app view)
 * instead of falling back to `presetToRange`.
 *
 * - month: first day of `date`'s month → last day, inclusive
 * - week:  Sunday containing `date` → following Saturday, inclusive
 * - day:   that single date
 */
export function viewToRange(
  view: ViewMode,
  dateKey: string,
): { from: string; to: string } {
  if (view === "day") {
    return { from: toUtcDay(dateKey, false), to: toUtcDay(dateKey, true) };
  }
  if (view === "week") {
    const dow = weekdayOfKey(dateKey); // 0=Sun..6=Sat
    const sun = addDaysToKey(dateKey, -dow);
    const sat = addDaysToKey(sun, 6);
    return { from: toUtcDay(sun, false), to: toUtcDay(sat, true) };
  }
  // month
  const [y, m] = dateKey.split("-").map(Number);
  const firstKey = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastKey = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  return { from: toUtcDay(firstKey, false), to: toUtcDay(lastKey, true) };
}

/** Returns today's YYYY-MM-DD in Pacific time. */
export function todayInPT(now: Date = new Date()): string {
  return formatLocalDateKey(now, "America/Los_Angeles");
}

function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Advance a date by one unit of the active view. `direction` is +1 (next)
 * or -1 (prev). Used by the calendar prev/next nav and keyboard arrows.
 *
 * - day:   ±1 day
 * - week:  ±7 days
 * - month: ±1 calendar month (clamps to last day if target month is shorter)
 */
export function advanceDate(
  view: ViewMode,
  dateKey: string,
  direction: 1 | -1,
): string {
  if (view === "day") return addDaysToKey(dateKey, direction);
  if (view === "week") return addDaysToKey(dateKey, 7 * direction);
  // month
  const [y, m, d] = dateKey.split("-").map(Number);
  const targetMonthIndex = m - 1 + direction; // 0-indexed
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTarget);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
