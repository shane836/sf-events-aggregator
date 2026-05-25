# SF Events Aggregator — Project Spec

**Status:** Draft v1 — pending venue list approval
**Owner:** Shane Mason
**Last updated:** 2026-05-24

---

## TL;DR

A mobile-responsive web calendar that aggregates music, comedy, academic lectures, dancing, and food (popups + night markets) events in San Francisco. Pulls from free APIs, university iCal feeds, and a curated set of venue scrapers. Refreshes daily. Hosted on Vercel.

No user accounts. No event submissions. A single "email me the upcoming events" button sends a one-shot digest. Built and shipped via a Plan-Generate-Evaluate loop with explicit rubrics gating each milestone.

---

## Goals & Non-Goals

### Goals (MVP)
- Aggregate 5 event categories (music, comedy, academic lectures, dancing, food) in SF proper
- Calendar interface: month grid on desktop, agenda list on mobile
- Filtering by category, date, and neighborhood
- Click-through to original ticket/source link
- One-shot email digest button (no recurring subscriptions)
- Mobile responsive
- Deployed to Vercel via GitHub
- Zero ongoing budget — free tiers only

### Non-Goals (explicitly out of MVP scope)
- User accounts / authentication
- Saving favorites / personalized calendars
- User-submitted events
- Ticket purchasing on-site
- Multi-region (East Bay, Peninsula, etc.) — SF only for MVP
- Real-time data freshness (daily refresh is fine)
- Native mobile apps
- Event sub-categories (e.g., Music → Jazz/Rock) — top-level only
- Food delivery / restaurant listings (only popups, night markets, and food events count under "Food")

---

## Users & Use Cases

**Primary user:** SF resident or visitor planning their week/weekend, currently using 3-4 different sites to find events across categories.

**Core use cases:**
1. "What's happening this Friday night?" → opens site, switches to Friday, sees all events.
2. "Any good comedy shows next week?" → filters by Comedy, scans next 7 days.
3. "Send me a list of stuff happening" → clicks digest button, gets email immediately.
4. "What's that show I saw — let me grab the ticket link" → clicks event, lands on source.

---

## Feature Scope (MVP)

### Calendar view
- **Desktop:** traditional month grid. Each cell shows up to 3 event titles + "+N more" overflow. Color-dot indicator per category.
- **Mobile (< 768px):** auto-switch to agenda list. Events grouped by date, chronologically. Same color-dot category indicators.
- **Navigation:** prev/next month, "Today" button, jump-to-date.

### Filters
- **Category:** Music / Comedy / Lectures / Dancing / Food — multi-select.
- **Date range:** quick presets (Today, This Weekend, This Week, Next Week) + custom range.
- **Neighborhood:** dropdown of ~15 SF neighborhoods (Mission, SoMa, Castro, Marina, etc.). Determined by venue geocoding.

### Event detail (modal or page)
- Title, date/time, venue, neighborhood, category, description (when available)
- **Price** — display as `$X`, `$X–$Y`, `Free`, or `Price varies` (when unparseable from source)
- **"View source / Get tickets" button** → opens source URL in new tab (every event always has this — non-negotiable)
- Source attribution (e.g., "From Ticketmaster" or "From sfjazz.org")

