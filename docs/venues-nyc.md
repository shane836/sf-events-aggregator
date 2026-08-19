# New York City — Venue Research

Status: Initial compilation (training data, May 2025). URLs need live verification before writing scrapers.

---

## Music (20 venues)

| Venue | Neighborhood | Capacity | Notable | Events page | Ticketmaster? |
|---|---|---|---|---|---|
| Brooklyn Steel | East Williamsburg | ~1,800 | Bowery Presents flagship | bfrg.com/shows/brooklyn-steel | Yes |
| Music Hall of Williamsburg | Williamsburg | ~550 | Indie touring staple | musichallofwilliamsburg.com | Yes |
| Bowery Ballroom | Lower East Side | ~575 | Iconic indie/rock venue | boweryballroom.com | Yes |
| Mercury Lounge | Lower East Side | ~250 | Intimate, emerging artists | mercuryloungenyc.com | Yes |
| Webster Hall | East Village | ~1,500 | Reopened 2019, multi-genre | websterhall.com | Yes |
| Terminal 5 | Hell's Kitchen | ~3,000 | Large mid-size touring | terminal5nyc.com | Yes |
| Le Poisson Rouge | Greenwich Village | ~700 | Eclectic, classical crossover | lpr.com | No — own site |
| (Le) Poisson Rouge | Greenwich Village | | | | |
| Blue Note Jazz Club | Greenwich Village | ~240 | World's most famous jazz club | bluenotejazz.com/nyc | No — own site |
| Village Vanguard | Greenwich Village | ~123 | Legendary jazz since 1935 | villagevanguard.com | No — own site |
| Smalls Jazz Club | Greenwich Village | ~60 | Late-night jazz, intimate | smallslive.com | No — livestream + own |
| Jazz at Lincoln Center | Columbus Circle | ~1,200 | Wynton Marsalis, premium jazz | jazz.org/concerts | No — own site |
| Brooklyn Mirage / Avant Gardner | East Williamsburg | ~6,000 | Massive outdoor electronic/live | avant-gardner.com | Partial |
| Rough Trade NYC | Rockefeller Center | ~250 | Record store + live shows | rfrg.com/shows/rough-trade | No — own site |
| Baby's All Right | Williamsburg | ~300 | Indie, restaurant + venue | babysallright.com | No — own site |
| National Sawdust | Williamsburg | ~350 | New music, experimental, classical | nationalsawdust.org | No — own site |
| The Sultan Room | Bushwick | ~400 | Indie, rooftop shows | thesultanroom.com | No — own site |
| Racket NYC | Lower East Side | ~200 | Punk, hardcore, DIY | racketnyc.com | No — own site |
| Sony Hall | Times Square | ~3,000 | Large club shows | sonyhall.com | Yes |
| Beacon Theatre | Upper West Side | ~2,894 | Premium touring acts | beacontheatre.com | Yes |
| Kings Theatre | Flatbush | ~3,000 | Restored movie palace | kingstheatre.com | Yes |

### Adapter strategy
- **Ticketmaster/AXS** covers the Bowery Presents empire (Brooklyn Steel, Bowery Ballroom, Music Hall, Mercury, Webster, Terminal 5) + Beacon, Kings — huge coverage from one adapter
- **Jazz cluster** (Blue Note, Vanguard, Smalls, Jazz at Lincoln Center) — 4 individual scrapers but high value
- **Individual scrapers** for: Le Poisson Rouge, Baby's All Right, National Sawdust, Sultan Room, Racket
- NYC has the best Ticketmaster coverage of any city — the adapter alone gets you ~10 venues

---

## Comedy (12 venues)

| Venue | Neighborhood | Notable | Events page | Ticketmaster? |
|---|---|---|---|---|
| Comedy Cellar | Greenwich Village | Most famous club in the world, drop-ins | comedycellar.com/line-up | No — own site |
| The Stand | Gramercy | Premium club, restaurant | thestandnyc.com/calendar | No — own site |
| Gotham Comedy Club | Chelsea | Mid-size, TV tapings | gothamcomedyclub.com | No — own site |
| New York Comedy Club | Multiple locations | Multi-room, high volume | newyorkcomedyclub.com | No — own site |
| UCB Theatre | Hell's Kitchen / East Village | Improv institution | ucbtheatre.com | No — own site |
| Magnet Theater | Midtown West | Improv, sketch classes + shows | magnettheater.com | No — own site |
| Peoples Improv Theater (The PIT) | Midtown | Improv, sketch, variety | thepit-nyc.com | No — own site |
| Carolines on Broadway | (Closed 2023 — verify successor) | Was Times Square institution | Verify status | — |
| The Tiny Cupboard | Lower East Side | Micro-venue, intimate sets | tinycupboard.com | No |
| The Bell House | Gowanus | Comedy + music + variety | thebellhouseny.com | No — own site |
| Caveat | Lower East Side | Brainy comedy, variety, talks | caveat.nyc | No — own site |
| The Knitting Factory | Bushwick | Comedy + music hybrid | bfrg.com/shows/knitting-factory | Partial |

### Adapter strategy
- Comedy Cellar is #1 priority — scrape their lineup page
- The Stand and Gotham are #2 — good calendar pages
- UCB, Magnet, PIT have structured show listings
- Bell House and Caveat cross comedy/variety/lectures — good multi-category sources
- Verify Carolines status — may have reopened or been replaced

---

## Lectures / Academic (8 sources)

