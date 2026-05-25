# Milestone M0 — Foundation Rubric

**Purpose:** Verify the project skeleton is real, builds, deploys, and is wired to GitHub + Vercel + Neon. No app behavior tested here — only the substrate.

**Method discipline:** Every dimension below is checked by a deterministic command, not by judgment. If a check is not deterministic, it does not belong in this rubric.

**Iteration cap:** 3. If any dimension still fails after 3 revision passes, mark `HUMAN-REVIEW-NEEDED` in the status report and stop — do not advance to M1.

---

## Dimensions

| # | Failure mode | Check | Pass criterion |
|---|---|---|---|
| M0-1 | Local build broken | `npm run build` in repo root | Exits 0; `.next/` produced |
| M0-2 | Type errors | `npx tsc --noEmit` | Exits 0; zero errors |
| M0-3 | Lint errors | `npm run lint` | Exits 0 (warnings allowed, errors block) |
| M0-4 | Missing core deps | `node -e "require('next');require('drizzle-orm');require('postgres')"` | Exits 0 |
| M0-5 | Schema not parseable | `npx drizzle-kit check` (or `generate` against schema file) | Exits 0; schema compiles |
| M0-6 | Secrets in git | `git ls-files \| grep -E '\.env$\|\.env\.local$'` | Empty output |
| M0-7 | .env.example missing keys | grep for each required key in `.env.example` | All 4 keys present (DATABASE_URL, TICKETMASTER_API_KEY, SEATGEEK_API_KEY, RESEND_API_KEY) |
| M0-8 | Not pushed to GitHub | `gh repo view --json url` | Returns a URL on origin |
| M0-9 | Vercel project not linked | `vercel project ls` shows the project, or `.vercel/project.json` exists | Linked |
| M0-10 | Prod deploy missing | `curl -sI <prod-url>` | HTTP 200 |
| M0-11 | Prod TTFB slow | `curl -o /dev/null -s -w '%{time_total}' <prod-url>` | < 2.0 seconds |
| M0-12 | Placeholder content not present | `curl -s <prod-url> \| grep -i 'sf events'` | Match found |

---

## Ship gate for M0

**All of M0-1, M0-2, M0-4, M0-6, M0-7, M0-8, M0-10, M0-12 must PASS.**

M0-3 (lint), M0-5 (drizzle check requires DATABASE_URL), M0-9 (vercel link), M0-11 (TTFB) are **soft** — failing one or two is acceptable if the rest are clean. M0-5 in particular is expected to be deferred until Neon DB is provisioned.

---

## Revision protocol

If a dimension fails, the revision instruction must be specific:

> "M0-2 FAILED: `tsc --noEmit` reports `error TS2307: Cannot find module 'drizzle-orm/pg-core'` at db/schema.ts:1. Install missing package or fix import path."

NOT:

> "Fix the type errors."

Generator and evaluator must be different actors (separate context). For this small milestone, "separate context" means: the generator (writes code) and the evaluator (runs commands and reads exit codes) operate in distinct logical turns and do not let the writing context grade itself by re-reading the diff.

---

## Out of scope for M0

- Data ingestion (M1)
- Calendar UI rendering (M2)
- Any business logic
- Authentication, accounts, user features (NEVER in MVP)
