# Multi-City Architecture Plan

**Goal:** One codebase, three Vercel deployments (SF, LA, NYC). City selected by `CITY` env var at build time.

---

## 1. City Config (`lib/city-config.ts`)

A single config object per city containing all city-specific values:

```ts
type CityConfig = {
  id: "sf" | "la" | "nyc";
  name: string;              // "San Francisco" | "Los Angeles" | "New York City"
  shortName: string;         // "SF" | "LA" | "NYC"
  timezone: string;          // IANA timezone
  ticketmaster: {
    city: string;            // API param
    stateCode: string;
    dmaId?: string;          // Ticketmaster DMA ID for tighter geo
    classifications: string[];
  };
  siteUrl: string;           // from env: NEXT_PUBLIC_SITE_URL
  meta: {
    title: string;
    description: string;
    keywords: string[];
  };
  neighborhoods: Record<string, string>;  // lowercase venue name → neighborhood
};
```

Loaded via `process.env.CITY` → switch statement. Falls back to `"sf"` for backwards compat.

**Files that read from city config instead of hardcoding:**
- `app/layout.tsx` — title, description, keywords, site URL
- `app/opengraph-image.tsx` — city name in OG image text
- `app/sitemap.ts` — site URL
- `app/robots.ts` — site URL
- `lib/ui/filters.ts` — timezone (replace all `"America/Los_Angeles"` refs)
- `lib/sources/ticketmaster.ts` — city, stateCode, neighborhood lookup

---

## 2. Source Registry Per City

Current flat structure:
```
lib/sources/
  ticketmaster.ts
  cobbs.ts
  chapel.ts
  ...
```

New structure:
```
lib/sources/
  shared/
    ticketmaster.ts      # Generic — reads city config for params
    types.ts             # Unchanged
  sf/
    index.ts             # Exports: SourceAdapter[]
    cobbs.ts
    chapel.ts
    bimbos.ts
    ...                  # All existing SF scrapers move here
  la/
    index.ts
    comedy-store.ts
    smorgasburg-la.ts
    ...
  nyc/
    index.ts
    bowery-presents.ts   # Single scraper → 7 venues
    comedy-cellar.ts
    92ny.ts
    smorgasburg-nyc.ts
    ...
```

Each city's `index.ts`:
```ts
import ticketmaster from "../shared/ticketmaster";
import cobbs from "./cobbs";
import chapel from "./chapel";
// ...
export const adapters: SourceAdapter[] = [ticketmaster, cobbs, chapel, ...];
```

`ingest/run.ts` changes:
- `tsx ingest/run.ts cobbs` → loads from `lib/sources/${CITY}/cobbs.ts`
- New `tsx ingest/run-all.ts` → imports city index, runs all adapters

---

## 3. Ticketmaster Adapter — Make Generic

Currently hardcodes `city: "San Francisco"`. Change to:

```ts
import { getCityConfig } from "@/lib/city-config";

const config = getCityConfig();
// In fetchPage():
url.searchParams.set("city", config.ticketmaster.city);
url.searchParams.set("stateCode", config.ticketmaster.stateCode);
```

The `KNOWN_VENUE_NEIGHBORHOODS` map moves into each city config.

**Ticketmaster coverage estimate:**
- SF: ~8 venues (Fillmore, Warfield, Chase Center, etc.)
- LA: ~8 venues (Wiltern, Fonda, El Rey, Greek, Bellwether, Troubadour, etc.)
- NYC: ~10+ venues (Beacon, Kings, Irving Plaza, Racket, Sony Hall + Bowery Presents may overlap via AXS)

---

## 4. Timezone Handling

`lib/ui/filters.ts` hardcodes `"America/Los_Angeles"` in 5 places:
- `todayInPT()` → rename to `todayLocal()`, read tz from config
- `presetToRange()` — PT offset math (UTC-7/8) → generalize for ET (UTC-4/5)
- `toUtcDay()` — hardcoded `+8h` / `+7h 59m 59s` offset → compute from tz

This is the trickiest refactor. The current approach uses hardcoded UTC offsets to avoid DST math. For 3 timezones we should use `Intl.DateTimeFormat` properly or a thin helper that resolves the UTC offset for a given tz + date.

NYC is `America/New_York` (ET), LA is also `America/Los_Angeles` (PT).

---

## 5. Deployment Model

Three Vercel projects, same GitHub repo:

| Project | Env vars | Domain |
|---|---|---|
| sf-events | `CITY=sf`, `NEXT_PUBLIC_SITE_URL=https://sf-events.app` | sf-events.app |
| la-events | `CITY=la`, `NEXT_PUBLIC_SITE_URL=https://la-events.app` | la-events.app |
| nyc-events | `CITY=nyc`, `NEXT_PUBLIC_SITE_URL=https://nyc-events.app` | nyc-events.app |

