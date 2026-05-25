# Milestone M1 — Ingestion v1 Rubric

**Purpose:** Verify the daily ingestion pipeline reliably pulls from Tier-1 APIs (Ticketmaster, SeatGeek) and Tier-2 iCal feeds (universities + sfjazz + sfsymphony), normalizes to the canonical schema, deduplicates, and writes to Neon — without crashing and without producing garbage rows.

**Method discipline:** Every dimension is checked by a SQL query, a deterministic script, or an HTTP response code. No "looks reasonable" judgment in this rubric.

**Iteration cap:** 3 per dimension. After 3 failed revisions on the same dimension, mark `HUMAN-REVIEW-NEEDED` in the status report.

---

## Sources in scope for M1

- **APIs (Tier-1):** Ticketmaster Discovery, SeatGeek
- **iCal (Tier-2):** Stanford, UC Berkeley, UCSF, USF, SF State, CCA, SF Jazz, SF Symphony (8 feeds)

Tier-3 scrapers belong to M3 and are explicitly OUT OF SCOPE here.

---

## Dimensions

### Pipeline correctness

| # | Failure mode | Check | Pass criterion |
|---|---|---|---|
| M1-1 | Source job crashes | Each `npx tsx ingest/sources/<src>.ts` exits 0 | All 10 sources exit 0 OR each non-zero exit is explained by a categorized error class (HTTP 5xx, parse error, network) |
| M1-2 | Schema violation | SQL: `select count(*) from events where source_url is null or trim(source_url)='' or price_display is null or trim(price_display)=''` | Returns 0 |
| M1-3 | Required field missing on insert | SQL: `select count(*) from events where title is null or start_time is null or venue_id is null or category is null` | Returns 0 |
| M1-4 | **D4 dedup — duplicate events** | SQL: `select count(*) from (select fingerprint, count(*) c from events group by fingerprint having count(*) > 1) x` | Returns 0 |
| M1-5 | Dedup on re-run | Run same source twice back-to-back; capture `events` row count before and after second run | Second run inserts 0 NEW rows (or only legitimately new ones if source itself added events) |
| M1-6 | Bad timezones / dates in past | SQL: `select count(*) from events where start_time < now() - interval '7 days' or start_time > now() + interval '730 days'` | Returns 0 |
| M1-7 | Wrong category for source | Sample 20 rows per source; manually verify category matches source's known content type | ≥ 18/20 per source correct |

### Source coverage (M1 partial gate — M3 expands)

| # | Failure mode | Check | Pass criterion |
|---|---|---|---|
| M1-8 | Music category empty | SQL: `select count(*) from events where category='music' and start_time > now() and start_time < now() + interval '30 days'` | ≥ 20 (Ticketmaster + SeatGeek + SF Jazz + SF Symphony) |
| M1-9 | Lectures category empty | Same SQL, `category='lectures'` | ≥ 10 (6 universities combined) |
| M1-10 | Comedy category | Same SQL, `category='comedy'` | Partial OK in M1 — Tier-3 scrapers fill this in M3. Document current count; do not gate ship. |
| M1-11 | Dancing category | Same SQL, `category='dancing'` | Partial OK in M1 — same as above. |
| M1-12 | Food category | Same SQL, `category='food'` | Partial OK in M1 — same as above. |

### Pipeline health (Q-dimensions from the master spec)

| # | Failure mode | Check | Pass criterion |
|---|---|---|---|
| Q1 | Pipeline crashed mid-run | Exit code per source job in GitHub Actions output | All jobs exit 0 OR error categorized |
| Q2 | Source went empty unexpectedly | After 7 runs, compare row count per source vs rolling 7-day avg | New count within ±50% of avg (cold-start exception: first 2 runs) |
| Q3 | Required fields missing | Reused M1-2 + M1-3 | Same |
| Q4 | Bad timezones | Reused M1-6 | Same |
| Q5 | Dead links from a source | HEAD-request 10 random new events per run | ≥ 9/10 return 200/3xx |

### Infrastructure

| # | Failure mode | Check | Pass criterion |
|---|---|---|---|
| M1-13 | GitHub Actions workflow doesn't exist | `test -f .github/workflows/ingest.yml` | File exists |
| M1-14 | Cron schedule wrong | grep workflow for cron expression matching 4am Pacific (12:00 UTC during PDT, 11:00 UTC during PST — document choice) | Match found; timezone choice explicit |
| M1-15 | DB secret not in repo | `git grep -E 'postgres://[^@]+@' || echo CLEAN` | "CLEAN" only |
| M1-16 | Build broken by ingest code | `npm run build && npm run typecheck` | Both exit 0 |

---

## Ship gate for M1

**Must PASS:** M1-1, M1-2, M1-3, M1-4, M1-5, M1-6, M1-8, M1-9, M1-13, M1-14, M1-15, M1-16, Q1, Q3, Q4, Q5.

**Soft (informational, do not block):** M1-7, M1-10, M1-11, M1-12, Q2 (needs 7 days of history).

---

## Revision protocol

A revision instruction MUST cite the failing dimension and the specific evidence. Example:

> "M1-4 FAILED: SQL returned 12 duplicate fingerprints. Sample row: fingerprint='abc123' has 2 events with source='ical:stanford' and source_id='evt_998'. Inspect ingest/lib/upsert.ts — likely the ON CONFLICT clause is keyed on the wrong column."

NOT:

> "Fix the duplicate bug."

Generator and evaluator must not share context: the agent that writes the source code does not get to grade its own ingestion run by skimming output. The evaluator opens a fresh psql session and runs the queries.

---

## Out of scope for M1

- Tier-3 scrapers (comedy, dance, music gap-fill, food) — M3
- Calendar UI rendering — M2
- Email digest — M4
- Lighthouse / perf — M5
