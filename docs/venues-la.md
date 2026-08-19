# Los Angeles — Venue Research

Status: Initial compilation (training data, May 2025). URLs need live verification before writing scrapers.

---

## Music (18 venues)

| Venue | Neighborhood | Capacity | Notable | Events page | Ticketmaster? |
|---|---|---|---|---|---|
| The Troubadour | West Hollywood | ~400 | Legendary singer-songwriter room since 1957 | troubadour.com/events | Yes |
| The Roxy Theatre | West Hollywood | ~500 | Sunset Strip institution | theroxy.com/events | Partial |
| The Wiltern | Koreatown | ~1,850 | Art deco landmark, mid-size touring acts | wiltern.com | Yes |
| The Fonda Theatre | Hollywood | ~1,200 | Major indie/rock touring stop | fondatheatre.com | Yes |
| The El Rey Theatre | Mid-Wilshire | ~770 | Art deco, eclectic bookings | theelrey.com | Yes |
| The Echo / Echoplex | Echo Park | ~350/~800 | Indie/underground scene hub, two rooms | theecho.com | No — own site |
| Zebulon | Frogtown | ~200 | Experimental, jazz, DIY | zebulon.la | No — own site |
| The Lodge Room | Highland Park | ~500 | Indie/folk, beautiful Masonic building | lodgeroomhp.com | Partial |
| The Moroccan Lounge | Arts District | ~250 | Intimate, emerging artists | moroccanlounge.com | No — own site |
| The Regent Theater | DTLA | ~1,100 | Punk, metal, electronic | theregenttheater.com | Partial |
| The Teragram Ballroom | DTLA | ~700 | Indie touring circuit staple | teragramballroom.com | No — Goldenvoice |
| The Greek Theatre | Griffith Park | ~5,870 | Outdoor amphitheater, major acts | lagreektheatre.com | Yes |
| Hollywood Bowl | Hollywood Hills | ~17,500 | LA Phil + concerts, iconic outdoor | hollywoodbowl.com | Yes (via own box office) |
| The Bellwether | DTLA | ~1,500 | Newer (2023), mid-size touring | thebellwetherla.com | Yes |
| Amoeba Music | Hollywood | varies | Free in-store performances | amoeba.com/live-shows | No |
| The Mint | Mid-Wilshire | ~200 | Jazz/blues/soul since 1937 | themintla.com | No — own site |
| Catalina Bar & Grill | Hollywood | ~200 | Premier jazz club | catalinajazzclub.com | No — own site |
| Sam First | Arts District | ~250 | Newer venue, eclectic bookings | samfirst.com | No |

### Adapter strategy
- **Ticketmaster** covers Wiltern, Fonda, El Rey, Greek, Bellwether, Troubadour — just change city params
- **Goldenvoice** (AXS ticketing) covers Teragram, Regent, Fonda overlap — AXS has an API
- **Individual scrapers** needed for: Echo/Echoplex, Zebulon, Moroccan Lounge, Lodge Room, Mint, Catalina, Amoeba

---

## Comedy (10 venues)

| Venue | Neighborhood | Notable | Events page | Ticketmaster? |
|---|---|---|---|---|
| The Comedy Store | West Hollywood | Legendary, 3 rooms | thecomedystore.com/calendar | No — own ticketing |
| Laugh Factory | Hollywood | Major club since 1979 | laughfactory.com/clubs/hollywood | No — own site |
| The Improv (Hollywood) | Hollywood | Historic improv/standup | improv.com/hollywood | No — own site |
| Dynasty Typewriter | Westlake | Alt-comedy, podcasts, variety | dynastytypewriter.com | No — own site |
| UCB Theatre | Various | Improv institution (check if still open post-2022 closures) | Needs verification | No |
| Groundlings Theatre | Hollywood | Improv/sketch institution since 1974 | groundlings.com/shows | No — own site |
| The Ice House | Pasadena | Oldest comedy club in US (1960) | icehousecomedy.com | No — own site |
| Largo at the Coronet | West Hollywood | Alt-comedy, music, intimate | largo-la.com | No — own site |
| The Second City Hollywood | Hollywood | Improv/sketch (Chicago transplant) | secondcity.com/hollywood | No |
| Flappers Comedy Club | Burbank | Two rooms, open mics | flapperscomedy.com | No — own site |