Each project gets its own:
- Vercel Postgres database (separate event data per city)
- `DATABASE_URL` env var
- `TICKETMASTER_CONSUMER_KEY` (can share the same key)
- `RESEND_API_KEY` (can share)
- City-specific cron jobs (only run that city's adapters)

---

## 6. Migration Steps (Ordered)

### Phase 1: Extract city config (no behavior change for SF)
1. Create `lib/city-config.ts` with SF config
2. Replace all hardcoded SF strings with config reads
3. Rename `todayInPT()` → `todayLocal()`, generalize timezone math
4. Verify SF deployment still works identically

### Phase 2: Reorganize sources
5. Create `lib/sources/shared/` — move `ticketmaster.ts` and `types.ts`
6. Create `lib/sources/sf/` — move all SF scrapers, add `index.ts`
7. Update `ingest/run.ts` to resolve from city directory
8. Verify SF ingestion still works

### Phase 3: Add LA
9. Add LA city config
10. Create `lib/sources/la/index.ts` with Ticketmaster only (immediate coverage)
11. Set up Vercel project + Postgres for LA
12. Deploy, verify Ticketmaster pulls LA events
13. Write priority scrapers: Comedy Store, UCLA, Smorgasburg LA, The Mayan

### Phase 4: Add NYC
14. Add NYC city config
15. Create `lib/sources/nyc/index.ts` with Ticketmaster + Bowery Presents scraper
16. Set up Vercel project + Postgres for NYC
17. Deploy, verify
18. Write priority scrapers: Comedy Cellar, 92NY, Smorgasburg NYC, Stepping Out

---

## 7. New Adapters to Write (Priority Order)

### LA — Tier 1
| Adapter | Type | Venues covered | Category |
|---|---|---|---|
| ticketmaster (shared) | api | ~8 venues | music, comedy |
| comedy-store | scrape | 1 (3 rooms) | comedy |
| laugh-factory | scrape | 1 | comedy |
| improv-hollywood | scrape | 1 | comedy |
| ucla-events | ical/scrape | 1 | lectures |
| caltech-events | ical/scrape | 1 | lectures |
| smorgasburg-la | scrape | 1 | food |
| 626-night-market | scrape | 1 | food (seasonal) |
| the-mayan | scrape | 1 | dancing |
| candela-la-brea | scrape | 1 | dancing |

### NYC — Tier 1
| Adapter | Type | Venues covered | Category |
|---|---|---|---|
| ticketmaster (shared) | api | ~6 venues | music |
| bowery-presents | scrape | 7 venues (!) | music |
| comedy-cellar | scrape | 3 rooms | comedy |
| the-stand | scrape | 1 | comedy |
| gotham-comedy | scrape | 1 | comedy |
| 92ny | scrape | 1 | lectures |
| nyu-events | ical/scrape | 1 | lectures |
| columbia-events | ical/scrape | 1 | lectures |
| smorgasburg-nyc | scrape | 1 | food |
| queens-night-market | scrape | 1 | food (seasonal) |
| stepping-out | scrape | 1 | dancing |
| swing-46 | scrape | 1 | dancing |

### High-value NYC bonus: Bowery Presents
One scraper on `bowerypresents.com` covers Brooklyn Steel, Webster Hall, Terminal 5, Music Hall of Williamsburg, Bowery Ballroom, Mercury Lounge, and Warsaw. This is the single highest-ROI scraper across all three cities.

---

## 8. What Stays Unchanged

- `db/schema.ts` — already city-agnostic
- `lib/identity.ts` — fingerprinting is city-agnostic
- `lib/persist.ts` — upsert logic unchanged
- `lib/runner.ts` — adapter runner unchanged
- All UI components — calendar, agenda, filter bar, event cards, modals
- `lib/api/events.ts` — API fetcher unchanged
- `app/api/events/route.ts` — route handler unchanged
- `lib/digest/` — email digest system unchanged
- Test infrastructure — vitest, playwright configs unchanged

---

## 9. Estimated Effort

| Phase | Effort | Risk |
|---|---|---|
| Phase 1 (city config) | 2-3 hours | Low — mechanical refactor |
| Phase 2 (source reorg) | 1-2 hours | Low — file moves + import updates |
| Phase 3 (LA launch) | 1-2 days | Medium — new scrapers, new Vercel project |
| Phase 4 (NYC launch) | 1-2 days | Medium — same as LA |

The Bowery Presents scraper alone justifies NYC going second — it's a force multiplier.

---

## Open Questions

1. **Domains:** Buy `la-events.app` / `nyc-events.app`? Or subdomains of a parent?
2. **Shared Ticketmaster key:** Free tier is 5000 calls/day — enough for 3 cities if we stagger cron times
3. **Cross-city linking:** Should each site link to the other two? ("Also check out LA Events / NYC Events")
4. **Cron scheduling:** Each city's ingestion cron should run at a different time to avoid Ticketmaster rate limits
5. **Neighborhoods:** Need to compile neighborhood lists for LA and NYC (less well-defined than SF's 30+ named neighborhoods)
