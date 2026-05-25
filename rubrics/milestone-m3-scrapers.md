# Milestone M3 — Tier-3 Scrapers Rubric

**Purpose:** Fill the Tier-3 gap so D2 (event coverage per category, from `docs/SPEC.md`) goes from "music + lectures populated" to "all 5 categories ≥ threshold." Up to 21 hand-written scrapers across comedy, dance, music gap-fill, and food.

**Inherits:** `SourceAdapter` contract (`lib/sources/types.ts`), identity invariants (`docs/IDENTITY.md`), single-writer rule, D12/D13 (non-empty `sourceUrl` + structured `pricing`). If a scraper would violate any of those, it fails the milestone — no exceptions.

**Method discipline:** Every dimension is a SQL query, an exit code, an HTTP HEAD, or a deterministic test. The only "judgment" calls are the categorization spot checks (D5) and the per-scraper anti-bot decision (B6).

**Iteration cap:** 3 per dimension per source. After 3 failed revisions on the same dimension, mark `HUMAN-REVIEW-NEEDED` in the status report and move on. A single broken scraper does NOT block the milestone — see ship gate.

---

## Sources in scope for M3

**Comedy (6):**

| ID | Site |
|---|---|
| `scrape:punchline` | punchlinecomedyclub.com |
| `scrape:cobbs` | cobbscomedy.com |
| `scrape:thesetup` | thesetupsf.com |
| `scrape:cheaperthantherapy` | cheaperthantherapysf.com |
| `scrape:sfcomedycollege` | sfcomedycollege.com |
| `scrape:secretimprov` | secretimprov.com |

**Dance (6):**

| ID | Site |
|---|---|
| `scrape:odc` | odc.dance |
| `scrape:alonzoking` | linesballet.org |
| `scrape:dancemission` | dancemission.com |
| `scrape:rhythmmotion` | rhythmandmotion.com |
| `scrape:verdiclub` | verdiclub.net |
| `scrape:cinderellaballroom` | cinderellaballroomsf.com |

**Music gap-fill (4):**

| ID | Site |
|---|---|
| `scrape:gamh` | gamh.com (Great American Music Hall) |
| `scrape:independent` | theindependentsf.com |
| `scrape:chapel` | thechapelsf.com |
| `scrape:bimbos` | bimbos365club.com |

**Food (5):**

| ID | Site |
|---|---|
| `scrape:offthegrid` | offthegrid.com |
| `scrape:sparksocial` | sparksocialsf.com |
| `scrape:missionmarket` | missioncommunitymarket.org |
| `scrape:eatersf` | sf.eater.com |
| `scrape:funcheapfood` | sf.funcheap.com/category/food |

**Total: 21 `SourceAdapter`s.**

---

## Pre-flight (must be true before code moves)

| # | Check | Pass |
|---|---|---|
| P1 | Cheerio is in deps | `grep '"cheerio"' package.json` matches |
| P2 | Playwright is available OR documented as per-scraper install | `grep '"playwright"' package.json` matches, OR a `// SCRAPING.md` note explains the deferred-install policy |
| P3 | M1-v2 contract is on main | `git log --oneline -5` shows commit `52c8944` (or later) on main |
| P4 | `lib/scrape.ts` helper exists with `fetchHtml(url, { ua })` and a shared cheerio loader | `test -f lib/scrape.ts` AND `grep 'export.*fetchHtml' lib/scrape.ts` |

P4 is a NEW shared helper — the first scraper agent to ship should add it; subsequent agents import from it. Pattern mirrors `lib/ical.ts` (`fetchICalEvents`).

---

## A. Per-scraper acceptance (apply to each of the 21)

Pass = test green + typecheck green + ingest exit 0 + ≥ 1 row inserted + 0 rows on re-run.

