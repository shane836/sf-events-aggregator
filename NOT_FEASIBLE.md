# scrape:cinderellaballroom — NOT FEASIBLE

**Date:** 2026-05-24
**Verdict:** No public events listing exists for this venue. Scraper not built.
**Rubric clause:** Per task instructions ("If the site has no events page at all,
treat as 'not feasible' and report"). Also consistent with M3 ship gate, which
permits up to 3 of 21 scrapers to be marked `HUMAN-REVIEW-NEEDED` without
blocking the milestone.

---

## Discovery log

### Domain probes

| Domain | Result |
|---|---|
| `cinderellaballroomsf.com` | NXDOMAIN — DNS does not resolve. `dig +short` returns empty; `nslookup` returns `server can't find cinderellaballroomsf.com: NXDOMAIN`. |
| `www.cinderellaballroomsf.com` | Same NXDOMAIN. |
| `cinderellaballroom.com` | Resolves to `103.224.212.207` (Above.com domain-parking IP). Serves a fingerprint-then-redirect interstitial whose follow-through lands on a `forsale.min.js` parked-domain landing page hosted on `assets.abovedomains.com`. No event content of any kind. |
| `thecinderellaballroom.com` | DNS does not resolve. |
| `cinderellaballroomdance.com` | DNS does not resolve. |
| `sfcinderellaballroom.com` | DNS does not resolve. |

### Web search

Two queries to a general web search engine ("Cinderella Ballroom San Francisco
dance venue events website" and "Cinderella Ballroom SF venue Bayview Mission
Polk address") returned:

- Multiple unrelated `Cinderella` ballet productions at SF venues (Orpheum,
  War Memorial Opera House) — not the target venue.
- A Cinderella Ballroom in St. Cloud, FL — different city.
- A historical Cinderella Ballroom in Detroit, MI — different city, defunct.
- A Cinderella Ballrooms in San Antonio, TX — different city.
- A Facebook page `pages/category/Performance---Event-Venue/Cinderella-Ballroom-217370458298712/`
  with no accessible public content and no associated public events feed.

No San Francisco venue named "Cinderella Ballroom" with a live website, a
public events page, or a structured listing surface (JSON-LD, iCal, RSS) was
located. The Facebook page that uses the name has no public events feed and
Facebook scraping is explicitly out of scope for M3 (anti-bot circumvention
and social-media scraping are non-goals — see `rubrics/milestone-m3-scrapers.md`
"Explicit non-goals for M3").

### Robots / anti-bot

Not applicable — there is no event listing surface to even attempt to scrape.
The parked `cinderellaballroom.com` domain serves an Above.com fingerprint /
redirect interstitial, but that is parking infrastructure, not anti-bot
protection over a real site (B6 does not apply because there is no underlying
content).

---

## Recommendation

- Drop `scrape:cinderellaballroom` from the M3 scope.
- Replace with a different dance venue if dance coverage (C2: ≥ 20
  upcoming dance events in next 30 days) is still short after the other 5
  dance scrapers ship. Candidates surfaced during this investigation:
  - Verdi Club (already in scope as `scrape:verdiclub`).
  - Genesis Dancesport Studio (`genesisdancesport.com`).
  - Allegro Ballroom (Emeryville — out of SF, would skew geography).
- If a human can confirm the venue's actual web presence (e.g., it shows up
  on a printed flyer or a private Instagram), reopen and re-scope. As of
  this investigation, no public surface exists.

---

## Why no PR merge

Per task instructions: "If the site has no events page at all, treat as
'not feasible' and report (push branch with NOT_FEASIBLE.md, no merge)."
The branch `feat/source-cinderellaballroom` is pushed for visibility but
NOT merged. No `lib/sources/cinderellaballroom.ts` or test file was created
because there is nothing to scrape — shipping an empty / stub adapter would
violate A5/A6 (live ingest must succeed with ≥ 1 row) and pollute the source
registry.
