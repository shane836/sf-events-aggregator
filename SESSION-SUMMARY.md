# SF Events ingestion — final validation and recovery

**2026-10-23, America/Los_Angeles.** Shane authorized final validation, verified recovery, and pushing the intended changes to `main`.

## Current release checkpoint

- Fast-forwarded to `origin/main` at `0f30740`, preserving the two remote README commits and unrelated local changes.
- Committed regression tests separately from implementation. An isolated replay of the original runner and source implementations produced **12 failing / 22 passing tests**; the same assertions pass with the fixes. The October 19 persistence baseline below records **10 failing / 2 passing tests** before that repair.
- Release scope: transactional identity reconciliation, attribution preservation, explicit partial outcomes, sanitized SQLSTATE diagnostics, bounded fetch retries, stale-run cleanup, Cheaper Than Therapy response envelope, ODC calendar URL/deduplication, workflow single-source selection and failure summaries, and associated tests.
- Corrected two existing validation issues: the Event Timing observer's TypeScript options and a feed-heading assertion that still expected “Upcoming Fun” instead of the current “Upcoming Events.” Froze Off the Grid fixture time without weakening its event assertions.
- README disclosure now includes Codex code assistance.

## Final verification

| Check | Result |
|---|---|
| Library/source selection with isolated PostgreSQL 17 | **372 passed**, including all **13 persistence tests** |
| Remaining Vitest suite against synthetic localhost data, persistence suite excluded | **445 passed**; API/digest writes confined to localhost, Resend mocked |
| Distinct Vitest tests across those runs | **458 passed** |
| Production build and TypeScript | Passed |
| Full ESLint | Passed with one existing unused-variable warning in `eval/m3-rubric.ts` |
| Changed-file ESLint and whitespace check | Passed |
| Workflow YAML and actual Bash step execution | Passed: all 25 adapters, one-source selection, invalid input rejection, and summaries preserving exit codes 0/1/7 |
| Built app with synthetic localhost events | Homepage and events API HTTP 200 |
| Desktop feed, event details, and Event Timing browser checks | **11 passed**, one mobile-only case skipped; external source URL liveness excluded for synthetic URLs |

Playwright initially lacked its Chromium binary; installed the required browser and reran. One stale heading assertion failed before correction; the final browser run passes. The unchanged Open Graph route still emits the existing Edge/static-generation build warning.

## Verified recovery

- Created Neon production snapshot **`pre-ingestion-fix-2026-10-23`**, at **2026-10-23 15:39:53 UTC**, with expiry **never**.
- Created a separate data-and-schema recovery branch with the same name, also with expiry **never**. Compared every application row using ordered row checksums: **9,689 events, 875 venues, 3,724 ingestion runs, and 3 digest audit rows** match production.
- Used Neon's **Multi-step restore** to restore the snapshot to a separate branch. Production connections and settings were not migrated. Read and checksummed every row in its four application tables: **9,701 events, 876 venues, 3,749 ingestion runs, and 3 digest audit rows**. Restored columns and indexes match production; orphan venues, duplicate source identities, and duplicate fingerprints are all zero.
- Created `recovery-rehearsal-2026-10-23` from the saved recovery branch. This rehearsal branch expires October 24. Four representative source edits, persisted twice each, retained their original event IDs.
- Full cloned-data ingestion: Cheaper Than Therapy **50 fetched / 50 inserted / zero errors**; ODC **19 fetched / 10 inserted / 7 same-source updates / 2 skips / zero errors**.
- Measured the full identity/secondary-attribution lookup on the copied 9,689-event dataset: **40.121 ms cold**, then **3.601–3.748 ms warm** over five sampled identities. This is a sample, not a throughput guarantee.
- Production had zero recent running jobs during the first recovery-copy comparison. The scheduled old-code workflow then started at **15:37:12 UTC**, during validation. A later equality assertion against moving production failed as expected; the older recovery copy remains unchanged and checksum-verified. The newer snapshot includes the scheduled writes committed by 15:39:53 UTC, including two in-progress run records. All production database queries from this session were read-only. No local production export was needed.
- Waited for the old scheduled workflow to finish before publication. Its final Ticketmaster job completed successfully at **15:50:16 UTC**; the overall workflow failed on other adapters. GitHub reported no remaining active jobs, and a final read-only database check found zero recent running jobs. Production then contained **9,724 events** with no identity duplicates or orphan venue references. This run used `0f30740`, not the fixes in this release.

Recovery route: production branch → Backup & Restore → named snapshot → Multi-step restore → verify the new branch before migrating connections. One-step restore changes production data and should only be used for an intentional rollback. The retained recovery branch provides another independently readable copy.

