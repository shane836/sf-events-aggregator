# Milestone M5 — UX overhaul & polish Rubric

**Purpose:** Turn the calendar from "data is in there somewhere" into something a real San Franciscan opens twice a week. Three concrete behavior changes, one readability pass, plus standard pre-domain polish (SEO, Core Web Vitals, canary). Reference aesthetic: https://sf.funcheap.com — dense, scannable, ugly-but-useful is closer to the target than current build.

**Inherits:** All M2 ship-gate dims (A3 single-writer rule, E1-E4 source link + price visibility, F1-F5 a11y/console, D12/D13 invariants). M5 does not relax any of them; it adds new dims on top.

**Method discipline:** Every dimension is a Playwright assertion, a Lighthouse score, an axe-core check, an HTTP HEAD, an exit code, or a SQL query. The two judgment dims (J1, J2) are gated by side-by-side screenshot comparison against a saved funcheap.com reference plus a date-stamped reviewer note — they are SOFT and do not block ship.

**Iteration cap:** 3 per dimension. Past 3, mark `HUMAN-REVIEW-NEEDED` and stop.

**Generator/evaluator separation:** The agent writing the UI does NOT run its own Playwright suite as proof. The evaluator opens a fresh shell, runs `npm run test:e2e` and `npm run lighthouse:m5`, and produces the next revision instruction.

---

## Pre-flight (must be true before any M5 code lands)

| # | Check | Pass |
|---|---|---|
| P1 | M2 ship gate passed on main | `rubrics/milestone-m2-calendar.md` has a PASS stamp at the bottom OR `git log --oneline --grep="m2"` shows the ship commit |
| P2 | `/api/events` supports `?from=&to=&limit=&order=start_asc` | `curl 'localhost:3000/api/events?from=2026-05-25&to=2026-06-08&limit=50&order=start_asc'` returns 200 with events ordered ascending |
| P3 | Neon has ≥ 200 events in next 14 days | SQL: `select count(*) from events where start_time_utc between now() and now()+interval '14 days'` ≥ 200 |
| P4 | Saved funcheap reference screenshot at `tests/fixtures/reference-funcheap.png` | `test -f tests/fixtures/reference-funcheap.png` |
| P5 | `DESIGN.md` exists at repo root | `test -f DESIGN.md` (produced by `/design-consultation` before any UI code) |
| P6 | Playwright + axe-core + Lighthouse CLI installed | `grep -E '"(@playwright/test|@axe-core/playwright|lighthouse)"' package.json` returns 3 matches |

---

## A. View mode mechanics (day / week / month)

Current behavior: `?preset=today|weekend|week|next-week` filters the data shown but the layout stays a 7×5 month grid. Target: view mode actually changes the grid, like macOS Calendar / Google Calendar. View mode is a separate axis from category/neighborhood filters.

| # | Failure mode | Check | Pass |
|---|---|---|---|
| A1 | View axis not in URL | navigate to `/?view=week&date=2026-05-25`; reload; UI shows week view of that date | true |
| A2 | Month view regressed | `/?view=month` renders 7×5 grid identical to pre-M5 month layout | Playwright: DOM has `[data-view="month"]` with exactly 35 day cells |
| A3 | Week view doesn't render 7-col × 1-row | `/?view=week` | Playwright: `[data-view="week"]` has 7 day-column children, 1 row |
| A4 | Day view doesn't render single-day agenda | `/?view=day&date=2026-05-30` | Playwright: `[data-view="day"]` has exactly 1 day header with date `2026-05-30` |
| A5 | Day-view event list doesn't filter to that date | Playwright @ `/?view=day&date=2026-05-30`: every visible event card has start_date=2026-05-30 in local tz | true |
| A6 | Week-view columns don't filter to their column's date | Playwright @ `/?view=week&date=2026-05-25`: events in column N have start_date matching that column's date | true for all 7 |
| A7 | Prev / next nav doesn't advance by view unit | click "next" in week view; URL `date` advances by 7 days. Same for month (+1 month) and day (+1 day) | true for each view |
| A8 | "Today" button doesn't return to today's view | click "today" from any view/date; URL `date` resets to today; view mode preserved | true |
| A9 | Category filter doesn't compose with view mode | apply `?view=week&category=comedy`: every visible event has category=comedy AND falls in that week | true |
| A10 | Keyboard arrow keys don't advance by view unit | Playwright `page.keyboard.press('ArrowRight')` advances date by 1 unit of active view | true |
| A11 | View toggle buttons missing or hidden | Playwright: `[data-view-toggle]` group contains 3 buttons (day/week/month), all visible @ 375px and 1440px | true |

## B. Funcheap-style feed

New section, separate from the calendar, modeled on funcheap.com's "Upcoming Fun and Cheap Events" list. Lives on the home page (placement decided in `/design-shotgun`; rubric just gates the result).

