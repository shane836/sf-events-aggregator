import Link from "next/link";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import {
  formatLocalFullDate,
  formatLocalTime,
  localDateKey,
} from "@/lib/ui/dates";

/**
 * Day view: chronological agenda for a single date. Denser than the
 * mobile-agenda list (which spans many days) and intentionally not
 * card-decorated — the date IS the context.
 */
export function DayView({
  events,
  dateKey,
  currentSearch,
}: {
  events: ApiEvent[];
  dateKey: string;
  currentSearch: string;
}) {
  const tz = events[0]?.timezone ?? "America/Los_Angeles";
  // Filter to events whose local date matches `dateKey` (defense in depth —
  // the page should have already narrowed the range, but UTC overlap could
  // bleed in adjacent days).
  const dayEvents = events
    .filter((e) => localDateKey(e.startTimeUtc, e.timezone) === dateKey)
    .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));

  // Build a representative ISO at noon UTC for the date header label —
  // formatLocalFullDate only cares about the date in the given tz.
  const headerIso = `${dateKey}T12:00:00.000Z`;

  return (
    <section data-view="day" className="flex flex-col gap-4">
      <header
        data-day-header
        data-day-header-date={dateKey}
        className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400"
      >
        {formatLocalFullDate(headerIso, tz)}
      </header>
      {dayEvents.length === 0 ? (
        <p
          data-empty-state
          className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500"
        >
          No events for this day. Try widening filters or navigating with the
          arrow keys.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800/60 rounded-lg border border-zinc-800/80">
          {dayEvents.map((e) => {
            const style = CATEGORY_STYLES[e.category];
            const sp = new URLSearchParams(currentSearch);
            sp.set("event", e.id);
            return (
              <li key={e.id}>
                <Link
                  href={`/?${sp.toString()}`}
                  data-event-link={e.id}
                  data-event-card
                  data-category={e.category}
                  scroll={false}
                  aria-label={`${e.title} at ${e.venue.name}, ${formatLocalTime(e.startTimeUtc, e.timezone)}`}
                  className="grid grid-cols-[80px_1fr_auto] items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                >
                  <span className="font-mono text-xs text-zinc-400">
                    {formatLocalTime(e.startTimeUtc, e.timezone)}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
                      />
                      <span className="text-zinc-100">{e.title}</span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      {e.venue.name}
                      {e.venue.neighborhood
                        ? ` · ${e.venue.neighborhood}`
                        : ""}
                    </span>
                  </span>
                  <span
                    className="font-mono text-xs text-zinc-300"
                    data-price
                  >
                    {e.priceDisplay}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
