# SF Events Aggregator — Build Prompt

Paste this entire file into a fresh Claude Code session. It contains every decision Claude needs to start implementing — no re-asking, no re-planning.

---

## Mission

Build a mobile-responsive web calendar that aggregates **music, comedy, academic lectures, dancing, and food (popups + night markets)** events in **San Francisco**. Ship to GitHub, deploy to Vercel. Zero ongoing budget — free tiers only.

Build using a **Plan-Generate-Evaluate (PGE) loop**: for every milestone, write the rubric first, generate the code, run the rubric checks, fix specific failures, repeat. Cap at 3 iterations per milestone — if not converged, surface for human review instead of looping forever.

---

## Locked Decisions — Do Not Re-Ask

| Decision | Value |
|---|---|
| Geo | San Francisco city only (not Bay Area) |
| Categories | Music, Comedy, Lectures, Dancing, Food (top-level only, no sub-tags) |
| Stack | Next.js 15 App Router + TypeScript + Tailwind + Drizzle + Neon Postgres + Vercel |
| Email | Resend |
| Ingestion | GitHub Actions cron, daily at 4am Pacific |
| Calendar view | Month grid on desktop (≥768px), agenda list on mobile (<768px) |
| Filters | Category (multi-select), date range, neighborhood |
| Event detail | Title, time, venue, neighborhood, category, description, **price**, click-through link to source |
| Email digest | Single button → modal → email + optional category filters → immediate send. No accounts, no recurring, no subscriber list |
| Design vibe | Resident Advisor / Songkick — calendar-forward, type-driven, dark mode default |
| No-go for MVP | User accounts, favorites, user submissions, ticketing on-site, multi-region |

**Two properties are non-negotiable on every event:** (1) a working click-through `source_url`, (2) a price string (`$X`, `$X–$Y`, `Free`, or `Price varies`).

---

## Data Sources

### Tier 1 — Free APIs
- **Ticketmaster Discovery API** (5,000 calls/day free) — large music + comedy venues

### Tier 2 — iCal / structured feeds (verify availability per source)
- events.stanford.edu, events.berkeley.edu, calendar.ucsf.edu, myusf.usfca.edu/events, events.sfsu.edu, cca.edu/events
- sfjazz.org, sfsymphony.org, sfcm.edu/events

### Tier 3 — Scrapers (Cheerio for static, Playwright only when needed)
- **Comedy:** Punch Line SF, Cobb's Comedy Club, The Setup, Cheaper Than Therapy, SF Comedy College, Secret Improv Society
- **Dance:** ODC, Alonzo King LINES, Dance Mission Theater, Rhythm & Motion, Verdi Club, Cinderella Ballroom
- **Music gap-fill:** Great American Music Hall, The Independent, The Chapel, Bimbo's 365, Cafe du Nord, The Knockout, Make-Out Room, Rickshaw Stop, August Hall, The Fillmore, The Warfield, Davies Symphony Hall, War Memorial Opera House
- **Food (hardest category):** Off the Grid markets, Spark Social SF, Mission Community Market, Eater SF events, Funcheap food category

Each source = independent GitHub Action job. One scraper breaking does not break the pipeline.

---

## Data Model (Drizzle / Postgres)

```typescript
// events
id: uuid (pk)
source_id: string
source: string                    // 'ticketmaster' | 'ical:stanford' | 'scrape:cobbs' | ...
source_url: string                // REQUIRED — never null
title: string
description: text | null
category: enum                    // 'music' | 'comedy' | 'lectures' | 'dancing' | 'food'
start_time: timestamptz
end_time: timestamptz | null
venue_id: uuid (fk venues.id)
price_min: numeric | null
price_max: numeric | null
is_free: boolean (default false)
price_display: string             // REQUIRED — computed: "$25", "$25–$45", "Free", "Price varies"
raw_payload: jsonb
ingested_at: timestamptz
fingerprint: string               // hash(normalized_title, venue_id, start_time::date) for dedup

// venues
id, name, neighborhood, address, lat, lng, primary_category, source_metadata

// digest_sends (audit log only — NOT a subscriber list)
id, email, sent_at, filters_applied (jsonb), event_count
```

---

## Master Success Rubric (gates the MVP ship)

| D | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | Build/deploy broken | `npm run build` exits 0, Vercel deploys, prod returns 200 in <2s | All three |
| D2 | Category too thin | SQL count, next 30 days | Music/Comedy/Lectures/Dancing ≥ 5; Food ≥ 4 |
| D3 | Dead click-through | HEAD request 25 random `source_url` | ≥ 23/25 return 200/3xx |
| D4 | Duplicate events | SQL: any duplicate `(normalized_title, venue_id, start_time::date)`? | Zero duplicates |
| D5 | Bad categorization | Manual spot-check 30 random events vs source | ≥ 27/30 correct |
| D6 | Stale events shown | API filter rejects `end_time < now() - 1 day` | Integration test confirms |
| D7 | Mobile broken | Playwright at 375 / 768 / 1440px: no horizontal scroll, ≥44px tap targets | All three pass |
| D8 | Filters don't filter | Integration test every filter combination | All return correct sets |
| D9 | Digest broken | Test send delivers, opens cleanly in Gmail + Apple Mail + Outlook web, all links resolve | All three |
| D10 | Ingestion stalled | Last 7 daily GitHub Actions succeeded, max `ingested_at` < 30h old | Both true |
| D11 | Slow load | Lighthouse on prod: LCP < 2.5s on 3G, CLS < 0.1 | Both met |
| D12 | Event without click-through | SQL: any null/empty `source_url`? + UI shows "View source" on every card | Zero nulls, button present |
| D13 | Event without price | UI integration test: every event renders `price_display` | No blank prices |
| D14 | Console errors in prod | Open home, filtered view, event detail, digest modal | Zero errors in any |

