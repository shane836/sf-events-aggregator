# Open Items

Living punch list. Top section is active (M5). Bottom is deferred (M1/M3 cleanup — data is sufficient for now).

---

## M5 — UX overhaul & polish (ACTIVE)

Reference aesthetic: https://sf.funcheap.com/. Current app is not readable; M5 is about readability + real calendar-app behavior, not micro-polish.

### A. Funcheap-style "Upcoming Fun & Cheap Events" feed
- New chronological feed section, separate from the calendar view, modeled on funcheap.com's "Upcoming Fun and Cheap Events" list
- Dense, scannable layout: one row per event (date stamp · title · venue · price · category)
- Lives on the home page above or alongside the calendar (decide during /design-shotgun)
- Driven by the same `/api/events` endpoint with a chronological sort + lookahead window (default: next 14 days)

### B. Real day / week / month view modes (not just filters)
Current behavior: day/week/weekend are date-range *filters* that leave the month grid intact. Target behavior matches macOS Calendar / Google Calendar — the view mode actually changes the grid.

- **Month view** (current default): 7×5 month grid, keep
- **Week view**: 7-column × 1-row grid — one column per day of the current week, events stacked inside each column
- **Day view**: single-column agenda for one day, denser than the current mobile agenda
- View mode is a separate axis from category filters
- URL state: `?view=month|week|day&date=YYYY-MM-DD`
- Prev / next / today navigation that respects the active view
- Keyboard: arrow keys advance by one unit of the active view

### C. Readability + aesthetic pass
- Establish a design system before coding (run `/design-consultation` → `DESIGN.md`)
- Then `/design-shotgun` for variant exploration against funcheap reference
- Typography hierarchy that survives event-dense days
- Color: category chips need to be distinguishable at a glance without dominating
- Spacing, contrast, line-height — current build fails the "can I scan 30 events in 5 seconds" test
- Mobile: agenda list survives, but visual language matches the new system

### D. Ship gate prep
- Write `rubrics/milestone-m5-polish.md` BEFORE any code (PGE discipline)
- Include rubric dims for: readability (deterministic — contrast ratios, font-size minimums), Core Web Vitals on production, view-mode correctness (Playwright), feed completeness
- Run `/plan-design-review` on the rubric before generating

### E. Other M5 follow-ups
- Custom domain (currently `-two.vercel.app`)
- SEO (meta tags, OG images, sitemap)
- `/canary` post-deploy monitoring config
- `/devex-review` pass on the public surface
- Empty-state polish (no events for a day in week view)

---

## Deferred — M1 ingestion gaps

Memory said M1 was "shipped," repo state says 6 of the planned adapters were never built. Data is sufficient for now; pick these up after M5.

- `seatgeek` adapter — blocked on `SEATGEEK_API_KEY` from Shane
- `ical:sfsymphony` — find iCal feed on sfsymphony.org
- `ical:sfjazz` — find iCal feed on sfjazz.org
- `ical:usf` — Localist platform, try `myusf.usfca.edu/calendar/1.ics`
- `ical:sfsu` — Localist, try `events.sfsu.edu/calendar/1.ics`
- `ical:cca` — cca.edu/events
- Add each to `.github/workflows/ingest.yml` matrix (auto-discovers if matrix reads `lib/sources/`)

## Deferred — M3 scrapers ship-gate

M3 rubric requires 18/21 scrapers. We have 19 in main, but the milestone was never formally evaluated and closed.

- `scrape:cinderellaballroom` — branch `feat/source-cinderellaballroom` documents NOT FEASIBLE; formally mark `HUMAN-REVIEW-NEEDED` per protocol and close the branch
- `scrape:eatersf` — never attempted; decide skip vs build, document in M3 status
- Run the M3 ship-gate evaluation deterministically (D1-D6, B1/B2/B5/B7, E1, F2-F4) and write a PASS/FAIL report in the rubric file
- Close out M3 in `SESSION-SUMMARY.md`

## Deferred — Housekeeping

- Prune local branches already merged on origin: `feat/source-{cinderellaballroom,odc,offthegrid,punchline,ticketmaster}`, `fix/retarget-sparksocial`, `chore/m1-ingest-cron`
- Rewrite `SESSION-SUMMARY.md` to reflect actual state (currently claims M1 is "shipped" — it's partial)
- Update auto-memory `project_sf_events_aggregator.md` once M5 ships