| # | Failure mode | Check | Pass |
|---|---|---|---|
| A1 | Adapter file missing | `test -f lib/sources/<name>.ts` | exists |
| A2 | Test file missing | `test -f tests/sources/<name>.test.ts` | exists |
| A3 | Test fails | `npm test -- <name>` | exits 0 |
| A4 | Typecheck fails | `npm run typecheck` | exits 0 |
| A5 | Live ingest crashes | `npm run ingest <name>` | exits 0 |
| A6 | Live ingest returns zero | parse JSON output | `inserted > 0` on first run |
| A7 | Dedup broken | re-run immediately after A6 | `inserted = 0` on second run |
| A8 | Adapter touches DB directly | `grep -E "from .*db/" lib/sources/<name>.ts` | empty |
| A9 | Cross-adapter import | `grep "lib/sources/" lib/sources/<name>.ts` | only `types.ts` |
| A10 | `normalize()` does IO | code inspection — `normalize()` is sync, no `fetch`, no `await` | confirmed |
| A11 | Adapter id mismatches file slug | `grep "id:" lib/sources/<name>.ts` matches `scrape:<name>` | confirmed |

## B. Scrape-specific failure modes (cross-cutting)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| B1 | Brittle single-selector | adapter uses semantic data first (JSON-LD, microdata, `og:` meta), falls back to CSS only when needed | code inspection per source |
| B2 | Robots.txt ignored | `curl -s https://<host>/robots.txt` shows the scraped path is NOT in a `Disallow` rule for `*` or common UAs | per-source check; sources that disallow are dropped from scope with a note in the PR |
| B3 | Hammering / multiple network calls per run | adapter does at most ONE listing-page fetch per ingest; detail-page fetches are batched and capped at 20 | code inspection |
| B4 | JS-required page returns empty HTML | first ingest returns 0 + `curl -s <url> \| grep -ci '<script'` is high + body lacks event text | escalate to Playwright fallback; document choice in adapter file |
| B5 | User-Agent missing | adapter's fetch sets a UA identifying the project (e.g., `sf-events-aggregator/1.0 (+https://github.com/shane836/sf-events-aggregator)`) | `grep -i "user-agent" lib/sources/<name>.ts` |
| B6 | Anti-bot block (Cloudflare interstitial, 403, 503, "Just a moment") | first ingest returns block markers in response body | document as `HUMAN-REVIEW-NEEDED`, do NOT bypass; abort and report. Bypass is explicitly out of scope. |
| B7 | Timezones wrong | scraped times stored in UTC, but `timezone` field set to `America/Los_Angeles` | per-row check; B7 fails if any scraped row has `timezone != 'America/Los_Angeles'` |

## C. Category coverage (the headline outcome — D2 from master rubric)

After all surviving scrapers have ingested at least once, run these against Neon. THIS is what M3 is for.

| # | Failure mode | Check | Pass |
|---|---|---|---|
| C1 | Comedy thin | `select count(*) from events where category='comedy' and start_time > now() and start_time < now() + interval '30 days'` | ≥ 20 |
| C2 | Dancing thin | same query, `category='dancing'` | ≥ 20 |
| C3 | Music thin | same query, `category='music'` | ≥ 20 (master spec D2 threshold — gap-fill scrapers do the work since no API/iCal music sources exist post-M1) |
| C4 | Food thin | same query, `category='food'` | ≥ 10 (master spec lower threshold) |

