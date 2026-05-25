# Milestone M2 — Calendar UI Rubric

**Purpose:** Render the ingested events as a usable mobile-first calendar that satisfies D7, D8, D11, D12, D13, D14 from the master rubric (`docs/SPEC.md`). The UI is the first user-visible product surface; everything else has been backend.

**Method discipline:** Every dimension is a Playwright assertion, a Lighthouse score, an integration test, or an HTTP HEAD. The only "judgment" calls are the visual-fit checks (G1-G3, G5), which use side-by-side reference comparison against a saved Resident Advisor / Songkick screenshot.

**Iteration cap:** 3 per dimension. Past 3, mark `HUMAN-REVIEW-NEEDED` and stop.

---

## Pre-flight (must be true before any UI code lands)

| # | Check | Pass |
|---|---|---|
| P1 | `/api/events` endpoint exists and returns ≥ 1 event | `curl localhost:3000/api/events` returns 200 with non-empty `events` array |
| P2 | Neon has ≥ 200 scraped events in the next 30 days | SQL count: `select count(*) from events where start_time_utc between now() and now()+interval '30 days'` ≥ 200 |
| P3 | Playwright installed in devDeps | `grep '"@playwright/test"' package.json` matches |
| P4 | Lighthouse runnable (CLI or `@lhci/cli`) | `npx lighthouse --version` resolves |
| P5 | `lib/format/price.ts` exports `formatPriceDisplay` | already true, smoke check |

---

## A. Routes + data flow

| # | Failure mode | Check | Pass |
|---|---|---|---|
| A1 | Home route returns 500 | `curl -I localhost:3000` | 200 |
| A2 | Home renders 0 events | Playwright: `expect(eventCards.count()).toBeGreaterThan(0)` | true |
| A3 | UI imports DB directly (Stream E rule) | `grep -rn "db/client\|db/schema" app/` | empty (UI only goes through `/api/events`) |
| A4 | UI hard-codes price strings | `grep -rn "formatPriceDisplay" app/` matches; no string-literal "$" patterns building price text in app/ | matches + clean |
| A5 | Server-rendered HTML missing data | view-source contains event titles (RSC + cached) | true |

## B. Filters (master D8)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| B1 | Category filter doesn't filter | select "Comedy", assert every visible event has category=comedy | true |
| B2 | Date-range filter doesn't filter | select "This Weekend", assert all visible events fall in that range | true |
| B3 | Neighborhood filter doesn't filter | select "Mission", assert all visible events have venue.neighborhood='Mission' | true |
| B4 | Filters don't compose (AND) | apply "Comedy" + "This Weekend" together, assert intersection | true |
| B5 | Clear/reset returns full set | click reset; event count returns to unfiltered total | true |
| B6 | Filters don't survive URL share | apply filter, copy URL, open in new tab → same view | true (soft) |

## C. Responsive behavior (master D7)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| C1 | Horizontal scroll @ 375px | Playwright: `scrollWidth ≤ clientWidth` on `<html>` | true |
| C2 | Horizontal scroll @ 768px | same | true |
| C3 | Overflow @ 1440px | same | true |
| C4 | Doesn't switch to agenda list < 768px | Playwright @ 375px asserts agenda layout (not month grid) | true |
| C5 | Tap target < 44px on mobile | Playwright `.boundingBox()` on every interactive element @ 375px | min(width, height) ≥ 44 for all |

## D. Performance (master D11)

Lighthouse mobile profile, throttled to "Slow 4G" simulation, against the production Vercel URL (not localhost).

| # | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | LCP > 2.5s | Lighthouse mobile | LCP ≤ 2500ms |
| D2 | CLS > 0.1 | same | CLS ≤ 0.1 |
| D3 | FCP > 1.8s | same | FCP ≤ 1800ms (soft) |
| D4 | TBT > 200ms | same | TBT ≤ 200ms (soft) |
| D5 | Initial JS bundle > 200KB gzipped | `next build` output | ≤ 200KB on home route (soft) |