**Ship criteria:** D1, D2, D6, D7, D8, D9, D10, D12, D13, D14 must pass. D3, D4, D5, D11 should pass; ship at ≥80% threshold met.

---

## Data Quality Rubric (runs after every daily ingestion)

| Q | Failure mode | Check | Pass |
|---|---|---|---|
| Q1 | Pipeline crashed mid-run | Exit code per source job | All jobs exit 0 OR error categorized |
| Q2 | Source went empty unexpectedly | Compare to 7-day rolling average | New count within ±50% of average |
| Q3 | Required fields missing | Schema check on new rows | All have title, start_time, venue_id, source_url, price_display |
| Q4 | Bad timezones | Sanity range | All start_times in (now, now + 365 days) |
| Q5 | Dead links from a source | HEAD sample 10 new events | ≥ 9 return 200/3xx |

Failures post to a GitHub Actions summary so they're visible the next morning.

---

## PGE Workflow — Build Loop

For **every milestone**:

1. **Plan** — break the milestone into 2-5 concrete generation steps. Write the milestone's rubric *before* writing code. Save to `/rubrics/milestone-<name>.md`.
2. **Generate** — implement one step at a time. Keep changes scoped.
3. **Evaluate** — run the rubric. Prefer deterministic checks (build pass, integration test, SQL query, HEAD request) over model judgment.
4. **Revise** — for each failed dimension, write a *specific* revision instruction: "D3 failed: Cobb's scraper returned 0 events; expected ≥ 5 for next 30 days. Inspect HTML and fix selector." Do NOT say "try again."
5. **Cap at 3 iterations.** If a dimension still fails after 3, mark it for human review and move on.

The evaluator should run in a separate context from the generator (a sub-agent or fresh chat) — never ask the same context that wrote the code to grade it.

---

## Milestones

### M0 — Foundation (target: 1-2 days)
- `npx create-next-app@latest` (TS, App Router, Tailwind, ESLint)
- Init git, push to new GitHub repo
- Provision Neon Postgres (free tier), wire Drizzle, write `events` + `venues` + `digest_sends` schemas
- Vercel project linked to repo, env vars set (`DATABASE_URL`, future `TICKETMASTER_API_KEY`, `RESEND_API_KEY`)
- Hello-world page deploys to Vercel
- **Gate:** D1 passes on a placeholder page.

### M1 — Ingestion v1 (Tier 1 + Tier 2)
- Ticketmaster API client
- iCal pullers for the 6 universities + sfjazz/sfsymphony
- Normalizer (raw → canonical event shape, including `price_display` builder)
- Dedup logic
- Categorizer (rule-based: source/venue → category)
- GitHub Action: daily 4am PT, one job per source, writes to Neon
- **Gate:** D4 + Q1-Q5 pass. D2 partial (music/lectures populated).

### M2 — Calendar UI
- Month grid (desktop), agenda list (mobile, <768px)
- Event card with category color, price string, "View source" button
- Event detail (modal)
- Category / date / neighborhood filters
- **Gate:** D7, D8, D11, D12, D13, D14 pass.

### M3 — Ingestion v2 (Tier 3 scrapers)
- 6 comedy + 6 dance + music gap-fill + 5 food scrapers (one file per source)
- Each scraper has its own test fixture (saved HTML snapshot)
- **Gate:** D2 fully passes (all 5 categories meet thresholds), D3 + D5 spot checks.

### M4 — Email digest
- Button on calendar → modal → POST /api/digest
- Resend integration, HTML email template (responsive, dark/light)
- SPF/DKIM configured for the chosen domain
- **Gate:** D9 passes.

### M5 — Polish + ship
- Full master rubric run
- Performance pass (Lighthouse)
- Domain purchase + Vercel domain setup
- **Gate:** All MVP must-haves pass. Ship.

---

## Start Here

**Action:** Begin M0.

1. Confirm with the user: chosen GitHub repo name, Neon account access, Vercel account access.
2. Once confirmed, scaffold the project, push to GitHub, link to Vercel, deploy a hello-world page.
3. Verify D1 passes on the placeholder.
4. Stop and report status. Do not start M1 without explicit user go-ahead.

---

## DO NOT

- Do not re-litigate scope decisions in the "Locked Decisions" table.
- Do not propose user accounts, favorites, or event submissions for MVP.
- Do not expand geo beyond SF.
- Do not skip the rubric step on any milestone — the rubric is the control surface; without it the loop doesn't converge.
- Do not commit secrets. Use Vercel env vars + `.env.local` (gitignored).
- Do not invent libraries — every import must resolve to a real package.
- Do not stop and wait for clarification on details I haven't specified (e.g., color hex values, exact filter UI placement) — make a reasonable call and proceed.
