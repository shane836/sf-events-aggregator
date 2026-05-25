import Link from "next/link";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import { formatLocalTime, formatLocalDateTime } from "@/lib/ui/dates";
import { CategoryChip } from "./category-chip";

/**
 * Agenda event card. Server component. Contains:
 *   - an overlay `<Link>` (z-0) that opens the modal on click anywhere in
 *     the card except interactive children
 *   - a "View source ↗" external `<a target="_blank">` (z-20) that takes
 *     priority over the overlay because of stacking
 *
 * The wrapping `<article>` carries `data-event-card` so E1/E3 selectors
 * find it; price renders inside via `data-price`.
 */
export function EventCard({
  event,
  currentSearch,
}: {
  event: ApiEvent;
  currentSearch: string;
}) {
  const style = CATEGORY_STYLES[event.category];
  const time = formatLocalTime(event.startTimeUtc, event.timezone);
  const sp = new URLSearchParams(currentSearch);
  sp.set("event", event.id);
  const detailHref = `/?${sp.toString()}`;

  return (
    <article
      data-event-card={event.id}
      data-category={event.category}
      className="group relative flex min-h-[88px] items-start gap-3 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-3 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-within:border-zinc-600"
    >
      <Link
        href={detailHref}
        scroll={false}
        aria-label={`${event.title} at ${event.venue.name}, ${formatLocalDateTime(event.startTimeUtc, event.timezone)}`}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        <span className="sr-only">Open event details</span>
      </Link>
      <span
        aria-hidden="true"
        className={`pointer-events-none mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
      />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-zinc-100">
            {event.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span className="font-mono tabular-nums text-zinc-300">{time}</span>
          <span className="truncate">{event.venue.name}</span>
          {event.venue.neighborhood ? (
            <span className="text-zinc-400">{event.venue.neighborhood}</span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <CategoryChip category={event.category} size="sm" />
          <span
            data-price
            className="font-mono text-[11px] text-zinc-400"
          >
            {event.priceDisplay}
          </span>
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-source-link
            className="pointer-events-auto relative z-20 ml-auto inline-flex min-h-[44px] items-center gap-1 rounded px-2 font-mono text-[11px] text-zinc-300 underline-offset-4 hover:text-zinc-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            aria-label={`View source for ${event.title} (opens in new tab)`}
          >
            View source <span aria-hidden>↗</span>
          </a>
        </div>
      </div>
    </article>
  );
}
