# Ingestion error review — October 19, 2026

Reviewed all 3,649 stored ingestion runs (May 25–October 19), all 17,784 stored errors, the latest Actions jobs and failed-job logs, and the last 15 workflow conclusions. All 15 workflows failed. Today: 7 failed adapters, 3 additional adapters with errors despite passing, and 15 adapters without recorded errors.

Latest workflow: https://github.com/shane836/sf-events-aggregator/actions/runs/39293055622

Production ingestion commit: `e29e54ca096f4e4cf2977770d09a369be072035d`. GitHub comparison confirms its only difference from this checkout is README disclosure text. The reviewed ingestion code therefore matches that run.

Database reads used read-only transactions. No ingestion was rerun and no production data or application code was changed. This report covers recorded errors; successfully parsed but incorrect or silently omitted events require a separate data-quality audit. Older Actions logs were not exhaustively downloaded.

## Current errors and actions

| Priority | Source | Today's errors | Evidence and recommended action |
|---|---|---:|---|
| P1 | Ticketmaster | 177 | Event inserts fail. Sampled source ID already exists with a different fingerprint. Reconcile immutable source identity before cross-source fingerprint matching. 24 inserts succeeded, so Actions passed. |
| P1 | UCSF | 24 | Same insert failure pattern; sample source ID exists with a different fingerprint. 687 records skipped, no inserts; Actions failed. |
| P1 | Independent | 10 | 8 updates and 2 inserts failed. Updates can attempt to promote a source identity already owned by another row. Resolve both unique keys transactionally. 3 inserts succeeded, so Actions passed. |
| P1 | Great American Music Hall | 1 | Insert failure; sample source ID exists under a different fingerprint. One insert succeeded, so Actions passed. |
| P1 | Cheaper Than Therapy | 1 | Parser expects a top-level array. Live response is HTTP 200 with `{ "events": [...] }`. Update response parsing and test the response envelope. 129 failed runs since June 13. |
| P1 | Eventbrite | 12 | All 12 city discovery requests returned HTTP 405. Zero events fetched. Restore an accessible supported data source or explicitly record this adapter as unavailable; repeated identical requests will not repair it. |
| P1 | Spark Social | 1 | Eventbrite discovery URL returns HTTP 405; zero events fetched. Shares the Eventbrite access problem. |
| P1 | Freight | 1 | HTTP 403; live check returns a “Just a moment...” page. All 126 recorded runs failed. Seek an accessible venue feed or permission; do not bypass the block. |
| P1 | ODC | 1 | Listing URL `/calendar/events` returns HTTP 404, also reproduced live. This failure began October 8 and appears in 12 runs. Discover the current listing/feed and validate its parser. |
| P2 | Dance Mission | 1 | Actions received HTML where JSON was expected. The same endpoint returned HTTP 200 and a valid JSON array from this machine. Check response content type and bounded body diagnostics; investigate intermittent or runner-specific responses before changing the parser. |
| | **Total** | **229** | **212 persistence errors; 17 fetch/parse errors.** |

## Shared persistence defect

`lib/persist.ts:96–105` searches only `canonical_fingerprint`. Its insert handles conflicts only on that key (`:136`), although the schema also makes `(source, external_id)` unique. When title, venue name, or start time changes, the new fingerprint misses the existing row and the insert collides with its immutable source identity. Higher-verification promotion can also assign an identity already held by another canonical row.

Read-only examples from today's failed inserts:

| Source / external ID | Stored fingerprint | Incoming fingerprint |
|---|---|---|
| Ticketmaster / `rZ7HnEZ1Af-z-d` | `cecf99f9c97a820df205afee86f0ac2f` | `c7330893be8353f69a7bf0c93c20743b` |
| UCSF / `tag:localist.com,2008:EventInstance_53069272965300` | `37dcdfb1126e544014a50de8452389ea` | `46b79a1d6f607728f93a6d6a2bcacfd1` |
| GAMH / `701664` | `3bfff8079c6fe3dfe362ce8efac9d2e7` | `7f2bf8b24442acbcd69a1b47b2f48ee7` |

