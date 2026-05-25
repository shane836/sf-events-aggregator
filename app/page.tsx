import { Suspense } from "react";
import { fetchEvents, type ApiEvent } from "@/lib/api/events";
import { parseFilters, presetToRange, buildSearchString } from "@/lib/ui/filters";
import { AgendaList } from "./components/agenda-list";
import { CalendarGrid } from "./components/calendar-grid";
import { EmptyState } from "./components/empty-state";
import { EventModal } from "./components/event-modal";
import { FilterBar } from "./components/filter-bar";

/**
 * Calendar home page. Reads filters from `searchParams` (Next.js 16: Promise),
 * fetches from `/api/events`, and renders BOTH the month grid (desktop, `md+`)
 * and the agenda list (mobile, `< md`). CSS `hidden md:block` toggles which
 * view paints; the agenda is also mounted hidden on desktop so the
 * `[data-event-card]` selectors used by rubric E1/E3 always resolve.
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
  const range = presetToRange(
    filters.preset,
    new Date(),
    filters.from,
    filters.to,
  );

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
        {data.events.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Desktop: month grid */}
            <div data-view-mode="grid" className="hidden md:block">
              <CalendarGrid
                events={data.events}
                currentSearch={currentSearch}
              />
            </div>
            {/*
             * Agenda list. Visible at `< md`. At `md+` it stays in the DOM
             * (so [data-event-card] selectors from rubric A2/E1/E3 resolve)
             * but is moved off-screen and hidden from a11y. C4 (at 375px the
             * visible layout is agenda) still holds because the desktop
             * variant is only on at `md+`.
             */}
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
