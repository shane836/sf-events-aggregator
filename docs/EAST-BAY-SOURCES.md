# East Bay Event Sources

Research backing the East Bay expansion — the **whole East Bay** (Alameda +
Contra Costa counties: Oakland, Berkeley, Alameda, Emeryville, Albany,
Piedmont, San Leandro, Hayward, Fremont, Richmond, El Cerrito, Concord, Walnut
Creek, Danville, San Ramon, …), verified June 2026. Each entry notes the
recommended ingestion method against this repo's three source tiers — `api`
(e.g. Ticketmaster Discovery), `ical` (e.g. UCSF), and `scrape` (JSON-LD /
HTML, e.g. Cobb's, Funcheap) — plus robots.txt / ToS caveats.

The city selector is two options — **SF** or **East Bay** — but the East Bay
umbrella fans out to every Alameda + Contra Costa city (plus a generic bucket)
under the hood, so `venues.city` still carries the precise metro per event.
Events in cities we don't query directly still get tagged from their own
address and surface under East Bay — e.g. an Eventbrite listing in Pleasant
Hill is tagged `city=Pleasant Hill`. Sources that can't resolve a specific city
(the Funcheap feed) use a generic `East Bay` bucket.

> **Compliance first.** We honor robots.txt and site ToS (`lib/scrape.ts`
> aborts on Cloudflare interstitials; see M3 rubric B6). Several sources below
> either block our crawler UA or sit behind anti-bot walls — those are flagged
> **DO NOT SCRAPE** and should be reached via an allowed backend
> (Ticketmaster/Eventbrite API) or skipped.

Statuses verified as of June 2026 — re-check before implementing (venues close).

---

## Already implemented

| Source | Tier | Categories | Coverage |
| --- | --- | --- | --- |
| `ticketmaster` | api | music, comedy | Now queries **Oakland** + SF and tags `venue.city`. Covers **Fox Theater**, **Paramount Theatre**, and every other Ticketmaster-ticketed Oakland venue. |
| `ical:omca` | ical | food, lectures, music, dancing | **Oakland Museum of California** public-program feed (`/events/?ical=1`, robots-allowed). Maps "Friday Nights at OMCA / Off the Grid" food-truck nights → food; talks/performances → lectures/music. |
| `scrape:eventbrite` | scrape | all 5 | **Eventbrite East Bay.** robots allows `/d/`. One request per city: read the discovery page's schema.org `ItemList` of ~20 Event nodes (no per-event fetch — Eventbrite 405-throttles bursts). City + geo tagged from each event's own address (discovery bleeds Bay-wide); off-metro/off-taxonomy events skipped. Covers Comedy Oakland, Ruckus Revival, The Sound Room, salsa socials. |
| `scrape:freight` | scrape | music (+lectures/comedy) | **Freight & Salvage (Berkeley)** — fragile HTML scraper. No JSON-LD/iCal and the REST API omits datetimes, so it parses the server-rendered `span.dates` show cards on `/shows/`. Breaks if Freight restyles the cards (reports a parse error, ingests nothing). `city=Berkeley`. |
| `scrape:funcheapeastbay` | scrape | all 5 | **Funcheap East Bay.** There is no `eastbay.funcheap.com`; the East Bay is the location archive `sf.funcheap.com/category/event/event-locations/east-bay/` (same `div.tanbox` markup as the SF food adapter, shared via `lib/funcheap.ts`). Mixed-category feed → keyword-classified, off-taxonomy skipped. City detected from title/venue when a city is named, else the generic **East Bay** bucket. Community-tier. |

---

## Music venues

| Venue | Address | Backend | Method / notes |
| --- | --- | --- | --- |
| **Fox Theater Oakland** | 1807 Telegraph Ave | Ticketmaster (Another Planet) | ✅ Covered by `ticketmaster`. First-party site is WordPress, no JSON-LD. |
| **Paramount Theatre** | 2025 Broadway | Ticketmaster | ✅ Covered by `ticketmaster`. Also hosts Oakland Symphony / Oakland Ballet. |
| **Yoshi's Oakland** (jazz + food) | 510 Embarcadero West | Etix (in-house) | No JSON-LD / iCal / API; calendar is custom HTML. robots.txt is 404 (unrestricted by convention). Would need a bespoke HTML scraper. |
| **The New Parish** | 1743 San Pablo Ave | TicketWeb | WordPress; calendar is **JS-rendered** (no static event data). robots allows `/calendar/`. Hard to scrape without a headless browser. |
| **Eli's Mile High Club** | 3629 MLK Jr Way | Wix Events | robots allows `/shows`; Wix native ticketing, no JSON-LD. Punk/garage/blues + food. |
| **Crybaby** (was The Uptown) | 1928 Telegraph Ave | TicketWeb | The Uptown Nightclub closed and rebranded as Crybaby (~600 cap). WordPress. |
| **Thee Stork Club** (was Stork Club) | ~2330 Telegraph Ave (unverified) | See Tickets / Eventim | JS-rendered calendar; "Leo's House of Thee Stork Club" name **not** confirmed — current name is **Thee Stork Club**. |
| **The Sound Room** (jazz, nonprofit) | 3022 Broadway | Eventbrite | Squarespace; per-event `.ics` links but **no whole-calendar feed**. Best reached via Eventbrite. |
| **Continental Club** | 1658 12th St (West Oakland) | unknown | WordPress; mostly private events. Low public-event volume. |

**Berkeley — covered via aggregators; no clean first-party venue feed.**
Berkeley is already pulled in by three working sources: `ticketmaster` queries
it (Greek Theatre, UC Theatre — both Ticketmaster), `scrape:eventbrite` has a
Berkeley discovery anchor, and `scrape:funcheapeastbay` detects Berkeley in its
East Bay feed. A *dedicated venue* scraper was investigated and shelved — same
wall as Oakland's first-party sites:
- **Freight & Salvage** (`thefreight.org/shows/`, robots-OK) — ✅ now built as
  `scrape:freight` (fragile). No Event JSON-LD/iCal and the REST API omits
  datetimes, so it parses the server-rendered `span.dates` show cards.
- **UC Theatre / Greek Theatre** — Ticketmaster, already covered.
- **Ashkenaz** — Squarespace + VenuePilot, no iCal/JSON-LD on the calendar.
- **UC Berkeley** (`events.berkeley.edu`) and **Cal Performances** — no working
  `.ics`/Tribe feed found.
- **Berkeley Public Library** (`libnet.info`) — per-event Event JSON-LD exists,
  but the listing is JS-rendered (no static enumeration). A sitemap-driven
  crawl could work later for library lectures/music.

**Emeryville:** **Public Market Emeryville** (5959 Shellmound St) — WordPress
events page with recurring "Market Beats" live music; worth a `scrape` adapter.
Otherwise covered by `scrape:eventbrite` (Emeryville discovery anchor).

**Closed (do not ingest):** Starline Social Club (closed Jan 1 2026), The
Octopus Literary Salon (closed), Golden Bull (closed Apr 2026), 1-2-3-4 Go!
Records (not booking shows).

## Comedy

| Source | Backend | Method / notes |
| --- | --- | --- |
| **Comedy Oakland** (comedyoakland.com) | Eventbrite | Longest-running Bay Area stand-up room; hosts at Elbo Room (311 Broadway) & Quinn's Lighthouse (1951 Embarcadero). ⚠️ **robots.txt disallows all non-Google bots** — do NOT scrape the site; pull via the **Eventbrite API** instead. |
| **The Ruckus Revival** (ex-Tourettes Without Regrets) | Eventbrite | 2nd Thursdays at Oakland Metro Operahouse (522 2nd St). Squarespace site; reach via Eventbrite. |

> **Made Up Theatre is in Fremont** (outside our current East Bay city list) —
> exclude for now or add Fremont to the selector if you want Tri-City coverage.

## Dancing / social dance

| Source | Backend | Method / notes |
| --- | --- | --- |
| **Salsamania Productions** @ Just Dance Ballroom (2500 Embarcadero) | door / Gumroad | Recurring salsa/bachata socials & series. No JSON-LD/iCal; mostly pay-at-door. |
| **SalsaCrazy** @ Just Dance Ballroom | — | Second operator at the same venue. |
| **Eventbrite — Oakland salsa** (`/d/ca--oakland/salsa/`) | Eventbrite API | Aggregator path; best structured option for social dance. |

> **Ashkenaz** (Berkeley, 1317 San Pablo Ave) is very active — world/folk
> dance, Bachata Nightz, Cajun/zydeco, swing. **Now in scope**; VenuePilot
> ticketing (`tickets.venuepilot.com`) exposes structured pages — a good
> `scrape`/`api` target for `city=Berkeley`. New Karibbean City appears
> **closed** (Yelp, Apr 2026).

## Food

| Source | Cadence | Backend | Method / notes |
| --- | --- | --- | --- |
| **Friday Nights at OMCA** (Off the Grid) | Fri, Apr–Oct | WordPress + The Events Calendar | ✅ Covered by `ical:omca`. Free-admission food-truck block party. robots fully allowed. |
| **Grand Lake (Lake Merritt) Farmers Market** | Sat year-round | Squarespace (AIM) | ⚠️ **DO NOT SCRAPE** — robots.txt names `ClaudeBot`/`anthropic-ai`/`GPTBot` and blocks `?format=ical`/`?format=json`. HTML-only crawl, AI bots disallowed. |
| **Old Oakland Farmers Market** | Fri year-round | Squarespace (UVFM) | ⚠️ Same Squarespace AI-bot block as above. |
| **Jack London Square Farmers Market** | Sun | unknown | Feeds unverified. |
| **Rockridge Market Hall** (5655 College Ave) | occasional | YOOtheme/WP | Tastings & fêtes; no structured feed confirmed. |

> **Eat Real Festival** has been on hiatus since 2019 — not an active source.
> **Public Market Emeryville** (WordPress events page; "Market Beats" live
> music 2nd Fridays) is **now in scope** as `city=Emeryville`.

## Aggregators

| Aggregator | Oakland coverage | Structured data | Verdict |
| --- | --- | --- | --- |
| **Eventbrite** (`/d/ca--<city>/...`) | Broad | per-event schema.org JSON-LD (discovery API retired) | ✅ Implemented as `scrape:eventbrite`. Powers Comedy Oakland, Ruckus Revival, The Sound Room, many dance socials. |
| **Funcheap East Bay** (`sf.funcheap.com/.../event-locations/east-bay/`) | Broad, free/cheap | WordPress `div.tanbox` listing | ✅ Implemented as `scrape:funcheapeastbay`. (No `eastbay.` subdomain exists — it's a location archive on the main site.) |
| **SF Station** (`/calendar/east-bay/oakland`) | **Granular** (neighborhood + category) | robots allows `/calendar/`, but format unverified | ⚠️ **Anti-bot 403** on all fetches. Richest taxonomy but needs a headless/allowed approach. |
| **DoTheBay / eastbay.dothebay.com** | Strong East Bay | Unverified | ⚠️ **Cloudflare 403** — blocked to simple HTTP clients. |
| **Songkick** (SF Bay Area metro `26330`) | Music only | API **closed** to new devs; robots blocks AI bots | ⚠️ Avoid. No public metro `.ics`/RSS. (Note: metro `88311` is Oakland **Oregon** — wrong.) |
| **Visit Oakland**, **Oakland First Fridays**, **Oaklandside** | Editorial/civic | Mixed; verify per-site | Worth checking for iCal/The-Events-Calendar feeds (civic sites often expose them). |
| **KQED Live**, **48 Hills**, **The Bold Italic** | Thin/SF-centric | RSS of *articles*, no event feed | Not useful as structured event sources. |

## Public Facebook groups / pages

⚠️ **Facebook's ToS prohibits automated scraping, and the Graph API no longer
exposes public Page/Group events to third-party apps** (the `events` edge was
deprecated). Treat these as **manual-curation references only — do not scrape.**

Active public Oakland event pages/groups to monitor by hand:

- **Oakland Art Murmur / Oakland First Fridays** — facebook.com/oaklandfirstfridays
- **Visit Oakland** — facebook.com/VisitOakland
- **The Ruckus Revival** — facebook.com/touretteswithoutregretsoakland
- Venue pages: Fox Theater Oakland, The New Parish, Yoshi's, Eli's Mile High
  Club, Thee Stork Club, Crybaby (each posts its own shows)

If event data from FB is needed, prefer the venue's first-party site or its
ticketing backend (Ticketmaster/Eventbrite/TicketWeb) over Facebook itself.

---

## Recommended implementation order

1. ✅ **`ticketmaster` → East Bay** (done) — Fox, Paramount, Greek Theatre,
   marquee touring acts across SF + East Bay.
2. ✅ **`ical:omca`** (done) — free food-truck nights + museum programming.
3. ✅ **`scrape:eventbrite`** (done) — Comedy Oakland, Ruckus Revival, The
   Sound Room, salsa socials, and broad indie coverage via event-page JSON-LD.
4. ✅ **`scrape:funcheapeastbay`** (done) — broad free/cheap coverage across
   all categories from the East Bay location archive.
5. **Berkeley venues** (`scrape`/`api`) — Freight & Salvage and UC Theatre
   (clean calendars), Ashkenaz (VenuePilot) for `city=Berkeley` dance.

Lower priority / blocked: SF Station and DoTheBay (anti-bot 403), Songkick
(closed API + AI-bot block), Squarespace farmers markets (AI-bot block).
