# Milestone M1-v2 — Contract Refactor Rubric

**Purpose:** Adopt the richer ingestion contract from
`docs/IDENTITY.md` without regressing M0/M1a. Every check below is a SQL
query, a deterministic test, or an exit code — no judgment.

**Context:** Replaces the day-level fingerprint + first-source-wins
behavior shipped in M1a with the three-layer identity model (source key,
canonical fingerprint, venue surrogate) + verification-level winner rule
+ single-writer persister.

**Iteration cap:** 3 per dimension. Past 3, mark `HUMAN-REVIEW-NEEDED`
in the status report and stop.

---

## Pre-flight (must be true before any code moves)

| # | Check | Pass |
|---|---|---|
| P1 | New fixture contains both Hannibal 7pm and 9:30pm rows | grep `pl-hannibal-7pm` and `pl-hannibal-930pm` both present |
| P2 | docs/IDENTITY.md exists in the worktree we're merging from | file exists, ≥ 150 lines |

P1/P2 are already PASS at rubric-write time.

---

## A. Merge + migration

| # | Failure mode | Check | Pass |
|---|---|---|---|
| A1 | Old types.ts left lingering in main | `grep -r "NormalizedRow" lib/ tests/ ingest/` | Empty (the type is replaced by `NormalizedEvent`) |
| A2 | Old normalize.ts left in main | `test -e lib/normalize.ts && echo FAIL \|\| echo PASS` | PASS (file deleted) |
| A3 | Migration generated cleanly | `npx drizzle-kit generate` exits 0 with one new migration file | Exit 0; new `drizzle/0001_*.sql` exists |
| A4 | Migration applies to Neon | `npm run db:migrate` | Exits 0; subsequent `\d events` shows `canonical_fingerprint`, `timezone`, `verification_level`, `secondary_sources`, `series_id`; `\d venues` shows `normalized_name`; `\d ingestion_runs` exists |
| A5 | No stale `price_display` writes | grep persister + adapters for `price_display` or `priceDisplay`: should appear ONLY in `lib/format/price.ts` and UI code | Match pattern |

## B. Identity invariants (pure-function tests, no DB)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| B1 | Same-night same-act collision | Unit test: fingerprint(Hannibal, Punch Line, 7pm) ≠ fingerprint(Hannibal, Punch Line, 9:30pm) | Assertion holds |
| B2 | UTC date drift on local-evening events | Unit test: event at `2026-06-04T20:00 America/Los_Angeles` → `formatLocalDate()` returns `2026-06-04` (not `2026-06-05`) | Assertion holds |
| B3 | Diacritics collapse | Unit test: fingerprint(title="Café X") == fingerprint(title="Cafe X") with same venue/time/tz | Assertion holds |
| B4 | Punctuation preserved (no false merge) | Unit test: fingerprint(title="K.Flay") ≠ fingerprint(title="K Flay") | Assertion holds |
| B5 | Cross-source same-event collapse | Unit test: two adapters producing same title+venue+local-minute+tz yield identical fingerprints | Assertion holds |
| B6 | Adapter never returns null/empty `sourceUrl` | UCSF adapter test: emit ≥ 5 RawEvents from a fixture, assert each has non-empty `identity.sourceUrl` | Assertion holds |
| B7 | UCSF normalize is pure | Run normalize() twice with same input + same provenance → byte-identical NormalizedEvent | Deep-equal passes |

## C. Persister behavior (DB-touching)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| C1 | Single writer | `grep -rn "db.insert\|db.update\|db.delete" lib/ ingest/` | Only matches in `lib/persist.ts` (adapters, runner, ical.ts, format/price.ts must be clean) |
| C2 | Race-safe venue upsert | After two parallel `persist(event)` calls with same venue name, `select count(*) from venues where normalized_name=$1` returns 1 | Returns 1 |
| C3 | Winner rule on fingerprint conflict | Insert event A (`verification_level='community'`) then event B (same fingerprint, `verification_level='official'`); read back and confirm B's title/url stuck and A is in `secondary_sources` jsonb | Confirmed |
| C4 | Loser rule on lower verification | Insert event B first (official), then A (community, same fingerprint); read back and confirm B's title stuck, A is in `secondary_sources` | Confirmed |
| C5 | `ingestion_runs` populated | After one runner pass, `select count(*) from ingestion_runs where source='ical:ucsf'` ≥ 1 | ≥ 1 |

## D. End-to-end (UCSF re-ingest)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | Pipeline crashes | `npm run ingest ucsf` exit code | 0 |
| D2 | Schema invariants on inserted rows | `select count(*) from events where source_url is null or canonical_fingerprint is null or timezone is null or verification_level is null` | 0 |
| D3 | No duplicate canonical fingerprints | `select count(*) from (select canonical_fingerprint from events group by 1 having count(*) > 1)` | 0 |
| D4 | Dedup on re-run | Run UCSF again, capture inserted count | `inserted: 0` (all existing rows match by canonical_fingerprint) |
| D5 | Timezone populated | `select count(*) from events where timezone != 'America/Los_Angeles'` | 0 (all UCSF events are PT) |
| D6 | Local-date sanity | Pick 10 events with start_time near 20:00 PT, confirm `formatLocalDate(start_time, timezone)` matches local day from raw iCal DTSTART | Hand-spot |

## E. Build / typecheck / tests

| # | Failure mode | Check | Pass |
|---|---|---|---|
| E1 | tsc errors | `npm run typecheck` | Exit 0 |
| E2 | Build broken | `npm run build` | Exit 0 |
| E3 | Test suite broken | `npm test` | All green |
| E4 | Old fixture shape left in code | `grep -rn "sourceId\|startTime\":" fixtures/ tests/` (the old shape used `sourceId` and `startTime`) | Empty in fixtures/ (new shape: `externalId`, `startTimeUtc`) |

---

## Ship gate for M1-v2

**Must PASS:** A1, A2, A3, A4, A5, B1, B2, B5, B6, C1, C2, C3, C4, D1, D2, D3, D4, D5, E1, E2, E3.

**Soft:** B3, B4, B7, C5, D6, E4 (mostly informational — flag failures, ship with explanation if there's a reason).

---

## Revision protocol

A failed dimension produces an instruction citing the specific query/test and the observation:

> "B1 FAILED: fingerprint('Hannibal Buress', 'Punch Line SF', 7pm) and (..., 9:30pm) returned the same hash. Inspect lib/identity.ts: minute granularity not being applied. Check `formatLocalMinute()` is reading `hour`+`minute` parts, not slicing to date only."

NOT:

> "Fix the fingerprint."

Same generator/evaluator separation as prior rubrics — the agent that writes the code does not get to grade its own ingestion run by re-reading the diff. Run the SQL queries from a fresh psql or one-off node script.

---

## Explicit non-goals for M1-v2

- Adding Ticketmaster or any new sources (those happen *after* the contract lands)
- GitHub Actions cron (M1c)
- UI rendering of `formatPriceDisplay()` (M2)
- Email digest (M4)
- Performance tuning of the upsert path (revisit if Q4-style alerts fire)
