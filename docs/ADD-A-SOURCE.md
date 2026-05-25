# Add a Source

How to add a new event source — designed so multiple contributors (humans or agents) can work in parallel without colliding.

The contract is the only coupling. Anything that implements `SourceAdapter` and produces events matching `fixtures/events.json` is a valid source.

---

## TL;DR

```bash
# 1. New worktree on a feature branch
git worktree add .claude/worktrees/source-<name> -b feat/source-<name>
cd .claude/worktrees/source-<name>
npm install

# 2. Implement the adapter at lib/sources/<name>.ts
# 3. Add a test at tests/sources/<name>.test.ts
# 4. Verify
npm test
npm run typecheck

# 5. Optional: live ingestion test (writes to Neon)
npm run ingest <name>

# 6. PR
git add lib/sources/<name>.ts tests/sources/<name>.test.ts
git commit -m "feat(ingest): add <name> source"
gh pr create --fill
```

Once merged, the source is automatically picked up by the daily GitHub Actions cron (M1c — coming).

---

## The contract

Every source is a default-exported `SourceAdapter`. The full interface is in `lib/sources/types.ts`:

```ts
export interface SourceAdapter {
  readonly id: string;            // e.g. "ical:ucsf", "ticketmaster", "scrape:cobbs"
  readonly tier: SourceTier;      // "api" | "ical" | "scrape"
  readonly defaultCategory: Category;
  fetch(): Promise<FetchResult>;  // produces RawEvent[] + errors[] — never throws on per-event failure
  normalize(raw: RawEvent): NormalizedRow;  // pure transform
}
```

Two-phase split is deliberate:
- `fetch()` deals with the messy outside world (HTTP, parsing, retry). All errors land in `FetchResult.errors[]` — exceptions only for *uncategorized* failures.
- `normalize(raw)` is a pure function from a flat `RawEvent` to a DB-ready `NormalizedRow`. It's easy to unit-test against fixtures.

The runner (`lib/runner.ts`) handles persistence (`lib/upsert.ts`): venue find-or-create, fingerprint dedup, error aggregation, JSON-result emission.

---

## Reference shape

Every event your adapter emits must match the shape in `fixtures/events.json`. That file has 34 reference events across all 5 categories and all 3 tiers — pick one close to your source and copy its shape.

**Two fields are non-negotiable (D12/D13 in the master rubric):**
- `sourceUrl` — never null, never empty
- `priceDisplay` — never null, never empty. Build it via `priceDisplay()` in `lib/normalize.ts`; valid outputs are `"Free"`, `"$X"`, `"$X–$Y"`, `"$X+"`, `"Up to $Y"`, `"Price varies"`.

---

## Naming & conventions

- Adapter id format: `<tier>:<slug>` for ical/scrape (`ical:ucsf`, `scrape:cobbs`), bare name for top-tier APIs (`ticketmaster`, `seatgeek`).
- File: `lib/sources/<slug>.ts` (slug is just the part after the colon).
- Test: `tests/sources/<slug>.test.ts`.
- Default-export the adapter object.

---

## Worktree-per-source workflow

Why worktrees: each source lives in its own checkout. Two contributors working on `lib/sources/cobbs.ts` and `lib/sources/sfjazz.ts` never see each other's uncommitted state. The contract (`lib/sources/types.ts`) is the only file they both depend on, and it changes rarely.

```bash
# Create
git worktree add .claude/worktrees/source-cobbs -b feat/source-cobbs

# Work
cd .claude/worktrees/source-cobbs
# ... write adapter + test ...

# Validate locally
npm test
npm run typecheck

# Ship
git add lib/sources/cobbs.ts tests/sources/cobbs.test.ts
git commit -m "feat(ingest): add Cobb's Comedy Club source"
git push -u origin feat/source-cobbs
gh pr create --fill

# Cleanup after merge
cd /path/to/main/worktree
git worktree remove .claude/worktrees/source-cobbs
git branch -d feat/source-cobbs
```

If two PRs touch shared lib (e.g., both add a new entry to a neighborhood-resolution map), resolve at merge time — but that should be rare; prefer hard-coding per-adapter constants over editing shared maps.

---

## Anatomy of a source file

Use `lib/sources/ucsf.ts` as the template. Key spots:

```ts
const ID = "ical:ucsf";
const FEED_URL = "https://calendar.ucsf.edu/calendar/1.ics";
const DEFAULT_NEIGHBORHOOD = "Parnassus / Mission Bay";  // per-adapter constant

export const adapter: SourceAdapter = {
  id: ID,
  tier: "ical",
  defaultCategory: "lectures",

  async fetch() {
    // 1. Hit the network
    // 2. Catch network/parse errors → push to errors[], return partial result
    // 3. Map raw API/iCal → RawEvent[]
  },

  normalize(raw) {
    // Pure transform: build venue + event objects, compute fingerprint, build priceDisplay
  },
};

export default adapter;
```

For iCal sources, `lib/ical.ts` provides `fetchICalEvents(url, { horizonDays })` and `splitLocation(loc)` — use them.

For API sources (Ticketmaster, SeatGeek), call `fetch()` directly with the API key from `process.env`. Add the key to `.env.example` and document it in your PR.

For scraper sources (M3), prefer Cheerio over Playwright unless the page requires JS execution.

---

## Per-source test pattern

```ts
// tests/sources/<name>.test.ts
import { describe, expect, it } from "vitest";
import adapter from "@/lib/sources/<name>";
import type { RawEvent } from "@/lib/sources/types";

const sample: RawEvent = { /* ... build a realistic example ... */ };

describe("<name> adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("...");
  });

  it("normalizes raw → DB-ready row", () => {
    const { venue, event } = adapter.normalize(sample);
    expect(event.source).toBe(adapter.id);
    expect(event.sourceUrl.length).toBeGreaterThan(0);
    expect(event.priceDisplay.length).toBeGreaterThan(0);
    // ... assert source-specific invariants ...
  });

  it("never produces a null/empty source_url or price_display", () => {
    const { event } = adapter.normalize(sample);
    expect(event.sourceUrl?.length ?? 0).toBeGreaterThan(0);
    expect(event.priceDisplay?.length ?? 0).toBeGreaterThan(0);
  });
});
```

For sources where the raw payload format is non-trivial (e.g., Ticketmaster's JSON), save a redacted real response under `fixtures/raw/<name>.json` and load it in your test.

---

## Live ingestion smoke test

After you can run `npm test` cleanly, hit the live source against Neon:

```bash
npm run ingest <name>
```

Output is a single JSON line:
```json
{"source":"ical:ucsf","fetched":885,"inserted":881,"skipped":4,"errors":[],"durationMs":440204}
```

Re-running should report `inserted: 0` if dedup is working (everything matches an existing fingerprint).

---

## When you're done

- ✅ Adapter file under `lib/sources/`
- ✅ Test file under `tests/sources/`
- ✅ `npm test` and `npm run typecheck` both pass
- ✅ Live ingest produces non-zero inserts on first run, near-zero on second run
- ✅ All inserted events have non-empty `source_url` and `price_display`
- ✅ Any new env vars added to `.env.example` and documented in the PR

The rubric in `rubrics/milestone-m1-ingestion.md` is the ship gate for the whole ingestion pipeline. Your one source is part of it — see M1-1, M1-2, M1-3, M1-4, Q3, Q5.