The same pattern is visible in historical insert samples from Chapel, Funcheap Food, Punchline, and SF Comedy College. This establishes the defect for sampled records, not a diagnosis of every historical database exception. Of 17,784 total errors, 16,165 (90.9%) are database query failures. The original PostgreSQL SQLSTATE and constraint name are unavailable because the runner saves only the outer error message (`lib/runner.ts:83`). Preserve sanitized nested database causes before attributing the entire count to one constraint.

Recommended repair: reconcile source identity and canonical identity in a transaction, define how competing existing rows merge, and preserve source attribution. Do not remove the uniqueness constraint or discard failed writes. Regressions should cover source edits, promotion into an already-owned identity, and concurrent writes.

## Reporting and recovery gaps

- A source with any new insert can pass with hundreds of errors (`ingest/run.ts:26`). The database also labels partial failures “completed.” Introduce an explicit partial/degraded outcome and surface error totals in the workflow summary.
- Database status considers `updatedHigher`; CLI exit status does not (`lib/runner.ts:117` versus `ingest/run.ts:26`). The two can disagree.
- Normalization exceptions are reported as persistence errors because both operations share one catch. Every persistence error is labeled non-retryable, even though connection failures can be transient.
- The `retryable` flag is metadata only: neither the runner nor workflow implements retries. Historical rate limits include 62 Ticketmaster, 16 UCSF, and 2 SF Comedy College HTTP 429 errors. Implement bounded orchestration-level retry/backoff for transient failures, respecting the identity document's rule against in-adapter retry loops.
- Two runs remain `running` from June 15: Ticketmaster at 04:55 UTC and Verdi Club at 04:58 UTC. Add stale-run handling and lifecycle cleanup. No records were changed during this review.

## Complete source history

“Failed runs” is the stored status; partial failures may be marked completed. Historical errors include repeats of the same event across days. Counts are not unique lost events.

| Source | Runs | Failed runs | Historical errors | Latest errors |
|---|---:|---:|---:|---:|
| OMCA | 126 | 23 | 26 | 0 |
| UCSF | 149 | 36 | 2,211 | 24 |
| Alonzo King | 150 | 0 | 0 | 0 |
| Bimbo's | 149 | 74 | 214 | 0 |
| Chapel | 149 | 7 | 56 | 0 |
| Cheaper Than Therapy | 150 | 129 | 129 | 1 |
| Cobb's | 148 | 8 | 21 | 0 |
| Dance Mission | 149 | 98 | 136 | 1 |
| Eventbrite | 125 | 118 | 1,074 | 12 |
| Freight | 126 | 126 | 126 | 1 |
| Funcheap East Bay | 125 | 0 | 0 | 0 |
| Funcheap Food | 150 | 0 | 17 | 0 |
| GAMH | 149 | 55 | 133 | 1 |
| Independent | 150 | 84 | 513 | 10 |
| Mission Market | 152 | 2 | 3 | 0 |
| ODC | 150 | 93 | 160 | 1 |
| Off the Grid | 150 | 0 | 0 | 0 |
| Punchline | 149 | 4 | 155 | 0 |
| Rhythm & Motion | 149 | 1 | 1 | 0 |
| Secret Improv | 150 | 0 | 0 | 0 |
| SF Comedy College | 150 | 10 | 10 | 0 |
| Spark Social | 152 | 130 | 131 | 1 |
| The Setup | 151 | 3 | 3 | 0 |
| Verdi Club | 152 | 17 | 19 | 0 |
| Ticketmaster | 149 | 10 | 12,646 | 177 |
| **Total** | **3,649** | **1,028** | **17,784** | **229** |

Historical error classes, covering all 17,784 entries:

- Database queries: 16,165. Inserts: UCSF 2,195; Ticketmaster 12,584; ODC 148; Independent 67; GAMH 133; Bimbo's 20; Chapel 56; Cobb's 1; Eventbrite 6; Dance Mission 86; Funcheap Food 17; Verdi Club 5; OMCA 24; Punchline 155; SF Comedy College 8. Updates: Independent 446; Cobb's 20; Bimbo's 194.
- Eventbrite/Spark HTTP 405: 1,062 / 129. HTTP 403: Eventbrite 6, Spark 1, Freight 126.
- Cheaper Than Therapy response-shape errors: 129.
- Dance Mission: 46 HTML-as-JSON errors and 4 network failures.
- Rate limits: Ticketmaster 62; UCSF 16; SF Comedy College 2.
- ODC HTTP 404: 12.
- Verdi Club missing JSON-LD: 13; Spark missing detail-page Event JSON-LD: 1.
- Other transient errors: OMCA HTTP 504 twice; Mission Market network failure twice and HTTP 522 once; Rhythm & Motion network failure once; The Setup timeout three times; Verdi Club timeout once.