## Remaining operations and file ownership

No manual production ingestion was dispatched during validation. The pushed workflow supports a single-source canary via its `source` input. Existing upstream-access issues for Freight, Dance Mission, and Actions-specific Eventbrite/Spark responses remain outside these fixes; see the historical details below.

Unrelated local changes remain excluded from release: `.gitignore`, `baselines/m5-lighthouse.json`, the two deletions under `docs/markdowns/`, and untracked `docs/DESIGN.md`, `docs/OPEN-ITEMS.md`, and `docs/SESSION-SUMMARY.md`.

---

## Historical October 19 handoff — superseded by the checkpoint above

**2026-10-19, America/Los_Angeles. Stopped at Shane's request.**

Repo: `/Users/shanemason/Mason Equity Dropbox/Shane Mason/Programming/active/sf-events-aggregator`

Branch: `main`, local HEAD `ece91f7`. All session changes are uncommitted. Nothing was pushed or deployed. No production ingestion writes ran. Production Actions used `e29e54ca096f4e4cf2977770d09a369be072035d`; GitHub comparison showed only a README disclosure difference from local HEAD.

## Verified state

| Item | Result |
|---|---|
| Final library/source test selection | **372 passed, 29 files**, including 13 real PostgreSQL persistence tests |
| Final `npm run typecheck` | Passed |
| Final changed-file ESLint and `git diff --check` | Passed |
| Production build | Passed before the latest CTT/ODC/runner/workflow/stale-run changes; **rerun on final tree** |
| Earlier application smoke test | Built homepage and events API returned HTTP 200 against four copied events in local PostgreSQL |
| Full database clone / restore rehearsal | **Not performed**; production dump request was rejected before execution |
| Workflow YAML / single-source dispatch validation | **Not completed**; attempted parser failed because package `yaml` is not installed |
| Disposable PostgreSQL | PostgreSQL 17 container `sf-events-ingestion-review` stopped and removed at handoff |

Final test command (requires a fresh disposable localhost DB):

```sh
PERSIST_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/sf_events_ingestion_test \
  npm test -- tests/lib tests/sources tests/ui
```

Ordinary runs skip the 13 database tests unless that variable is supplied. The test file mocks the application client, restricts the test connection to localhost and database `sf_events_ingestion_test`, and applies the existing migrations to an empty DB. Each invocation needs a fresh DB; it deliberately does not drop an existing schema. Do not substitute the production connection. Broader API/digest integration tests were not run: some write to the database and use `.env.local` by default.

## Findings from the review

Reviewed all **3,649 stored runs and 17,784 errors**, May 25–October 19. Latest production run: **7 failed sources plus 3 passing sources with errors; 229 errors total**. Database query errors account for 16,165 historical errors (90.9%). These counts include repeated failures across days, not unique lost events.

The persister matched only canonical fingerprint while `(source, external_id)` was also unique. Source edits changed fingerprints and collided with the existing source identity. Representative Ticketmaster, UCSF, and GAMH failures showed this mismatch. Concurrent attribution updates also lost sources; promotion discarded the former primary's attribution.

Latest Actions run: https://github.com/shane836/sf-events-aggregator/actions/runs/39293055622

Detailed historical review: `docs/ingestion-error-review-2026-10-19.md`. Its earlier validation sections describe earlier stages; this handoff is the latest state.

## Implemented locally

1. **Persistence:** matches immutable source identity, canonical fingerprint, and secondary attribution in a transaction. Identity-specific advisory locks and ordered row locks protect concurrent writes. Source edits preserve IDs. Ambiguous multi-row or changed-secondary matches throw `identity_conflict` and leave rows intact. Promotions retain previous-primary attribution. No schema migration or constraint removal.
2. **Outcomes and diagnostics:** `updatedSameSource` is counted. Runs now report `completed`, `partial`, or `failed`; partial ingestion returns CLI exit 1. Database `status` is already free text, so no migration is needed. SQLSTATE and safe constraint names are retained without SQL parameters/detail. Normalization errors have their own stage.
3. **Retries:** only empty transient fetches are retried, at most three total attempts with 1s/2s waits. Partial pages with usable events are not refetched. Persistence errors are classified for retryability but not automatically retried.
4. **Stale runs:** `startRun` marks only running jobs for the same source older than 24 hours failed, appends a stale error, and preserves earlier errors. Recent jobs and other sources remain untouched. Production's two June stale records remain unchanged until rollout.
5. **Cheaper Than Therapy:** parses the confirmed `{ events: [...] }` envelope. Live read-only fetch returned **50 events, zero errors**; response-contract tests pass.
6. **ODC:** retargeted `/calendar/events` (404) to official `/calendar`; deduplicates responsive cards and reports missing expected markup. Live fetch returned **15 events, zero errors**.
7. **Validation fixes:** froze Date in Off the Grid fixture tests without weakening assertions; typed Event Timing observer options locally without suppressing TypeScript.
8. **Actions preparation:** optional manual `source` input filters the discovered matrix to one registered adapter. Unknown source names fail validation. The shell now records exit status and closes the summary even when ingestion exits nonzero. This workflow change still needs YAML and dispatch validation.

