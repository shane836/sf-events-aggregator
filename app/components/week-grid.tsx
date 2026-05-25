import Link from "next/link";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import { formatLocalTime, localDateKey } from "@/lib/ui/dates";
import { addDaysIso } from "@/lib/ui/dates";

/**
 * Week view: 7 columns (Sun..Sat of the week containing `dateKey`), one row.
 * Each column is a vertical stack of events for that day. Like macOS
 * Calendar's week view — minus the time-of-day grid axis (which we omit
 * because most SF events are evening-only; a time axis would be 70% empty).
 *
 * `dateKey` anchors the week; the column dates are computed Sun..Sat
 * containing it. Events are pre-filtered by the page to fall within the
 * week's UTC range (viewToRange).
 */
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekGrid({
  events,
  dateKey,
  currentSearch,
  now = new Date(),
}: {
  events: ApiEvent[];
  dateKey: string;
  currentSearch: string;
  now?: Date;
}) {
  const tz = events[0]?.timezone ?? "America/Los_Angeles";
  const dow = weekdayOf(dateKey);
  const sunKey = addDaysIso(dateKey, -dow);
  const today = localDateKey(now.toISOString(), tz);
  const columns = Array.from({ length: 7 }, (_, i) => addDaysIso(sunKey, i));
  const byDate = groupByLocalDate(events);

  return (
    <div
      data-view="week"
      className="flex flex-col gap-3"
    >
      <div
        role="grid"
        aria-label="Week view"
        className="overflow-hidden rounded-lg border border-zinc-800/80"
      >
        <div
          role="row"
          className="grid grid-cols-7 border-b border-zinc-800/80 bg-zinc-900/40"
        >
          {columns.map((key, i) => {
            const dayNum = Number(key.split("-")[2]);
            const isToday = key === today;
            return (
              <div
                key={key}
                role="columnheader"
                data-week-col-date={key}
                className="flex items-baseline justify-between px-2 py-2"
              >
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                  {WEEKDAY_LABELS[i]}
                </span>
                <span
                  className={`font-mono text-xs ${
                    isToday
                      ? "rounded bg-zinc-100 px-1 font-medium text-zinc-900"
                      : "text-zinc-300"
                  }`}
                >
                  {dayNum}
                </span>
              </div>
            );
          })}
        </div>
        <div role="row" className="grid grid-cols-7">
          {columns.map((key) => {
            const dayEvents = byDate.get(key) ?? [];
            return (
              <div
                key={key}
                role="gridcell"
                data-date={key}
                className="flex min-h-[420px] flex-col gap-1 border-r border-zinc-800/60 p-2 last:border-r-0"
              >
                {dayEvents.length === 0 ? (
                  <span
                    data-empty-state
                    className="mt-2 text-center font-mono text-[10px] text-zinc-600"
                  >
                    —
                  </span>
                ) : (
                  dayEvents.map((e) => {
                    const style = CATEGORY_STYLES[e.category];
                    const sp = new URLSearchParams(currentSearch);
                    sp.set("event", e.id);
                    return (
                      <Link
                        key={e.id}
                        href={`/?${sp.toString()}`}
                        data-event-link={e.id}
                        data-event-card
                        data-category={e.category}
                        scroll={false}
                        aria-label={`${e.title} at ${e.venue.name}, ${formatLocalTime(e.startTimeUtc, e.timezone)}`}
                        className="flex flex-col gap-0.5 rounded border border-zinc-800/60 bg-zinc-900/40 px-2 py-1.5 text-xs hover:border-zinc-600 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                      >
                        <span className="flex items-center gap-1">
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
                          />
                          <span className="font-mono text-[10px] text-zinc-400">
                            {formatLocalTime(e.startTimeUtc, e.timezone)}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-zinc-200">
                          {e.title}
                        </span>
                        <span
                          className="font-mono text-[10px] text-zinc-500"
                          data-price
                        >
                          {e.priceDisplay}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function groupByLocalDate(events: ApiEvent[]): Map<string, ApiEvent[]> {
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
