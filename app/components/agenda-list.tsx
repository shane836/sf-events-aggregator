import type { ApiEvent } from "@/lib/api/events";
import { formatLocalDayLabel, localDateKey } from "@/lib/ui/dates";
import { EventCard } from "./event-card";

/**
 * Mobile (and < md) view: events grouped by local date, chronological. Each
 * date heading shows day-of-week + month-day.
 */
export function AgendaList({
  events,
  currentSearch,
}: {
  events: ApiEvent[];
  currentSearch: string;
}) {
  if (events.length === 0) {
    return null; // EmptyState is rendered by the page when there are no events at all
  }

  const groups = groupByLocalDate(events);

  return (
    <div data-view="agenda" className="flex flex-col gap-6">
      {groups.map(({ dateKey, label, items }) => (
        <section key={dateKey} aria-label={label}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
            {label}
          </h2>
          <ul className="flex flex-col gap-2">
            {items.map((event) => (
              <li key={event.id}>
                <EventCard event={event} currentSearch={currentSearch} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByLocalDate(events: ApiEvent[]): Array<{
  dateKey: string;
  label: string;
  items: ApiEvent[];
}> {
  const map = new Map<string, { label: string; items: ApiEvent[] }>();
  for (const e of events) {
    const key = localDateKey(e.startTimeUtc, e.timezone);
    if (!map.has(key)) {
      map.set(key, {
        label: formatLocalDayLabel(e.startTimeUtc, e.timezone),
        items: [],
      });
    }
    map.get(key)!.items.push(e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dateKey, { label, items }]) => ({
      dateKey,
      label,
      items: items.sort((a, b) =>
        a.startTimeUtc.localeCompare(b.startTimeUtc),
      ),
    }));
}