| # | Failure mode | Check | Pass |
|---|---|---|---|
| B1 | Feed section missing from home | Playwright @ `/`: `[data-section="upcoming-feed"]` exists | true |
| B2 | Feed not in chronological order | Playwright: extract event timestamps in feed order, assert strictly non-decreasing | true |
| B3 | Feed not lookahead-windowed | Every event in the feed has start_time_utc between now() and now()+14d (default window) | true |
| B4 | Feed rows missing required atoms | Each `[data-feed-row]` contains: date stamp, title, venue, price (`[data-price]`), category chip, source link (`<a target="_blank" href>`) | true for every row |
| B5 | Feed not dense | Average rendered row height @ 1440px ≤ 80px (deterministic via `boundingBox()`) | true |
| B6 | Feed wraps awkwardly on mobile | @ 375px: no horizontal scroll, no `[data-feed-row]` height > 200px (signals broken wrap) | true |
| B7 | Feed re-renders when filters change | apply `?category=comedy`: feed updates to comedy-only AND visible event count > 0 (assumes data exists) | true |
| B8 | Feed sourced from a non-`/api/events` endpoint | `grep -rn "fetch.*/api/" app/` shows only `/api/events` and `/api/digest`; no new endpoint introduced | true (single API surface) |

## C. Readability — typography, contrast, density

Target: scan 30 events in 5 seconds. Deterministic where possible; J1/J2 catch the rest as soft.

| # | Failure mode | Check | Pass |
|---|---|---|---|
| C1 | Body font size < 14px on mobile | Playwright @ 375px: computed `font-size` of `body` text in `[data-event-card]` ≥ 14px | true |
| C2 | Title font size < 16px anywhere | Playwright: every event title element computed `font-size` ≥ 16px | true |
| C3 | Line-height < 1.4 on body | Playwright: computed `line-height / font-size` of body text in event card ≥ 1.4 | true |
| C4 | Contrast < WCAG AA on body text | `@axe-core/playwright` `color-contrast` rule | 0 violations |
| C5 | Contrast < WCAG AA on category chip text | same | 0 violations |
| C6 | Category color palette has < 5 distinct chips | Playwright: extract `background-color` of every `[data-category-chip]`; ≥ 5 distinct values across (music, comedy, lectures, dancing, food) | true |
| C7 | Tap targets < 44×44 on mobile | Playwright @ 375px: every interactive element bounding box `min(w,h) ≥ 44` | true (re-asserts M2 C5) |
| C8 | Empty-state in week/day view is broken | navigate to a known-empty day; assert `[data-empty-state]` renders with reset-filters CTA | true |

## D. Performance — production Vercel URL

Lighthouse mobile profile, Slow 4G simulation, run against the production alias (`sf-events-aggregator-two.vercel.app`), NOT localhost.

| # | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | LCP > 2.5s | Lighthouse mobile | LCP ≤ 2500ms |
| D2 | CLS > 0.1 | same | CLS ≤ 0.1 |
| D3 | FCP > 1.8s | same | FCP ≤ 1800ms |
| D4 | TBT > 200ms | same | TBT ≤ 200ms |
| D5 | INP > 200ms on view-mode toggle | Lighthouse user-flow OR Playwright tracing | INP ≤ 200ms |
| D6 | Lighthouse Performance score < 90 | full run | ≥ 90 |
| D7 | Initial JS bundle on home > 200KB gzipped | `next build` output for `/` route | ≤ 200KB |
| D8 | Performance regressed vs. M2 baseline | compare Lighthouse JSON to `baselines/m2-lighthouse.json` | LCP/CLS/TBT all within +0% of M2 |

## E. SEO + metadata

| # | Failure mode | Check | Pass |
|---|---|---|---|
| E1 | `<title>` missing or generic | `curl -s https://<prod-url>/ \| grep -oE '<title>[^<]+</title>'` returns project-specific title (not "Next.js") | true |
| E2 | Meta description missing | `curl -s ... \| grep 'name="description"'` returns non-empty content | true |
| E3 | OG image missing | `curl -s ... \| grep 'property="og:image"'` returns a URL; HEAD on that URL returns 2xx and `content-type: image/*` | true |
| E4 | Twitter card missing | `curl -s ... \| grep 'name="twitter:card"'` returns `summary_large_image` | true |
| E5 | `robots.txt` missing | `curl -I https://<prod-url>/robots.txt` returns 200 | true |
| E6 | `sitemap.xml` missing or empty | `curl -s https://<prod-url>/sitemap.xml \| grep -c '<url>'` ≥ 1 | true |
| E7 | Home not indexable | `curl -s ... \| grep -E 'name="robots".*noindex'` returns empty | true |

