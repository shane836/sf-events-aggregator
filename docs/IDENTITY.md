# Identity model & ownership rules

This is the contract every parallel stream builds against. Read it before
writing any adapter, persister, UI, or eval code. If you want to deviate, open
a discussion before changing — the whole fan-out depends on these invariants.

---

## Three layers of identity

| Layer | Key | Mutability | Who uses it |
|---|---|---|---|
| **Source** | `(source, externalId)` | Immutable per source | Adapter: "have I seen this row before? UPDATE or INSERT." |
| **Canonical event** | `sha256(norm_title \| norm_venue_name \| local_iso_minute)` truncated to 32 hex | Stable across sources | Persister: cross-source dedup via unique index. |
| **Venue** | `venues.id` UUID, upserted on `normalized_name` unique index | Stable surrogate | FK on events; filtering/joining. **Never appears in canonical fingerprint.** |

### Why the canonical fingerprint excludes `venue_id`

A surrogate ID can be re-resolved (venue merge, schema migration). A
fingerprint cannot — collisions or drift silently corrupt dedup. Fingerprint
on the *name* (normalized) and accept rare under-merges instead of risking
over-merges. Under-merges are recoverable via manual venue alias; over-merges
silently delete data.

### Why minute-level granularity

Two shows of the same act at the same venue on the same night (e.g., 7pm and
9:30pm) must have distinct fingerprints. Day-level granularity collides them.
Both fixtures `pl-hannibal-7pm` and `pl-hannibal-930pm` exist to enforce this
as a regression test.

### Why timezone is required on every event

`Date.toISOString().slice(0, 10)` returns the UTC date, not the local date.
An 8pm PT event on June 4 has UTC date June 5. Canonical fingerprint and
calendar-grid grouping both use `formatLocalDate(date, timezone)` from
`lib/identity.ts`. Never slice ISO strings for date.

---

## Race-safe upsert flow (Stream A's responsibility)

```sql
-- 1. Resolve venue
INSERT INTO venues (normalized_name, name, neighborhood, address, lat, lng, ...)
VALUES (...)
ON CONFLICT (normalized_name) DO UPDATE
  SET name = EXCLUDED.name,
      neighborhood = COALESCE(EXCLUDED.neighborhood, venues.neighborhood),
      lat = COALESCE(EXCLUDED.lat, venues.lat),
      lng = COALESCE(EXCLUDED.lng, venues.lng)
RETURNING id;

-- 2. Upsert event by canonical_fingerprint with verification-level winner rule
INSERT INTO events (canonical_fingerprint, source, external_id, source_url,
                    venue_id, verification_level, secondary_sources, ...)
VALUES (...)
ON CONFLICT (canonical_fingerprint) DO UPDATE
  SET title = CASE WHEN level_rank(EXCLUDED.verification_level)
                     > level_rank(events.verification_level)
                   THEN EXCLUDED.title ELSE events.title END,
      -- (same pattern for every overwritable field)
      secondary_sources = events.secondary_sources ||
        jsonb_build_object(
          'source', EXCLUDED.source,
          'externalId', EXCLUDED.external_id,
          'sourceUrl', EXCLUDED.source_url,
          'verificationLevel', EXCLUDED.verification_level,
          'observedAt', now()
        );
```

Postgres unique indexes (`venues.normalized_name`,
`events.canonical_fingerprint`) make this race-free under parallel workflow
runs. No application-level locking needed.

---

## Ownership rules

| Module | Owner | May read | May write |
|---|---|---|---|
| `lib/sources/types.ts` | Stream A | — | — (types only) |
| `lib/identity.ts` | Stream A | — | — (pure) |
| `lib/format/price.ts` | Stream A | — | — (pure) |
| `lib/persist.ts` *(future)* | Stream A | normalized events | **events, venues, ingestion_runs (ONLY writer)** |
| `lib/sources/<adapter>.ts` | Stream B/C/D (one agent per adapter) | the source's HTTP / iCal / HTML | nothing |
| `app/**` (UI) | Stream E | events via `/api/events` | nothing in DB |
| `lib/digest/**` | Stream F | events via internal query + `format/price` | digest_sends |
| `eval/**` | Stream G | events table read-only | nothing |

