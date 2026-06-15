# Session summary — East Bay expansion (2026-06-15)

Expanded the aggregator from San Francisco to **SF + the East Bay**: a city
selector, a `city` data dimension, and five new ingestion sources. All work
landed on `main` (commits `f2c40d0..d4caacc`); PR #41 captured the same set.

## Goal (as requested)

1. Add a "choose city" dropdown (started SF/Oakland → ended SF/East Bay).
2. Suggest venues, aggregators, and Facebook groups to scrape for the East Bay.
3. Build real East Bay scrapers, expand to **every** East Bay city, loosen
   classifiers, add a Berkeley source, and ship to `main`.

## What shipped

### UI + data model
- **`CitySelector`** in the header (replaced the `sf events` wordmark). Two
  options — **SF** / **East Bay** — URL-driven (`?city=`), shareable, clears the
  neighborhood filter on switch.
- **`venues.city`** column (migration `0001_opposite_mongoose.sql`; defaults to
  `San Francisco` so existing rows backfill and SF behavior is unchanged).
  Threaded through `VenueCandidate` → `persist` → `/api/events` (`?city=`
  filter, repeatable) → `lib/api/events` → `lib/ui/filters`.
- **`lib/ui/cities.ts`** is the city model: the **East Bay** selection fans out
  to every Alameda + Contra Costa city (`EAST_BAY_CITY_NAMES`) plus a generic
  `East Bay` bucket. The picker is just SF/East Bay, but `venues.city` stays
  precise per event — a Pleasant Hill listing is tagged `city=Pleasant Hill`
  and still surfaces under East Bay.
- `TICKETMASTER_QUERY_CITIES` bounds how many cities Ticketmaster queries
  (billed per city) while `INGEST_CITY_NAMES` (the full set) is what sources
  match event addresses against.

### Sources (all live-validated; auto-discovered by the ingest cron)
| Source | Tier | Notes |
| --- | --- | --- |
| `ticketmaster` | api | Queries SF + East Bay cities, tags `venue.city`. Fox, Paramount, Greek Theatre, etc. |
| `ical:omca` | ical | Oakland Museum of California `/events/?ical=1` (robots-OK). Friday Nights / Off the Grid → food; talks/perf → lectures/music. |
| `scrape:eventbrite` | scrape | Discovery-page schema.org `ItemList`, one request per city + 1.5s delay (Eventbrite 405-throttles bursts). City + geo from each event's own address. |
| `scrape:funcheapeastbay` | scrape | Funcheap East Bay location archive (`/event-locations/east-bay/`); shared parsing in `lib/funcheap.ts`. Generic `East Bay` bucket when no city is named. |
| `scrape:freight` | scrape | Freight & Salvage (Berkeley) — **fragile by design**: parses server-rendered `span.dates` show cards (no JSON-LD/iCal; REST API omits datetimes). |

Keyword classifiers map the mixed feeds into the 5-category taxonomy and skip
the rest; they were loosened for higher recall (Eventbrite 7→15, Funcheap 4→16
live).

### Docs
- **`docs/EAST-BAY-SOURCES.md`** — verified venue/aggregator/Facebook research
  with scrape methods, robots.txt / ToS flags, and closures.

## Key decisions

- **Facebook scraping: declined.** Requested (incl. "ignore ToS / minimize
  bans"), but building ban/detection-evasion against an access-controlled,
  ToS-restricted platform isn't something to ship. The same events are reached
  via Eventbrite/Ticketmaster backends; FB stays a manual-reference list.
- **Test the fetch, not just the parse.** Exercising Eventbrite live exposed
  405 throttling and that the original two-phase (~44 requests/run) design
  would get blocked → redesigned to one-request-per-city reading the discovery
  `ItemList`. Same live-testing pattern caught Freight's hidden datetimes.
- **Selector collapsed** from ~30 county-grouped cities to SF/East Bay per
  request; the full city set still drives tagging/filtering underneath.
- **Fragile Berkeley scraper accepted.** Freight has no clean feed; the scraper
  couples to its markup and fails soft (parse error, ingests nothing) on a
  restyle. Berkeley is also covered by ticketmaster/eventbrite/funcheap.

## Findings worth remembering

- Most first-party East Bay venues (Yoshi's, New Parish, Freight, Ashkenaz)
  expose **no** clean JSON-LD/iCal; reliable structured data comes from
  ticketing backends (Ticketmaster, Eventbrite) and a few iCal feeds (OMCA).
- `eastbay.funcheap.com` does **not** exist — Funcheap's East Bay is a location
  archive on the main site.
- Squarespace farmers-market sites (Grand Lake, Old Oakland) block ClaudeBot +
  the `?format=ical/json` feeds — do not scrape.
- Closures/relocations: Starline (closed), Uptown→Crybaby, Golden Bull (closed),
  Octopus Literary Salon (closed). Greek Theatre/Ashkenaz are Berkeley; Made Up
  Theatre is Fremont.

## Testing

- Unit + fixture-regression tests for every source (fixtures captured from real
  responses: `eventbrite-discovery.html`, `funcheap-eastbay.html`,
  `freight-shows.html`). `tsc` + `eslint` clean.
- Full suite green **except 5 pre-existing time-stale `offthegrid` fixtures**
  that fail on `main` independent of this work (the fixture event dates are now
  in the past).

## Follow-ups / not done

- Site `<title>`/SEO metadata still reads "SF Events" (broader rebrand, tied to
  an SEO e2e assertion).
- Classifiers are keyword-based; recall could improve further. Eventbrite is
  IP-throttle-sensitive — production cron's single spaced run is fine.
- Candidate next sources: Berkeley (Ashkenaz/VenuePilot, UC Theatre via TM),
  Emeryville Public Market, a sitemap-driven Berkeley Public Library scraper.
- The pre-existing `offthegrid` fixture staleness is unrelated but worth a fix.