| Venue/Source | Area | Type | Events page |
|---|---|---|---|
| 92nd Street Y (92NY) | Upper East Side | Premier lecture/talks institution | 92ny.org/events |
| NYU Events | Greenwich Village / Brooklyn | University-wide public events | events.nyu.edu |
| Columbia University Events | Morningside Heights | Public lectures, panels | events.columbia.edu |
| The New School | Greenwich Village | Public lectures, panels | events.newschool.edu |
| Cooper Union | East Village | Great Hall lectures (free) | cooper.edu/events |
| Brooklyn Public Library | Various | Author talks, lectures | bklynlibrary.org/events |
| NYPL (NY Public Library) | Multiple | Live events, author talks | nypl.org/events |
| The Strand Bookstore | Union Square | Author readings, book events | strandbooks.com/events |

### Adapter strategy
- 92NY is the crown jewel — major speakers, well-structured event page
- NYU, Columbia, New School likely have iCal feeds
- Cooper Union Great Hall is iconic — check for calendar feed
- Libraries have excellent structured event pages — likely scrapeable
- The Strand has regular events — simple calendar scraper

---

## Dancing (10 venues)

| Venue | Neighborhood | Style | Events page |
|---|---|---|---|
| Stepping Out Studios | Midtown | Swing, ballroom, Latin socials | steppingoutstudios.com |
| Sandra Cameron Dance Center | Financial District | Ballroom, Latin, swing | sandracameron.com |
| You Should Be Dancing | NoMad | Swing, hustle, salsa socials | youshouldbe.com |
| Dardo Galletto Studios | Midtown | Argentine tango (major milongas) | dfrg.com (verify) |
| Dance Manhattan | Chelsea | Swing, salsa, ballroom socials | dancemanhattan.com |
| Lorenz Latin Dance Studio | Midtown | Salsa, bachata socials | lorenzlatindancestudio.com |
| Solas Bar | East Village | Salsa Tuesdays (legendary) | Verify current status |
| Williamsburg Salsa (various) | Williamsburg | Weekly salsa socials | Verify |
| Midsummer Night Swing | Lincoln Center | Outdoor summer dance series | lincolncenter.org/midsummer-night-swing |
| Russian Samovar (tango) | Midtown | Weekly milonga | Verify current status |

### Adapter strategy
- Stepping Out and You Should Be Dancing have structured calendars
- Midsummer Night Swing is seasonal (summer) but iconic — Lincoln Center has good event data
- Tango milonga scene is strong but fragmented across small studios
- Salsa scene uses Facebook/Instagram heavily — harder to scrape
- This category needs the most URL verification of any

---

## Food Events (8 sources)

| Source | Area | Type | Events page |
|---|---|---|---|
| Smorgasburg | Williamsburg / Prospect Park | Weekly food market (weekends) | smorgasburg.com |
| Queens Night Market | Flushing Meadows | Saturday night market (seasonal, Apr-Oct) | queensnightmarket.com |
| Brooklyn Flea + Food | Various | Weekly flea + food market | brooklynflea.com |
| Urbanspace | Various (Midtown, etc.) | Food halls with pop-up events | urbanspacenyc.com |
| The Dekalb Market Hall | Downtown Brooklyn | Food hall, occasional events | dekalbmarkethall.com |
| Eater NY Events | Citywide | Editorial aggregator | ny.eater.com |
| NYC Food Truck Association | Various | Truck schedule/events | nycfoodtrucks.org |
| Gotham West Market | Hell's Kitchen | Food hall events | Verify current status |

### Adapter strategy
- **Smorgasburg** is the big one — already have the scraper pattern from SF's Off the Grid
- **Queens Night Market** is seasonal but very popular — simple calendar scraper
- **Brooklyn Flea** has a schedule page
- Eater NY could be a Funcheap-style editorial scraper
- NYC food halls are more permanent than pop-up — fewer "events" per se

---

## Priority tiers for NYC launch

**Tier 1 (launch with these):**
- Ticketmaster (covers ~10+ music venues via Bowery Presents empire + Beacon, Kings, Sony, Webster)
- Comedy Cellar + The Stand + Gotham (the big 3)
- 92NY + NYU + Columbia events (lectures)
- Smorgasburg + Queens Night Market (food)
- Stepping Out Studios + You Should Be Dancing (dancing)

**Tier 2 (add after launch):**
- Jazz cluster (Blue Note, Village Vanguard, Smalls, Jazz at Lincoln Center)
- Le Poisson Rouge, Baby's All Right, National Sawdust
- UCB, Magnet, PIT (improv)
- Brooklyn Flea, Brooklyn Public Library events
- Midsummer Night Swing (seasonal)

**Tier 3 (stretch):**
- Caveat, Bell House (variety/comedy hybrid)
- Cooper Union, New School, NYPL lectures
- Smaller music venues (Racket, Sultan Room)
- Tango/salsa social dance scene
- Food truck aggregators

---

## NYC vs LA — key differences

- NYC has **much better Ticketmaster coverage** — the Bowery Presents network alone gives you 6+ venues
- NYC comedy is **more centralized** (Village cluster) and easier to scrape
- NYC has **stronger lecture/talks culture** (92NY, Cooper Union, libraries)
- NYC food markets are **more established** (Smorgasburg originated here)
- NYC dance scene is **more studio-based** (good calendar pages) vs LA's club-based scene
- Overall: NYC should be easier to launch than LA due to better structured event data