### Adapter strategy
- Ticketmaster has limited comedy coverage in LA
- Most clubs use their own ticketing — scrapers needed for each
- Comedy Store, Laugh Factory, and Improv are highest priority (biggest draw)

---

## Lectures / Academic (7 sources)

| Venue/Source | Area | Type | Events page |
|---|---|---|---|
| UCLA Events Calendar | Westwood | University-wide public lectures | events.ucla.edu |
| USC Visions & Voices | University Park | Arts & humanities lecture series | visionsandvoices.usc.edu |
| Caltech Public Events | Pasadena | Science lectures, Watson lectures | events.caltech.edu |
| The Getty Center / Getty Villa | Brentwood / Pacific Palisades | Art lectures, talks | getty.edu/visit/events |
| LACMA (Los Angeles County Museum of Art) | Mid-Wilshire | Talks, film screenings | lacma.org/programs |
| The Broad | DTLA | Contemporary art talks | thebroad.org/programs |
| Hammer Museum | Westwood | Free public programs, lectures | hammer.ucla.edu/programs-events |

### Adapter strategy
- UCLA, Caltech likely have iCal feeds — check first
- Getty, LACMA, Hammer have well-structured event pages — scrapeable
- USC Visions & Voices is seasonal — may have iCal

---

## Dancing (10 venues)

| Venue | Neighborhood | Style | Events page |
|---|---|---|---|
| The Mayan | DTLA | Salsa Saturdays (major scene) | clubmayan.com |
| Candela La Brea | Mid-City | Salsa/bachata nightly socials | candelalabrea.com |
| Atomic Ballroom | Irvine (OC edge) | Swing, ballroom, Latin socials | atomicballroom.com |
| Millennium Dance Complex | North Hollywood | Hip-hop, contemporary classes | millenniumdancecomplex.com |
| Debbie Reynolds Dance Studio | North Hollywood | Ballroom, Latin, swing socials | (verify current status) |
| The Rustic | Santa Monica | Two-step, country dancing | Needs verification |
| Saddleback Swing (various) | Various | Swing dance socials | Needs verification |
| LA Swing Dance (various) | Various | Lindy hop, weekly socials | laswingdance.com |
| Salsa Vida LA | Various | Salsa socials at rotating venues | salsavida.com |
| Dance Arts Academy | Sherman Oaks | Ballroom, Latin socials | danceartsla.com |

### Adapter strategy
- Mayan and Candela are the anchor venues — scrape their calendars
- Swing/salsa communities often use Facebook or Meetup — harder to scrape
- Atomic Ballroom has a good calendar page
- This category will be thinner than SF initially

---

## Food Events (7 sources)

| Source | Area | Type | Events page |
|---|---|---|---|
| Smorgasburg LA | ROW DTLA | Weekly food market (Sundays) | smorgasburg.com/los-angeles |
| 626 Night Market | Various (Arcadia, Santa Anita) | Massive Asian night market, seasonal | 626nightmarket.com |
| Grand Central Market | DTLA | Food hall with occasional events | grandcentralmarket.com |
| LA Street Food Fest | Various | Annual festival | lastreetfoodfest.com |
| Eat See Hear | Various | Outdoor movies + food trucks | eatseeheear.com |
| Off the Grid (if LA presence) | Various | Food truck gatherings | Verify if active in LA |
| Eater LA Events | Citywide | Editorial aggregator | la.eater.com |

### Adapter strategy
- Smorgasburg and 626 Night Market are the heavy hitters — both have event pages
- 626 Night Market is seasonal (summer) — scraper needs to handle off-season gracefully
- Eater LA is an aggregator — could be a Funcheap-style scraper
- This category is naturally thinner (fewer recurring food events vs SF's Off the Grid)

---

## Priority tiers for LA launch

**Tier 1 (launch with these):**
- Ticketmaster (covers ~8 music venues + some comedy)
- Comedy Store, Laugh Factory, Improv (the big 3)
- UCLA + Caltech events (iCal if available)
- Smorgasburg + 626 Night Market
- The Mayan + Candela (dancing)

**Tier 2 (add after launch):**
- Individual music venue scrapers (Echo, Zebulon, Lodge Room, Moroccan, etc.)
- Getty, LACMA, Hammer lectures
- Groundlings, Dynasty Typewriter, Largo
- Atomic Ballroom, swing communities

**Tier 3 (stretch):**
- Amoeba in-store, smaller clubs
- Food truck aggregators
- USC events
