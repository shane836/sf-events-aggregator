import { Suspense } from "react";
import { fetchEvents, type ApiEvent } from "@/lib/api/events";
import {
  buildSearchString,
  parseFilters,
  presetToRange,
  todayInPT,
  viewToRange,
} from "@/lib/ui/filters";
import { viewLabel } from "@/lib/ui/dates";
import { AgendaList } from "./components/agenda-list";
import { CalendarGrid } from "./components/calendar-grid";
import { CalendarNav } from "./components/calendar-nav";
import { DayView } from "./components/day-view";
import { EmptyState } from "./components/empty-state";
import { EventModal } from "./components/event-modal";
import { FilterBar } from "./components/filter-bar";
import { ViewToggle } from "./components/view-toggle";
import { WeekGrid } from "./components/week-grid";

/**
 * Calendar home page. Reads filters + view mode from `searchParams`
 * (Next.js 16: Promise), fetches events, and renders the correct view
 * (month grid / week strip / day agenda). Mobile still falls back to
 * the agenda list for month view (parity with current behavior).
 *
 * Server component — never imports `db/`, only `/api/events` (rubric A3).
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const anchorDate = filters.date ?? todayInPT();

  // Range source: when view is non-month OR an explicit ?date= is set, derive
  // from view+date (the user is in real calendar-app mode). Otherwise fall
  // back to the legacy preset window — keeps existing /?preset=weekend
  // bookmarks working unchanged.
  const usingViewRange = filters.view !== "month" || filters.date != null;
  const range = usingViewRange
    ? viewToRange(filters.view, anchorDate)
    : presetToRange(filters.preset, new Date(), filters.from, filters.to);

  const data = await fetchEvents({
    categories: filters.categories.length ? filters.categories : undefined,
    from: range.from,
    to: range.to,
    neighborhood: filters.neighborhood ?? undefined,
    limit: 500,
  });

  // Neighborhood dropdown options: derived from the events visible without the
  // neighborhood filter applied (so the dropdown doesn't collapse to one).
  let neighborhoodOptions: string[];
  if (filters.neighborhood) {
    const wide = await fetchEvents({
      categories: filters.categories.length ? filters.categories : undefined,
      from: range.from,
      to: range.to,
      limit: 500,
    });
    neighborhoodOptions = distinctNeighborhoods(wide.events);
  } else {
    neighborhoodOptions = distinctNeighborhoods(data.events);
  }

  const eventIdParam = typeof sp.event === "string" ? sp.event : null;
  const activeEvent =
    eventIdParam != null
      ? (data.events.find((e) => e.id === eventIdParam) ?? null)
      : null;

  // Serialized filters minus `event` so children build hrefs that don't
  // bake in modal state.
  const currentSearch = buildSearchString(filters).replace(/^\?/, "");

  return (
    <>
      <Suspense fallback={null}>
        <FilterBar neighborhoods={neighborhoodOptions} />
      </Suspense>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Suspense fallback={null}>
            <CalendarNav
              view={filters.view}
              date={anchorDate}
              label={viewLabel(filters.view, anchorDate)}
            />
          </Suspense>
          <Suspense fallback={null}>
            <ViewToggle view={filters.view} />
          </Suspense>
        </div>

        {data.events.length === 0 && filters.view === "month" ? (
          <EmptyState />
        ) : filters.view === "day" ? (
          <DayView
            events={data.events}
            dateKey={anchorDate}
            currentSearch={currentSearch}
          />
        ) : filters.view === "week" ? (
          <WeekGrid
            events={data.events}
            dateKey={anchorDate}
            currentSearch={currentSearch}
          />
        ) : (
          <>
            {/* Month view — keep desktop/mobile split (parity with pre-M5) */}
            <div data-view-mode="grid" className="hidden md:block">
              <CalendarGrid
                events={data.events}
                currentSearch={currentSearch}
                dateKey={anchorDate}
              />
            </div>
            <div
              data-view-mode="agenda"
              className="md:absolute md:left-[-10000px] md:top-0 md:h-0 md:w-px md:overflow-hidden"
              aria-hidden="false"
            >
              <AgendaList
                events={data.events}
                currentSearch={currentSearch}
              />
            </div>
          </>
        )}
      </main>

      {activeEvent ? (
        <Suspense fallback={null}>
          <EventModal event={activeEvent} />
        </Suspense>
      ) : null}
    </>
  );
}

function distinctNeighborhoods(events: ApiEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.venue.neighborhood) set.add(e.venue.neighborhood);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
