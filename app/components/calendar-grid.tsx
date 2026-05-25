import Link from "next/link";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import {
  formatLocalTime,
  localDateKey,
  monthGridDays,
  monthLabel,
} from "@/lib/ui/dates";

/**
 * Desktop view: month grid with up to 3 event titles per cell + "+N more"
 * overflow. Color dot per event (CATEGORY_STYLES). Clicking a title opens
 * the modal via `?event=<id>`.
 *
 * `year`/`month` are derived from the first event in the list (or the
 * current month if none).
 */
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_PER_CELL = 3;

export function CalendarGrid({
  events,
  currentSearch,
  now = new Date(),
}: {
  events: ApiEvent[];
  currentSearch: string;
  now?: Date;
}) {
  // Anchor the displayed month: first event if available, else current.
  const anchor = events[0]
    ? new Date(events[0].startTimeUtc)
    : now;
  const tz = events[0]?.timezone ?? "America/Los_Angeles";

  // Determine local year/month for the anchor
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
  }).formatToParts(anchor);
  const year = Number(fmt.find((p) => p.type === "year")?.value ?? 2026);
  const monthOneIndexed = Number(
    fmt.find((p) => p.type === "month")?.value ?? 1,
  );
  const month = monthOneIndexed - 1;

  const cells = monthGridDays(year, month);
  const byDate = groupEventsByLocalDate(events);
  const today = localDateKey(now.toISOString(), tz);

  return (
    <div data-view="month-grid" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-zinc-400">
          {monthLabel(year, month)}
        </h2>
      </div>
      <div
        role="grid"
        aria-label={monthLabel(year, month)}
        className="overflow-hidden rounded-lg border border-zinc-800/80"
      >
        <div
          role="row"
          className="grid grid-cols-7 border-b border-zinc-800/80 bg-zinc-900/40"
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400"
            >
              {label}
            </div>
          ))}
        </div>
        {chunk(cells, 7).map((week, idx) => (
          <div key={idx} role="row" className="grid grid-cols-7">
            {week.map((dateKey) => {
              const inMonth = dateKey.startsWith(
                `${year}-${String(monthOneIndexed).padStart(2, "0")}`,
              );
              const dayEvents = byDate.get(dateKey) ?? [];
              const isToday = dateKey === today;
              return (
                <Cell
                  key={dateKey}
                  dateKey={dateKey}
                  inMonth={inMonth}
                  isToday={isToday}
                  events={dayEvents}
                  currentSearch={currentSearch}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({
  dateKey,
  inMonth,
  isToday,
  events,
  currentSearch,
}: {
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  events: ApiEvent[];
  currentSearch: string;
}) {
  const dayNum = Number(dateKey.split("-")[2]);
  const visible = events.slice(0, MAX_PER_CELL);
  const overflow = events.length - visible.length;

  return (
    <div
      role="gridcell"
      data-date={dateKey}
      className={`flex min-h-[110px] flex-col gap-1 border-b border-r border-zinc-800/60 p-1.5 ${
        inMonth ? "bg-zinc-950" : "bg-zinc-950/50 text-zinc-400"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-[11px] ${
            isToday
              ? "rounded bg-zinc-100 px-1 font-medium text-zinc-900"
              : inMonth
                ? "text-zinc-300"
                : "text-zinc-400"
          }`}
        >
          {dayNum}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {visible.map((e) => {
          const style = CATEGORY_STYLES[e.category];
          const sp = new URLSearchParams(currentSearch);
          sp.set("event", e.id);
          return (
            <li key={e.id}>
              <Link
                href={`/?${sp.toString()}`}
                data-event-link={e.id}
                data-category={e.category}
                scroll={false}
                aria-label={`${e.title} at ${e.venue.name}, ${formatLocalTime(e.startTimeUtc, e.timezone)}`}
                className="flex min-h-[20px] items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
                />
                <span className="truncate text-zinc-300">{e.title}</span>
                <span className="hidden font-mono text-[10px] text-zinc-400" data-price>
                  {e.priceDisplay}
                </span>
              </Link>
            </li>
          );
        })}
        {overflow > 0 ? (
          <li className="px-1 font-mono text-[10px] text-zinc-400">
            +{overflow} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function groupEventsByLocalDate(events: ApiEvent[]): Map<string, ApiEvent[]> {
  const map = new Map<string, ApiEvent[]>();
  for (const e of events) {
    const key = localDateKey(e.startTimeUtc, e.timezone);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  }
  return map;
}
