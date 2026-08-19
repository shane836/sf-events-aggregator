# Session Summary — Hand-off for Fresh Claude

**Last commit:** `52c8944 feat(ingest): M1-v2 contract refactor with identity model + winner rule` (pushed to main)

**Your job (next session):** dispatch parallel sub-agents — one per remaining ingestion source — using the worktree workflow in `docs/ADD-A-SOURCE.md`. Each agent implements a `SourceAdapter`, writes a test, opens a PR.

---

## What's done

| Milestone | Status | Proof |
|---|---|---|
| M0 Foundation | ✅ all 12 rubric dims | https://sf-events-aggregator-two.vercel.app live, repo at https://github.com/shane836/sf-events-aggregator |
| M1a (first iCal source, function-based runner) | ✅ shipped then refactored | 881 UCSF rows ingested, then schema reset for M1-v2 |
| M1-v2 (SourceAdapter contract + identity model + winner-rule persister) | ✅ all deterministic rubric dims | 882 UCSF rows live; tests 11/11; build + typecheck clean |

## What's left in M1

To fully ship M1 (ingestion v1 — rubric in `rubrics/milestone-m1-ingestion.md`), we need:

**7 more `SourceAdapter` implementations** — one per source:

| ID | Tier | Category | URL hint | Verification |
|---|---|---|---|---|
| `ical:sfsymphony` | ical | music | calendar at sfsymphony.org (find iCal feed) | trusted_partner |
| `ical:sfjazz` | ical | music | sfjazz.org calendar | trusted_partner |
| `ical:usf` | ical | lectures | myusf.usfca.edu/events (Localist platform — try `/calendar/1.ics`) | trusted_partner |
| `ical:sfsu` | ical | lectures | events.sfsu.edu (Localist — `/calendar/1.ics`) | trusted_partner |
| `ical:cca` | ical | lectures | cca.edu/events | trusted_partner |
| `ticketmaster` | api | varies (use Discovery API classification) | https://developer.ticketmaster.com — needs `TICKETMASTER_API_KEY` from user | trusted_partner |

**Plus:**
- `.github/workflows/ingest.yml` — daily 4am Pacific cron, one job per source matrix-style (M1-13, M1-14)
- Schema-only addition if any source needs new fields (unlikely — current schema covers everything in IDENTITY.md)

## Critical invariants — do NOT break

Read `docs/IDENTITY.md` first. The non-negotiables:

1. **Single writer.** Only `lib/persist.ts` imports `db/client` for writes. Adapters NEVER touch DB. UI accesses via `/api/events` only.
2. **`fetch()` is the only IO method** on the adapter interface. Everything else is pure + synchronous.
3. **No cross-adapter imports.** `sources/cobbs.ts` does not import `sources/punchline.ts`. Shared logic goes in `lib/` and is pure.
4. **No DB schema imports in the contract.** `lib/sources/types.ts` does not depend on `db/schema.ts`.
5. **No price strings in the data layer.** Persistence stores `PriceInfo`. `formatPriceDisplay()` (in `lib/format/price.ts`) runs at render time only.
6. **Every event MUST have non-empty `identity.sourceUrl`** (D12) and structured `pricing` (D13).
7. **Fingerprint is minute-resolution + timezone-aware** via `fingerprint()` in `lib/identity.ts`. Do not reimplement.

## How to dispatch the agents

The recipe is in `docs/ADD-A-SOURCE.md`. Per source:

```bash
git worktree add .claude/worktrees/source-<name> -b feat/source-<name>
cd .claude/worktrees/source-<name>
# Agent implements lib/sources/<name>.ts + tests/sources/<name>.test.ts
npm test && npm run typecheck && npm run ingest <name>
git add lib/sources/<name>.ts tests/sources/<name>.test.ts
git commit -m "feat(ingest): add <name> source"
git push -u origin feat/source-<name>
gh pr create --fill
```

Spawn one `general-purpose` agent per source, all in parallel (one Agent tool call per source in a single message — they run concurrently). Each agent's prompt should include:

- This file path (`SESSION-SUMMARY.md`) + `docs/IDENTITY.md` + `docs/ADD-A-SOURCE.md` + `lib/sources/ucsf.ts` (reference impl) + `lib/sources/types.ts` (contract) + `fixtures/events.json` (target shape)
- The source's ID, tier, category, verification level, URL hint
- For API sources: env var name + a note that the user must supply the key (agent stops there with a PR that's gated on the secret)

Example prompt scaffold:

> You are implementing one event source for an SF events aggregator. Read SESSION-SUMMARY.md, docs/IDENTITY.md, docs/ADD-A-SOURCE.md, lib/sources/ucsf.ts (reference), lib/sources/types.ts (contract), fixtures/events.json (target shape). Then create a worktree at `.claude/worktrees/source-<name>`, implement `lib/sources/<name>.ts` as a `SourceAdapter`, write `tests/sources/<name>.test.ts` (copy ucsf.test.ts pattern), run `npm test && npm run typecheck && npm run ingest <name>`, commit, push, open a PR with `gh pr create --fill`. Source: { id: "ical:sfjazz", tier: "ical", category: "music", verificationLevel: "trusted_partner", urlHint: "look at sfjazz.org for an iCal subscribe link, often `/calendar/1.ics` for Localist-platform sites" }. Stop after PR is open — DO NOT merge.

## What you (Claude) cannot do without the user

- **`TICKETMASTER_API_KEY`** must be set by the user in `.env.local` (and pushed to Vercel via `vercel env add`). Until then, that adapter's agent will get 401s on `npm run ingest`. It can still implement + unit-test against fixtures and open a PR; the live ingest just won't work.
- **Merging PRs** — leave that to the user unless they say otherwise. The branches will pile up; that's fine.

## Repo state

- **GitHub:** https://github.com/shane836/sf-events-aggregator (private, shane836)
- **Vercel production:** https://sf-events-aggregator-two.vercel.app (deployment protection OFF; auto-deploys on push to main)
- **Neon:** 882 UCSF events live in `events` table; 63 venues; 1 ingestion_runs row. Per-table state visible via `npm run db:studio` or any psql tool with `DATABASE_URL`.

## Key files (quick reference)

| Path | Purpose |
|---|---|
| `docs/IDENTITY.md` | Identity model + ownership rules. READ FIRST. |
| `docs/ADD-A-SOURCE.md` | Worktree-per-source workflow. |
| `lib/sources/types.ts` | `SourceAdapter` contract (188 lines). |
| `lib/identity.ts` | `fingerprint`, `normalizeTitle`, `formatLocalDate`. |
| `lib/format/price.ts` | `formatPriceDisplay` — UI/digest only. |
| `lib/persist.ts` | Sole DB writer + winner rule. |
| `lib/runner.ts` | `runAdapter(adapter)` — driver. |
| `lib/sources/ucsf.ts` | Reference adapter — copy this shape. |
| `tests/sources/ucsf.test.ts` | Reference adapter test — copy this shape. |
| `tests/lib/identity.test.ts` | Invariant tests (B1-B5). |
| `fixtures/events.json` | 34-event golden reference. Match this shape. |
| `rubrics/milestone-m1-ingestion.md` | M1 ship gate. |
| `rubrics/milestone-m1-v2-contract-refactor.md` | M1-v2 dimensions (just shipped). |
| `db/schema.ts` | Current schema (events, venues, ingestion_runs, digest_sends). |
| `ingest/run.ts` | CLI: `npm run ingest <name>` |

## Stack reminder

- Next.js 16 + React 19 + Tailwind 4 (App Router, no src/ dir)
- Drizzle ORM + Neon Postgres
- tsx for ingestion scripts (CJS-default; use IIFE for top-level await, not `"type": "module"`)
- vitest for tests
- Node 26 via Homebrew (hermes shims removed earlier — don't reinstall)

## Outstanding worktrees

- `.claude/worktrees/contracts-source-adapter` — on branch `worktree-contracts-source-adapter`, commit `c2523d7`. Already merged into main; keep around as reference.

## After M1 ships (don't start yet)

- **M2** — Calendar UI (month grid desktop, agenda list mobile). UI calls `formatPriceDisplay()`; never persists strings. Dark mode default. Resident Advisor / Songkick aesthetic.
- **M3** — Tier-3 scrapers: 6 comedy + 6 dance + music gap-fill + 5 food. Cheerio for static, Playwright only if JS-rendered.
- **M4** — Email digest via Resend. Single button → modal → POST /api/digest. No accounts, no recurring.
- **M5** — Polish, perf, custom domain, ship.

Every milestone gets a rubric written BEFORE code. PGE discipline holds.