## Verification

`npm test -- tests/sources`: **326 passed, 5 failed**, across 25 files. All failures are in `tests/sources/offthegrid.test.ts`. May 2026 fixture dates are rejected by `mapEvent`, which compares against `Date.now()` (`lib/sources/offthegrid.ts:219`) despite receiving a fixed `fetchedAt`. This makes those tests expire with wall-clock time; it is separate from today's recorded production errors. Freeze the test clock or use the supplied reference date consistently.

Passing fixture parser tests did not catch the changed Cheaper Than Therapy response envelope, unreachable URLs, or runner-specific HTTP responses. Add focused response-contract tests alongside the persistence regression tests. Run read-only live source checks separately from tests that write to the database.

Recommended order: repair persistence and its diagnostics; restore Cheaper Than Therapy; retarget ODC; resolve blocked Eventbrite/Spark/Freight sources; investigate Dance Mission responses; improve partial-failure reporting, retry policy, stale-run cleanup, and clock-dependent tests.

## Persistence repair prepared locally

Implemented the first repair in `lib/persist.ts`, with update counters in `lib/runner.ts` and `ingest/run.ts`. Source matches refresh the existing event and retain its ID. Matching source and canonical identities are locked during a transaction, while unrelated events can ingest concurrently. Each statement has a 30-second timeout and lock waits have a 10-second timeout.

If source identity, secondary attribution, and fingerprint identify different existing events, the record produces an `identity_conflict` error for review. A secondary whose fingerprint changed also requires review. The runner continues processing other records. There is no automatic deletion or consolidation of existing events. Promotions preserve the former primary's attribution, concurrent secondary writes retain all sources, and successful source updates count toward the existing run-success policy.

Schema, constraints, event API, frontend, and source adapters are unchanged. Database-cause diagnostics, degraded-run reporting, and the other repairs above remain follow-up work. This patch has not been committed, deployed, or run against production for writes.

Validation:

- Added 12 PostgreSQL regression cases before implementation: 10 failed and 2 passed on the original code. All 12 pass with the repair, without changing their assertions.
- Broader library/source tests: 353 passed; the same 5 pre-existing Off the Grid fixture failures remain.
- Changed-file ESLint and `git diff --check`: passed.
- `npm run build`: passed.
- `npm run typecheck`: fails in unchanged `tests/e2e/perf-d5.spec.ts:36`: `'durationThreshold' does not exist in type 'PerformanceObserverInit'`.
- Copied 4 representative production events and their 4 venues using a read-only transaction. In separate local PostgreSQL, replayed edits and repeated persistence for UCSF, GAMH, Independent, and Ticketmaster. All original event IDs survived; 4 input rows remained 4 rows. This was a sample copy, not a full database clone or full source ingestion.
- Started the built app against the copied database. `/api/events` returned HTTP 200 with all 4 events; `/` returned HTTP 200 and rendered the edited event data.

The integration test file mocks the application database client and requires `PERSIST_TEST_DATABASE_URL`. It rejects hosts other than localhost/127.0.0.1 and database names other than `sf_events_ingestion_test`. Each invocation requires a fresh disposable database; setup deliberately fails if the schema already exists. Ordinary test runs report these cases as skipped unless that variable is supplied.

Reproduce using an unused localhost port and a disposable PostgreSQL container:

```sh
docker run --rm --detach --name sf-events-ingestion-review \
  --publish 127.0.0.1:55439:5432 \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=sf_events_ingestion_test postgres:16
# Wait for PostgreSQL readiness before invoking Vitest.
docker exec sf-events-ingestion-review pg_isready -U postgres
PERSIST_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/sf_events_ingestion_test \
  npm test -- tests/lib/persist.test.ts
docker stop sf-events-ingestion-review
```

Before production rollout, resolve the existing verification failures, take a production recovery point, and ensure an old ingestion workflow is not still writing. Run one affected source first and compare IDs, error counts, and calendar output before restoring the full schedule. Reverting code alone cannot undo event edits; retain the database recovery point.