## F. A11y + console (re-assertion of M2 F dims at higher bar)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| F1 | Console error on home | Playwright `page.on('console')` captures `error` | 0 |
| F2 | Console error on view toggle (day/week/month) | same, after each toggle | 0 |
| F3 | Console error on prev/next nav | same | 0 |
| F4 | A11y violations serious or critical | `@axe-core/playwright` on home + each view mode + feed section | 0 |
| F5 | Focus order broken in week view | Tab through; focus visits view-toggle, prev, today, next, then events left-to-right top-to-bottom | true |
| F6 | View-mode buttons missing aria-pressed | Playwright: `[data-view-toggle] button[aria-pressed]` exists for active button | true |

## G. Post-deploy canary

| # | Failure mode | Check | Pass |
|---|---|---|---|
| G1 | `/canary` config missing | `test -f .canary/config.yml` OR equivalent gstack canary setup file | true |
| G2 | No pre-deploy baseline captured | run `/canary baseline` once; assert `.canary/baselines/m5-pre.json` exists | true |
| G3 | Canary doesn't alert on console errors | inject a console.error via dev override, run canary, assert non-zero exit | true |

## H. Code-quality housekeeping

| # | Failure mode | Check | Pass |
|---|---|---|---|
| H1 | Typecheck fails | `npm run typecheck` | exit 0 |
| H2 | Lint fails | `npm run lint` | exit 0 |
| H3 | Tests fail | `npm test` | exit 0 |
| H4 | Build fails | `npm run build` | exit 0 |
| H5 | UI imports DB directly | `grep -rn "db/client\|db/schema" app/ components/` | empty (M2 A3 invariant) |
| H6 | Hard-coded price strings introduced | `grep -rn 'app/.*[$][0-9]' app/ components/` returns only `formatPriceDisplay`-routed renders | clean |

## J. Visual fit (SOFT, judgment — do not block ship)

Reviewer compares production screenshots against `tests/fixtures/reference-funcheap.png`. Date-stamp the review note in the rubric file when complete.

| # | Description | Method | Pass |
|---|---|---|---|
| J1 | Home reads as "dense, scannable, info-dense" like funcheap, not "marketing landing page" | side-by-side screenshot | reviewer: yes |
| J2 | Day / week / month views feel like a real calendar app (macOS Cal / Google Cal) | side-by-side vs. a screenshot of one of those apps | reviewer: yes |
| J3 | Feed and calendar coexist visually (don't fight for attention) | screenshot review | reviewer: yes |

---

## Ship gate for M5

**MUST PASS:** P1-P6, A1-A11, B1-B8, C1-C8, D1-D6, E1-E7, F1-F6, H1-H6.

**SOFT (informational, do not block):** D7, D8, G1-G3, J1-J3.

D8 (perf regression) is soft because adding a feed section legitimately adds bytes; gate is "didn't break the M2 numbers materially" but enforced via D1-D6 absolute thresholds, not the diff.

G1-G3 (canary) is soft for M5 ship but MUST be set up before custom-domain cutover (see Out of scope).

---

## Revision protocol

Cite the failing dimension and concrete evidence. Example:

> "A3 FAILED: `/?view=week` renders `[data-view="week"]` with 35 cells, not 7. Open `app/components/calendar-grid.tsx` — the view prop is routed but the grid template still hard-codes `grid-cols-7` × 5 rows. Add a switch on `viewMode` that emits a `grid-cols-7 grid-rows-1` template when `viewMode === 'week'`. Re-run `npm run test:e2e -- view-mode.spec.ts`."

NOT:

> "Fix the week view."

If the evaluator finds the writing context already saw the failure output (e.g., same agent ran the test before reporting PASS), reject the report and re-grade in a fresh shell.

---

## Out of scope for M5

- **Custom domain cutover** — wait until canary (G1-G3) is wired AND M5 has been live for 7 days without incident. Domain swap is its own micro-milestone.
- **Light-mode polish** — dark is the default; M5 doesn't promise a polished light theme.
- **Multi-day event ribbons on month view** — events spanning days still appear on day 1 only. Punt.
- **User accounts / favorites / submission** — SPEC permanent non-goals.
- **Search** — explicit non-goal; filters cover the use case.
- **Native swipe gestures between months** — defer.
- **i18n / localization** — SPEC non-goal.
- **The deferred items** in `OPEN-ITEMS.md` (M1 iCal sources, M3 ship-gate closure, branch pruning, SESSION-SUMMARY rewrite) — tracked separately, do not block M5.

---

## Sequencing note

1. `/design-consultation` → write `DESIGN.md` (satisfies P5).
2. Save funcheap reference screenshot (satisfies P4).
3. `/plan-design-review` against this rubric.
4. `/design-shotgun` for variant exploration on home layout (feed placement, view-toggle UI).
5. Implement A (view modes) FIRST — it's the deepest change and exposes API contract issues. B (feed) and C (readability) layer on top.
6. Run M5 evaluation in a fresh shell after each implementation chunk.
7. Stamp PASS at bottom of this file with date + commit SHA when ship gate clears.