## D. Schema invariants (inherits from M1 / IDENTITY.md)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | `source_url` missing/empty on any scraped row | `select count(*) from events where source like 'scrape:%' and (source_url is null or trim(source_url)='')` | 0 |
| D2 | Pricing outside valid representation | `select count(*) from events where source like 'scrape:%' and not (is_free=true or price_min is not null or price_max is not null or (price_min is null and price_max is null and is_free=false))` | 0. Canonical states: free, priced, or null+null+false = "Price varies" (per SPEC's `formatPriceDisplay` outputs) |
| D3 | Duplicate canonical_fingerprint introduced | `select count(*) from (select canonical_fingerprint from events where source like 'scrape:%' group by 1 having count(*)>1)` | 0 |
| D4 | venue_id unresolved | `select count(*) from events e left join venues v on v.id=e.venue_id where e.source like 'scrape:%' and v.id is null` | 0 |
| D5 | Wrong category | sample 20 rows per category from scraped sources, manual spot check against `source_url` | ≥ 18/20 per category correct |
| D6 | Past-dated events inserted | `select count(*) from events where source like 'scrape:%' and start_time < now() - interval '7 days'` | 0 |

## E. Link health (D3 / Q5 from master rubric)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| E1 | Dead `source_url` | HEAD-request 10 random rows per scraped source | ≥ 9/10 return 200/3xx |
| E2 | Redirect loop | HEAD with `--max-redirs 5` | no `(28)` or `(47)` errors |

## F. CI / pipeline integration

| # | Failure mode | Check | Pass |
|---|---|---|---|
| F1 | Scraper not added to GitHub Actions matrix | `grep 'scrape:<name>' .github/workflows/ingest.yml` matches each shipping scraper, OR matrix auto-discovers from `lib/sources/` | matches OR auto-discovery present |
| F2 | Build / typecheck broken at end of M3 | `npm run build && npm run typecheck` | both exit 0 |
| F3 | Test suite broken | `npm test` | all green |
| F4 | Production deploy broken | Vercel deploy on `main` succeeds after the last M3 merge | green deployment in Vercel dashboard |

---

## Ship gate for M3

**MUST PASS:** A1–A11 for ≥ **18 of 21** scrapers, B1, B2, B5, B7, C1, C2, C4, D1, D2, D3, D4, D6, E1, F2, F3, F4.

**SOFT (informational, do not block):**
- C3 (music gap-fill is opportunistic — venue overlap with future API integrations may suppress new inserts after dedup)
- D5 (categorization spot check; flag misses, ship if pattern isn't systemic)
- B6 (anti-bot blockers are documented and skipped, not "fixed")
- F1 (workflow file can be updated in a follow-up PR if matrix auto-discovers from `lib/sources/`)

**Threshold rationale (18/21):** Tier-3 scrapers are fragile by nature (`docs/SPEC.md` line 488: "expect 1-2 scrapers to break per month"). Gating on "every scraper works" guarantees one broken venue blocks the milestone. 18/21 ≈ 86% surface coverage at ship; the remaining 3 get `HUMAN-REVIEW-NEEDED` notes and become follow-up issues.

---

## Revision protocol

A revision instruction MUST cite the failing dimension and the specific evidence. Example:

> "A6 FAILED for `scrape:cobbs`: `npm run ingest cobbs` returned `{inserted: 0, fetched: 0, errors: [{message: 'cheerio selector \".event-list .show\" returned 0 nodes'}]}`. Open cobbscomedy.com/events, inspect the actual DOM, replace the selector. Prefer JSON-LD `<script type=\"application/ld+json\">` or `og:` meta tags before brittle CSS classes."

NOT:

> "Fix the Cobb's scraper."

Generator and evaluator must not share context: the agent writing the adapter does NOT get to grade its own ingestion run by skimming output. The evaluator opens a fresh psql session / fresh shell, runs the checks listed above, and produces the next revision instruction (or marks PASS).

---

## Workflow per scraper (recap of `docs/ADD-A-SOURCE.md`)

```bash
cd /Users/shanemason/Documents/Claude/code/sf-events-aggregator
git worktree add .claude/worktrees/source-<name> -b feat/source-<name>
cd .claude/worktrees/source-<name>
npm install
cp ../../.env.local .env.local  # DATABASE_URL for ingest
# implement lib/sources/<name>.ts + tests/sources/<name>.test.ts
npm test -- <name> && npm run typecheck
npm run ingest <name>
git add lib/sources/<name>.ts tests/sources/<name>.test.ts
git commit -m "feat(ingest): add <name> scraper"
git push -u origin feat/source-<name>
gh pr create --fill
gh pr merge --squash --delete-branch   # after CI green
cd ../../..
git worktree remove .claude/worktrees/source-<name>
```

One agent per scraper, dispatched in parallel.

---

## Explicit non-goals for M3

- **Anti-bot circumvention.** B6 documents and aborts. Headless-browser stealth, residential proxies, CAPTCHA-solving — out of scope.
- **Instagram / TikTok scraping.** Food gap is real (SPEC line 196), but social-media scraping is out.
- **Geocoding from scratch.** Use venue's known address; hardcode lat/lng per adapter if needed. Venue resolution is the persister's job.
- **GitHub Actions cron refactor.** F1 is soft; the workflow file can be updated in a follow-up PR.
- **Scraper retry orchestration.** The runner handles per-source error capture. Adapters do not implement retry loops.
- **Playwright by default.** Cheerio first. Switch only when B4 forces it.