## E. Source link + price visibility (master D12, D13)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| E1 | Event card missing "View source" affordance | Playwright: every `[data-event-card]` contains an anchor with `target="_blank"` to a non-empty `source_url` | true |
| E2 | Source link broken | HEAD-request first 10 visible `source_url` values | ≥ 9/10 return 2xx/3xx |
| E3 | Price not rendered on every event | Playwright: every event card contains a `[data-price]` element with non-empty text | true |
| E4 | Price text disagrees with `formatPriceDisplay` | Unit test: feed fixture rows through `formatPriceDisplay`, assert the rendered DOM text matches | matches for sampled 20 |

## F. A11y + console (master D14)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| F1 | Console error on home | Playwright `page.on('console')` listener captures `error` level | 0 |
| F2 | Console error after filter interaction | same | 0 |
| F3 | Console error opening event detail | same | 0 |
| F4 | A11y violations (serious+) | `@axe-core/playwright` run on home + filtered view + detail | 0 serious or critical |
| F5 | Color contrast on text + category chip | axe contrast check | WCAG AA pass |
| F6 | Keyboard nav can't reach all event cards | Tab through; assert focus visits every card on viewport | true |

## G. Visual fit (soft, judgment)

Not deterministically gated. Produce screenshots; reviewer compares against a saved Resident Advisor + Songkick reference and marks pass/fail.

| # | Description | Method | Pass |
|---|---|---|---|
| G1 | Layout reads as "calendar-forward, minimal marketing chrome" | side-by-side screenshot vs. RA homepage | reviewer: yes |
| G2 | Type hierarchy clear (event title > venue > time > category) | same | reviewer: yes |
| G3 | Category colors present, distinct, and accessible | same; tested via axe-core for contrast (already F5) | reviewer: yes |
| G4 | Dark mode default | first paint without any toggle; `prefers-color-scheme: dark` honored | deterministic: true |
| G5 | Event detail (modal or page) doesn't break the calendar rhythm | screenshot review | reviewer: yes |

---

## Deferred design decisions

The first M2 implementation PR proposes these; subsequent PRs match. Locked in as code comments / Tailwind tokens once approved.

- **Category color palette** — 5 WCAG-AA-passing accent colors (music / comedy / lectures / dancing / food). Recommend: pick a palette generator (Tailwind's defaults or Radix Colors) rather than hand-picking.
- **Typography stack** — header (mono or geometric sans), body (system sans). Recommend: `font-mono` for headers via Tailwind's default mono stack (Geist Mono / system); body inherits.
- **Event detail surface** — modal vs. dedicated page. Modal preserves filter context; page is shareable. Recommend modal with URL fragment for shareability.
- **Filter UI placement** — sidebar on desktop, top sheet on mobile. Recommend top bar on both for simplicity; revisit if filter count grows.
- **Empty-state copy** — "no events match these filters" + a one-click reset.

---

## Ship gate for M2

**MUST PASS:** A1, A2, A3, A4, B1, B2, B3, B4, B5, C1, C2, C3, C4, C5, D1, D2, E1, E2, E3, E4, F1, F2, F3, F4, F5, G4.

**SOFT (informational, do not block):** A5, B6, D3, D4, D5, F6, G1, G2, G3, G5.

---

## Revision protocol

Same pattern as M1/M3. Cite the failing dimension and concrete evidence:

> "C1 FAILED: at 375px viewport, `document.documentElement.scrollWidth=412 > clientWidth=375`. Inspect `app/page.tsx` — the month grid uses `grid-cols-7` without responsive variant. Replace with `grid-cols-1 md:grid-cols-7` and confirm the agenda list renders below md."

NOT:

> "Fix the mobile bug."

Generator/evaluator separation: the agent writing UI code does NOT run its own Playwright suite as proof. The evaluator opens a fresh `npm run test:e2e` from a clean shell.

---

## Out of scope for M2

- **Event submission** — no user input (SPEC non-goal)
- **Accounts / favorites / personalized calendars** — SPEC non-goal
- **Multi-day event visualization on month grid** — events spanning days appear on day 1; full range visible in detail view
- **Light-mode polish** — dark is default; light is a toggle but lower-priority polish
- **Native mobile gestures** (swipe between months) — defer to post-M5
- **Real-time updates** — daily refresh is the data freshness contract (SPEC line 35)
- **Email digest UI** — M4