**Hard rules:**

1. **One writer.** Only the persister imports `db/client` for writes. Adapters do not. UI does not. Email writes only to `digest_sends`.
2. **No cross-adapter imports.** `sources/cobbs.ts` does not import `sources/punchline.ts`. Shared logic goes in `lib/` and is pure.
3. **`fetch()` is the only IO method on the adapter interface.** Everything else (normalize, identity, categorize) is sync and pure.
4. **No DB schema imports in the contract.** `lib/sources/types.ts` does not depend on `db/schema.ts`. The persister bridges between the two so the contract can evolve faster than the schema.
5. **No price strings in the data layer.** Persistence stores structured `PriceInfo`. `formatPriceDisplay()` runs at render time only — UI and email digest both call it; they never persist the result.

---

## What this contract does NOT do

Explicit non-goals so we don't drift:

- **Multi-region.** Single timezone field per event is sufficient; we don't model city/region.
- **Multi-currency.** USD only. `PriceInfo` has no currency field — add one when we expand geo.
- **Multi-category per event.** Spec locks single `category`. The categorizer may use multiple signals but resolves to one.
- **RRULE in the database.** iCal adapters expand recurrence in-process and emit one `RawEvent` per occurrence with a shared `seriesId`. Cancellations/edits are out of scope for MVP.
- **Ticket inventory or purchase.** `sourceUrl` is the click-out, period.
- **User-supplied content.** No accounts, no submissions, no favorites. The `digest_sends` table is an audit log, never a subscriber list.
- **Adapter retries or orchestration.** Adapters return `FetchResult` with `errors[]` and let the GitHub Action runner decide policy. No in-adapter retry loops.

---

## Schema migration needed for full M1

The schema committed in M0 (`db/schema.ts`) predates this contract. Stream A
applies these changes in its first migration:

| Change | Reason |
|---|---|
| Rename `events.fingerprint` → `events.canonical_fingerprint`, keep unique index | Match contract naming. |
| Add `events.timezone text NOT NULL DEFAULT 'America/Los_Angeles'` | Required for stable local-time grouping. |
| Add `events.verification_level text NOT NULL` | Winner rule for cross-source merges. |
| Add `events.secondary_sources jsonb NOT NULL DEFAULT '[]'::jsonb` | Typed attribution after merge. |
| Add `events.series_id text NULL` + index | Recurrence grouping for iCal occurrences. |
| Drop `events.price_display NOT NULL` constraint (or leave column denormalized, populated by persister at write) | Presentation moves to render layer. |
| Add `venues.normalized_name text NOT NULL` + unique index | Race-safe venue upsert key. |
| Add `ingestion_runs` table (id, source, started_at, completed_at, cursor, status, error_count) | Visibility into Q1-Q5 rubric checks. |

Stream A drafts and runs this migration as step 1 of M1. No other stream
applies migrations.

---

## Fixture invariants

`fixtures/events.json` represents the API response shape consumed by the UI
(Stream E) and the digest renderer (Stream F). The fixture is hand-curated to
hit every edge case the rubrics test for:

- Every category present at the minimum threshold (D2)
- Both `Hannibal Buress` 7pm and 9:30pm rows present (same-night same-act regression)
- Free events with structured `{ isFree: true }` (no priceMin/Max)
- Single-price and ranged-price events
- Multi-day event (Chinatown Night Market spans 6/19 8pm → 6/21 11pm)
- Long-title event for grid truncation (Anderson .Paak entry)
- Null description, null endTimeUtc
- iCal source with `recurrence` block populated
- All `verificationLevel` values appear at least once
- Timezone explicitly tagged on every row

If you add an edge case the rubric needs to test, add a fixture row — don't
mutate an existing one.

---

## Quick verification

```bash
npx tsx eval/identity-smoke.ts   # (future) round-trip fixtures through identity
npx tsc --noEmit                 # contract typechecks
```
