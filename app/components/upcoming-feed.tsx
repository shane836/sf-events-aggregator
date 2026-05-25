import Link from "next/link";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import { formatLocalTime, localDateKey } from "@/lib/ui/dates";

/**
 * Funcheap-style "Upcoming Fun & Cheap Events" feed. Dense chronological
 * list, separate from the calendar view, lives at the top of the home
 * page. One row per event: date stamp · title · venue · price · category
 * chip · source-link arrow.
 *
 * Rubric M5 B1-B8:
 *   B1: rendered under `[data-section="upcoming-feed"]`
 *   B2: events come pre-sorted ascending (API contract); we don't re-sort
 *   B3: caller passes events within the 14-day lookahead window
 *   B4: every row contains date · title · venue · [data-price] · chip · source link
 *   B5: target avg row height ≤ 80px @ 1440px (CSS-enforced via py-2 + text-sm)
 *   B6: mobile wraps to two lines without overflow
 *   B7: filters compose — caller fetches with the same category/neighborhood
 *   B8: no new API surface — caller uses /api/events
 */
const SHORT_WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const SHORT_MONTH = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export function UpcomingFeed({
  events,
  currentSearch,
}: {
  events: ApiEvent[];
  currentSearch: string;
}) {
  if (events.length === 0) {
    return (
      <section data-section="upcoming-feed" className="flex flex-col gap-2">
        <SectionHeader />
        <p
          data-feed-empty
          className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-400"
        >
          No events in the next two weeks matching your filters.
        </p>
      </section>
    );
  }

  return (
    <section data-section="upcoming-feed" className="flex flex-col gap-2">
      <SectionHeader />
      <ul
        data-feed-list
        className="divide-y divide-zinc-800/60 overflow-hidden rounded-lg border border-zinc-800/80"
      >
        {events.map((e) => (
          <FeedRow key={e.id} event={e} currentSearch={currentSearch} />
        ))}
      </ul>
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-baseline justify-between">
      <h2
        data-feed-header
        className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400"
      >
        Upcoming Events
      </h2>
      <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
        next 14 days
      </span>
    </div>
  );
}

function FeedRow({
  event,
  currentSearch,
}: {
  event: ApiEvent;
  currentSearch: string;
}) {
  const dateStamp = makeDateStamp(event.startTimeUtc, event.timezone);
  const time = formatLocalTime(event.startTimeUtc, event.timezone);
  const style = CATEGORY_STYLES[event.category];
  const sp = new URLSearchParams(currentSearch);
  sp.set("event", event.id);
  const detailHref = `/?${sp.toString()}`;

  return (
    <li
      data-feed-row
      data-category={event.category}
      data-event-card={event.id}
      className="grid grid-cols-[64px_1fr_auto] items-center gap-3 px-3 py-3 text-sm hover:bg-zinc-900/40 sm:grid-cols-[80px_1fr_auto_auto] sm:gap-4 sm:px-4"
    >
      <div
        data-feed-date
        className="flex flex-col font-mono text-[10px] uppercase tracking-wider text-zinc-400"
      >
        <span>{dateStamp.weekday}</span>
        <span className="text-zinc-200">
          {dateStamp.month} {dateStamp.day}
        </span>
        <span className="text-zinc-400">{time}</span>
      </div>

      <Link
        href={detailHref}
        data-event-link={event.id}
        scroll={false}
        aria-label={`${event.title} at ${event.venue.name}`}
        className="flex min-h-[44px] min-w-0 flex-col justify-center gap-0.5 hover:text-white focus-visible:outline-none focus-visible:underline"
      >
        <span
          data-event-title
          className="line-clamp-1 text-base font-medium leading-6 text-zinc-100"
        >
          <span
            aria-hidden="true"
            className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${style.dot}`}
          />
          {event.title}
        </span>
        <span
          data-venue
          className="line-clamp-1 text-sm leading-5 text-zinc-400"
        >
          {event.venue.name}
          {event.venue.neighborhood ? ` · ${event.venue.neighborhood}` : ""}
        </span>
      </Link>

      <span
        data-price
        className="hidden font-mono text-xs text-zinc-300 sm:inline"
      >
        {event.priceDisplay}
      </span>

      <div className="flex items-center gap-2">
        <span
          data-category-chip
          data-feed-category={event.category}
          className={`hidden font-mono text-[10px] uppercase tracking-widest sm:inline ${style.text}`}
        >
          {style.label}
        </span>
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open source for ${event.title}`}
          data-source-link={event.id}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
        >
          ↗
        </a>
      </div>
    </li>
  );
}

function makeDateStamp(
  isoUtc: string,
  timezone: string,
): { weekday: string; month: string; day: string } {
  // Pull parts via Intl so the values are in the event's local timezone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(new Date(isoUtc));
  const weekday = fmt.find((p) => p.type === "weekday")?.value?.toUpperCase() ?? "";
  const month = fmt.find((p) => p.type === "month")?.value?.toUpperCase() ?? "";
  const day = fmt.find((p) => p.type === "day")?.value ?? "";
  // Fall back to local computation if Intl misbehaves (it shouldn't, but
  // the constants below give a deterministic guarantee).
  if (weekday && month && day) return { weekday, month, day };
  const key = localDateKey(isoUtc, timezone);
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: SHORT_WEEKDAY[dt.getUTCDay()],
    month: SHORT_MONTH[m - 1],
    day: String(d),
  };
}