### Email digest button
- Prominent button on the calendar view: "📧 Email me this week's events"
- Modal: email input, optional category filter checkboxes, "Send" button.
- Single send. No subscriber list. No confirmation email. No unsubscribe (there's nothing to unsubscribe from).
- Email contains: HTML-formatted list of events for the next 7 days, links to each event's source.

### Design direction
**North star:** Resident Advisor / Songkick aesthetic — calendar-forward, minimal marketing chrome, dense but breathable, type-driven hierarchy.
- Monospace or geometric sans for headers, system sans for body
- Dark mode default (matches the music-calendar aesthetic), light mode toggle
- Category color coding: 5 distinct, accessible colors (WCAG AA)
- Mobile-first CSS via Tailwind

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Most documented JS framework, native Vercel support, RSC for fast initial loads |
| Language | TypeScript | Type safety for data ingestion pipeline |
| Styling | Tailwind CSS | Speed of iteration, mobile-first defaults |
| Database | Neon Postgres (free tier) | 500MB free, branching for dev/prod, Vercel integration |
| ORM | Drizzle | Lightweight, TypeScript-native, fast |
| Email | Resend | Free tier 3,000 emails/month, modern API, good Next.js docs |
| Ingestion compute | GitHub Actions | 2,000 free minutes/month, runs scrapers + API pulls on cron |
| Scraping | Cheerio + Playwright (where needed) | Cheerio for static, Playwright for JS-heavy pages |
| iCal parsing | `node-ical` | Mature, well-documented |
| Hosting | Vercel (Hobby tier) | Free, native Next.js, easy GitHub integration |
| Monitoring | Vercel Analytics + GitHub Action failure notifications | Free, sufficient for MVP |

---

## Data Sources & Strategy

### Tier 1: Free APIs (low maintenance)
| Source | Coverage | Cost | Notes |
|---|---|---|---|
| Ticketmaster Discovery API | Large music + comedy venues | Free, 5000 calls/day | Need API key (free signup) |
| SeatGeek API | Music + sports + some comedy | Free with key | Overlaps with Ticketmaster, catches some extras |

### Tier 2: iCal / RSS feeds (structured, stable)
Universities and major venues that publish structured feeds. **Universities are gold — most have ical exports for their public lecture calendars.**

| Source | Type | Status |
|---|---|---|
| events.stanford.edu | University lectures | Has iCal |
| events.berkeley.edu | University lectures | Has iCal |
| myusf.usfca.edu/events | University lectures | Verify iCal availability |
| events.sfsu.edu | University lectures | Verify iCal availability |
| calendar.ucsf.edu | University lectures | Has iCal |
| sfjazz.org | Music | iCal or scrape |
| sfsymphony.org | Music | iCal or scrape |
| cca.edu/events | Art/design lectures | Verify |
| sfcm.edu/events | Music school concerts | Verify |

### Tier 3: Scrapers (highest maintenance, fills the gaps)
Hand-written scrapers for venues that don't have APIs or iCal. Run daily via GitHub Actions. Each scraper is independently maintainable.

**Initial scraper targets (covers comedy + dance + food gaps):**
- Punch Line SF, Cobb's Comedy Club, The Setup, Cheaper Than Therapy
- ODC, Dance Mission Theater, Verdi Club (social dancing)
- Great American Music Hall, The Independent, The Chapel, Bimbo's 365 — for small/mid music venues that fall through API gaps
- **Food:** Off the Grid markets, Spark Social SF, Mission Community Market, Eater SF events page, Funcheap food filter. Food popups are scattered — expect this to be the thinnest category at launch.

### Refresh strategy
- **Cadence:** Daily at 4am Pacific via GitHub Actions
- **Process:** Each source = one job. Failures are isolated (one broken scraper doesn't break the pipeline).
- **Dedup:** After all sources pulled, run dedup pass keyed on `(normalized_title, venue, start_time)` with fuzzy match.
- **Stale event cleanup:** Events with `end_time < now()` archived from main view nightly.

---

## Starter Venue List (DRAFT — for your review before locking)

This is the seed list. We can add/remove before any scraping work starts.

### Music (14)
- The Fillmore
- The Warfield
- Great American Music Hall
- Bimbo's 365 Club
- The Independent
- The Chapel
- Cafe du Nord
- SFJAZZ Center
- Davies Symphony Hall
- War Memorial Opera House
- The Knockout
- Make-Out Room
- Rickshaw Stop
- August Hall

### Comedy (6)
- Punch Line SF
- Cobb's Comedy Club
- The Setup
- Cheaper Than Therapy
- SF Comedy College
- Secret Improv Society

### Academic / Lectures (6 — all university iCal feeds)
- Stanford (events.stanford.edu)
- UC Berkeley (events.berkeley.edu)
- USF (myusf.usfca.edu/events)
- SF State (events.sfsu.edu)
- UCSF (calendar.ucsf.edu)
- California College of the Arts (cca.edu/events)

### Dancing (6)
- ODC Theater / Commons
- Alonzo King LINES Ballet
- Dance Mission Theater
- Rhythm & Motion Dance Program
- Verdi Club (social dancing nights)
- Cinderella Ballroom

### Food — popups & night markets (5)
- Off the Grid (offthegrid.com) — multiple weekly markets with structured calendar
- Spark Social SF — weekly food truck park
- Mission Community Market — Thursday market
- Eater SF events page (eater.com/sf) — editorial popup coverage, scrape
- Funcheap food category (sf.funcheap.com/category/food) — scrape

**Note on Food:** This is the hardest category to source. Most popups are announced on Instagram with no structured data. Initial coverage will skew toward recurring markets. Expect to add scrapers (or accept thin coverage) over time.

**Total: ~37 venue/source targets** for the starter set. Plus Ticketmaster + SeatGeek APIs which cover many of the above (and more) opportunistically.

---

## Data Model

```typescript
// Events table
{
  id: uuid                          // generated
  source_id: string                 // original ID from source
  source: enum                      // 'ticketmaster' | 'seatgeek' | 'ical:stanford' | 'scrape:cobbs' | ...
  source_url: string                // click-through link — REQUIRED on every event
  title: string
  description: text | null
  category: enum                    // 'music' | 'comedy' | 'lectures' | 'dancing' | 'food'
  start_time: timestamptz
  end_time: timestamptz | null
  venue_id: uuid → venues.id
  price_min: numeric | null         // null = unknown
  price_max: numeric | null         // null = single price OR unknown
  is_free: boolean                  // true overrides price_min/max
  price_display: string             // computed: "$25", "$25–$45", "Free", "Price varies"
  raw_payload: jsonb                // original source data, for debugging
  ingested_at: timestamptz
  fingerprint: string               // hash of (normalized_title + venue_id + start_time) for dedup
}

// Venues table
{
  id: uuid
  name: string
  neighborhood: string              // 'Mission' | 'SoMa' | ...
  address: string | null
  lat: float | null
  lng: float | null
  primary_category: enum            // hint for categorization
  source_metadata: jsonb            // iCal URL, scraper config, etc.
}

// Digest sends (audit log, not subscriptions)
{
  id: uuid
  email: string
  sent_at: timestamptz
  filters_applied: jsonb            // {categories: [...], date_range: {...}}
  event_count: int
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (daily 4am PT)                          │
│  ├── Pull Ticketmaster API                              │
│  ├── Pull SeatGeek API                                  │
│  ├── Fetch iCal feeds (universities, venues)            │
│  ├── Run scrapers (one job per venue)                   │
│  ├── Normalize → Dedup → Categorize                     │
│  └── Write to Neon Postgres                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │   Neon Postgres      │
              │   (events, venues)   │
              └──────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js on Vercel                                      │
│  ├── /                  → Calendar (RSC, cached)        │
│  ├── /api/events        → Filtered event query          │
│  ├── /api/digest        → POST: send digest email       │
│  └── Resend integration → email delivery                │
└─────────────────────────────────────────────────────────┘
```

---

## Plan-Generate-Evaluate (PGE) Workflow

This project will be built using a PGE loop, as described in the rubric guide.

### Why PGE for this project
- **Hallucination risk in ingestion** — scrapers can produce garbage; categorization can be wrong; deduplication can fail. We need automated checks, not vibes.
- **Multiple integration surfaces** — APIs, iCal, scrapers, email — each is a separate failure mode that needs its own evaluator.
- **The build itself is iterative** — each milestone (auth, ingestion, calendar UI, email) is a generate-evaluate cycle.

### How we'll run it

**Macro loop (per milestone):**
1. **Plan** — break milestone into 2-5 generation steps. Write the rubric for the milestone BEFORE building.
2. **Generate** — Claude implements one step at a time.
3. **Evaluate** — run the rubric checks. Most are deterministic (build passes, tests pass, scraper returns >0 events, etc.).
4. **Revise** — failed dimensions become specific revision prompts. Don't "try again" — say "dimension 3 failed: scraper for Cobb's returned 0 events, expected >5. Inspect HTML structure and fix selector."
5. **Cap iterations at 3.** If not converged, surface for human review.

**Operation loops (during runtime):**
- **Ingestion run** has its own rubric (see Data Quality Rubric below). Runs every day. Failures alert via GitHub Action notification.
- **Digest send** has its own rubric (correct events, no nulls, links resolve).

### Rubric files
Each rubric lives in `/rubrics/` as markdown. Examples:
- `rubrics/ingestion-daily.md` — runs after every daily pipeline
- `rubrics/milestone-calendar-ui.md` — gates the calendar milestone
- `rubrics/milestone-digest.md` — gates the email digest milestone
- `rubrics/master-success.md` — top-level MVP ship criteria (see below)

---

## Master Success Rubric — "Is the MVP shippable?"

Built from the PGE methodology: specific failure modes, matched check methods, external ground truth.

### D1: Build & deploy succeeds
- **Failure mode:** Code doesn't compile / deploy fails / site is 500.
- **Check method:** Deterministic.
- **Criterion:** `npm run build` exits 0. Vercel deploy succeeds. Production URL returns 200 within 2s.
- **Pass:** All three pass.
- **Fail:** Any one fails.

### D2: Event coverage per category
- **Failure mode:** A category is so thin the site looks broken (e.g., 2 dance events all month).
- **Check method:** Deterministic count against Postgres.
- **Criterion:** Music / Comedy / Lectures / Dancing each ≥ 20 events in the next 30 days. **Food ≥ 10** (lower threshold — hardest category to source).
- **Ground truth:** `SELECT category, COUNT(*) FROM events WHERE start_time BETWEEN now() AND now() + 30 days GROUP BY category;`
- **Pass:** First 4 categories ≥ 20 AND food ≥ 10.
- **Fail:** Any category misses its threshold.

### D3: Source link validity
- **Failure mode:** Click-through goes 404 / dead link.
- **Check method:** Deterministic (HEAD request).
- **Criterion:** Spot-check 25 random `source_url` values — all return 200/301/302.
- **Pass:** ≥ 23/25 (allow 2 transient failures).
- **Fail:** 3+ broken links.

### D4: Deduplication works
- **Failure mode:** Same event appears 2-3x with slightly different titles.
- **Check method:** Deterministic.
- **Criterion:** No two events share `(normalized_title, venue_id, start_time::date)` after dedup pass.
- **Ground truth:** SQL query.
- **Pass:** Zero duplicates by that key.
- **Fail:** Any duplicates.

### D5: Categorization accuracy
- **Failure mode:** Jazz show categorized as comedy; lecture categorized as music.
- **Check method:** Source comparison + manual spot check.
- **Criterion:** Manually inspect 30 random events, verify category matches source description.
- **Ground truth:** The source URL/description.
- **Pass:** ≥ 27/30 correctly categorized.
- **Fail:** < 27/30.

### D6: No stale events on calendar
- **Failure mode:** Events that already happened still showing.
- **Check method:** Deterministic.
- **Criterion:** No event with `end_time < now() - 1 day` appears in calendar API response.
- **Pass:** API filter confirmed via integration test.
- **Fail:** Any past event surfaced.

### D7: Mobile responsiveness
- **Failure mode:** Calendar breaks on phone (overflow, unreadable, broken layout).
- **Check method:** Deterministic (Playwright at 375px, 768px, 1440px).
- **Criterion:** No horizontal scroll. All text readable. Filter controls reachable. Tap targets ≥ 44px.
- **Pass:** All three breakpoints pass automated checks.
- **Fail:** Any breakpoint fails.

### D8: Filters actually filter
- **Failure mode:** Selecting "Comedy" still shows music events.
- **Check method:** Deterministic integration test.
- **Criterion:** For each category, filtering shows only that category. Date range filters work. Neighborhood filter works.
- **Pass:** All filter combinations return correct event sets.
- **Fail:** Any filter returns wrong results.

### D9: Email digest delivers and renders
- **Failure mode:** Email never arrives / arrives as broken HTML / lands in spam.
- **Check method:** Deterministic + manual.
- **Criterion:**
  - Test send completes (Resend confirms delivery).
  - Email opens in Gmail + Apple Mail + Outlook web — no broken layout.
  - All event links in email resolve.
- **Pass:** All three confirmed.
- **Fail:** Any one fails.

### D10: Daily ingestion pipeline runs without manual intervention
- **Failure mode:** Pipeline silently breaks; site shows stale data.
- **Check method:** Deterministic (GitHub Actions run history + DB freshness check).
- **Criterion:** Last 7 daily runs completed. Most recent `ingested_at` timestamp in DB is < 30 hours old.
- **Pass:** Both true.
- **Fail:** Either fails.

### D11: Page load performance
- **Failure mode:** Slow first-load kills the experience.
- **Check method:** Deterministic (Lighthouse or WebPageTest).
- **Criterion:** Largest Contentful Paint < 2.5s on 3G simulation. CLS < 0.1.
- **Pass:** Both metrics meet threshold.
- **Fail:** Either misses.

### D12: Every event has a working click-through link
- **Failure mode:** Event in DB with null/empty `source_url` — user can't learn more.
- **Check method:** Deterministic SQL + integration test.
- **Criterion:** Zero rows with null/empty `source_url`. UI exposes a "View source" button on every event card and detail.
- **Pass:** Both confirmed.
- **Fail:** Any event without a link, or UI missing the button.

### D13: Price is displayed for every event
- **Failure mode:** Price field empty in UI; user has to click through to know if it's $5 or $500.
- **Check method:** Deterministic.
- **Criterion:** Every event card/detail shows one of: `$X`, `$X–$Y`, `Free`, or `Price varies`. Never blank.
- **Pass:** UI integration test confirms a price string renders on every event.
- **Fail:** Any event renders without a price string.

### D14: No console errors in production
- **Failure mode:** Production has JS errors users hit silently.
- **Check method:** Deterministic (open prod site, check devtools).
- **Criterion:** Zero console errors on home page, filtered views, event detail, digest modal.
- **Pass:** Clean console on all four flows.
- **Fail:** Any error.

**MVP ships when:** D1, D2, D6, D7, D8, D9, D10, D12, D13, D14 all pass (must-haves). D3, D4, D5, D11 should pass but are tunable (we can ship at "≥80% threshold met" and improve in v1.1).

---

## Data Quality Rubric — Runs every ingestion cycle

Lighter rubric, applied automatically after each daily pipeline run.

| D | Failure mode | Check | Pass condition |
|---|---|---|---|
| Q1 | Pipeline crashed mid-run | Exit code check | All source jobs exit 0 OR error logged with category |
| Q2 | A source returned 0 events when it shouldn't | Compare to 7-day rolling average | New count within ±50% of average (or alert) |
| Q3 | Hallucinated/garbage events | Required fields present | Every event has title, start_time, venue_id, source_url, price_display (no nulls) |
| Q4 | Bad timezones | Sanity check | All start_times within reasonable range (next 365 days, not 1970) |
| Q5 | Dead source links | HEAD-request sample | Sample of 10 new events: ≥ 9 return 200 |

Failing Q-checks post to a GitHub Action summary so we see them next morning.

---

## Implementation Roadmap

### Milestone 0: Foundation (1-2 days)
- Initialize Next.js + TS + Tailwind project
- Set up Neon Postgres, Drizzle schema
- Vercel deployment from GitHub
- **Gate:** D1 passes (build + deploy works on a "hello world" page).

### Milestone 1: Ingestion v1 — Tier 1 + Tier 2 only (3-5 days)
- Ticketmaster + SeatGeek API pulls
- 6 university iCal feeds
- Normalization + dedup logic
- GitHub Action cron
- **Gate:** D2 partial (music/lectures populated), D4, Q1-Q5 pass.

### Milestone 2: Calendar UI (3-5 days)
- Month grid (desktop)
- Agenda list (mobile)
- Category color coding
- Event detail modal
- Filter controls
- **Gate:** D7, D8, D11, D12, D13, D14 pass.

### Milestone 3: Ingestion v2 — Scrapers (4-7 days)
- 6 comedy scrapers
- 6 dance scrapers
- Music venue scrapers (gap-fill for what API misses)
- **Gate:** D2 fully passes (all 4 categories ≥ 20 events).

### Milestone 4: Email digest (2-3 days)
- Digest modal + form
- Resend integration
- HTML email template
- **Gate:** D9 passes.

### Milestone 5: Polish + ship (2-3 days)
- D3 spot checks, D5 categorization audit
- Performance pass
- Final master rubric run
- **Gate:** All MVP must-haves pass. Ship.

**Total estimate:** 15-25 working days. Sequential, but ingestion and UI can parallelize after Milestone 0.

---

## Open Questions / Risks

1. **iCal feed availability** — I assumed Stanford/Berkeley/UCSF/etc. publish iCal. Need to verify for each before locking the scope. If a university doesn't have iCal, it becomes a scraper (more work).
2. **Scraper fragility** — venues change layouts. Expect 1-2 scrapers to break per month. Budget time for maintenance, or accept thinner coverage when they break.
3. **Categorization edge cases** — "DJ set + comedy showcase" — is that music or comedy? Need a tiebreaker rule. (Proposal: source's primary classification wins; manually override via venue defaults.)
4. **Email deliverability** — Resend free tier is fine but first sends from a new domain often land in spam. Need to set up SPF/DKIM correctly. Plan a "warm-up" period.
5. **Legal posture on scraping** — low practical risk for non-commercial aggregator, but worth a robots.txt courtesy check for each target. Will skip any site that explicitly prohibits.
6. **Domain name** — not yet chosen. Defer until ship.

---

## Decisions Locked vs Open

### Locked
- Stack, geo (SF only), categories (4 top-level), refresh cadence, view types, digest model, design vibe, no auth/no submissions, PGE workflow.

### Pending your approval
- **Starter venue list** (above) — please review and edit before we begin scraper work.
- **Color palette for category indicators** — defer to design implementation, will propose during Milestone 2.
- **Domain name** — pick before Milestone 5.

### Will be decided during implementation
- Per-scraper config details
- Exact email template design
- Filter UI placement (sidebar vs top bar)