Earlier isolated replay: copied four representative events and their venues read-only; edited each twice in local PostgreSQL. All four kept original IDs and no duplicates were created. This was a sample, not a full clone or source ingestion.

## Source-access limits

- **Eventbrite and Spark Social:** Actions recorded HTTP 405; the same adapters worked locally on October 19: **28 and 3 events respectively, zero errors**. Do not label these permanently blocked or replace them without checking runner-specific access. Local success does not prove GitHub Actions is fixed.
- **Freight:** official root and shows page returned HTTP 403 with a “Just a moment...” page. All 126 recorded runs failed. Needs accessible feed or venue permission; do not bypass the challenge.
- **Dance Mission:** Actions received HTML as JSON, but the endpoint returned valid JSON locally. Runner-specific/intermittent response remains unresolved. No adapter change made.
- **Spark official site:** redirects to `visitsparksocial.com`; San Francisco page exposed stale food-truck widget data, not a verified replacement discrete-event feed. No retarget made.

## Recovery and release blockers

**Automatic approval review rejected a full local PostgreSQL dump**: potentially sensitive production data export was not clearly authorized; it recommended a provider-native snapshot. The rejected command did not execute and no backup exists. Do not retry through an indirect export. A provider-native recovery point is the preferred next step, or obtain explicit approval for the full local export.

Attempted native recovery inspection: CUA reported no browser surfaces and `createBrowserTab("chrome", ...)` returned `Browser is not available: chrome`. No Neon UI action occurred. The handoff skill's old vault path was stale; the actual vault is `/Users/shanemason/Mason Equity Dropbox/MEP_Main/MEP Vault`.

Vercel CLI authentication works (`shane836`), version 59.9.1. The installed plugin recommends upgrading to 64.5.0/current before rollout. Ingestion is deployed through GitHub Actions, so a Vercel-only deployment would not release these ingestion fixes.

Do not auto-commit. Session instructions require explicit commit authorization; “keep rolling” was not treated as explicit permission to commit/push. No release or production ingestion should run before a verified recovery point and final validation.

## Resume order

1. Review the uncommitted diff, respecting the unrelated user changes below.
2. Rerun final build and validate workflow YAML plus default/single/invalid source discovery and failure-summary behavior. Do not install packages into the project only to parse YAML; use available tooling or an ephemeral validator.
3. Obtain a provider-native recovery point and verify restore options. Ask for explicit export approval only if native recovery is unavailable.
4. Validate all new code on an isolated DB; optionally rehearse against a permitted clone. Measure the secondary-attribution lookup on realistic data volumes before rollout.
5. Obtain explicit commit/push authorization, publish only the intended files, and confirm no old ingestion job is writing.
6. Dispatch one affected source using the new `source` input. Check IDs, error totals, and calendar output before expanding to the full schedule.
7. Resolve remaining Freight, Dance Mission, and Actions-specific Eventbrite access issues. No new providers or adapters were provisioned.

## File ownership and cleanup

Session changes: `.github/workflows/ingest.yml`, `ingest/run.ts`, `lib/persist.ts`, `lib/runner.ts`, `lib/sources/cheaperthantherapy.ts`, `lib/sources/odc.ts`, `tests/e2e/perf-d5.spec.ts`, `tests/sources/cheaperthantherapy.test.ts`, `tests/sources/odc.test.ts`, `tests/sources/offthegrid.test.ts`, new `tests/lib/persist.test.ts`, new `tests/lib/runner.test.ts`, new review document, and this root summary.

Pre-existing user changes: `.gitignore`, `baselines/m5-lighthouse.json`, deletion of `docs/markdowns/pge-rubric-control-surface.md` and `docs/markdowns/pge-rubric-guide-for-claude.md`, and untracked `docs/DESIGN.md`, `docs/OPEN-ITEMS.md`, `docs/SESSION-SUMMARY.md`. Do not stage or discard them as part of this repair.

The disposable test server/container and earlier app server were stopped. No active ingestion process remains from this session. The rejected backup helper was removed at handoff. Existing `docs/SESSION-SUMMARY.md` is an old handoff; use this root file.
