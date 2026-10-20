# SF Events Aggregator

A San Francisco Bay Area events calendar for music, comedy, lectures, dancing, and food. It collects venue and event listings, stores them in Postgres, and provides calendar views, filters, and email digests.

## Features

- Source adapters for venue calendars, Funcheap, Eventbrite, Ticketmaster, and other sources.
- Month, week, and day views, an upcoming-events feed, and a mobile agenda.
- Filters for category, date, city or region, and neighborhood.
- Email digests through Resend.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS, and Drizzle ORM with Postgres. Source coverage depends on successful ingestion; upstream calendars can change.

## Run locally

Install Node.js and npm, and provide a Postgres database. The environment template describes a Neon pooled connection string.

```sh
npm ci
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string; required for stored events. |
| `TICKETMASTER_CONSUMER_KEY` | Ticketmaster Discovery API access for that adapter. |
| `RESEND_API_KEY` | Email digest delivery. |
| `DIGEST_SENDER_DOMAIN` | Optional verified Resend sender domain; add it to use your own digest sender. |

Keep credentials in ignored local environment files. Without `DIGEST_SENDER_DOMAIN`, the sender code falls back to Resend's test sender and its delivery restrictions.

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:3000. A new database needs an ingestion run before it contains listings.

## Collect events

```sh
# Applies migrations, then runs every discovered source adapter.
npm run ingest:all

# Run one adapter by its filename in lib/sources, without .ts.
npm run ingest -- ticketmaster
```

Ingestion reads `.env.local`, contacts upstream sources, and writes to the configured database. The all-source runner reports failed adapters after attempting the remaining sources.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npx playwright install chromium
npm run test:e2e
```

Configure the app and database for checks that exercise them. These commands are defined in the repository; they were not executed during this documentation review.

## Project layout

| Path | Purpose |
|---|---|
| `app/` | Calendar pages, components, and events/digest API routes. |
| `lib/sources/` | Event source adapters. |
| `ingest/run.ts` | Single-source ingestion entry point. |
| `scripts/ingest-all.mjs` | Migrations followed by all-source ingestion. |
| `db/` and `drizzle/` | Database schema and migrations. |
| `lib/digest/` | Queries, email templates, and Resend delivery. |
| `tests/`, `eval/`, and `rubrics/` | Automated checks and evaluation material. |

See [DESIGN.md](DESIGN.md) for the visual system and [OPEN-ITEMS.md](OPEN-ITEMS.md) for recorded follow-up work. Runtime provider access and deployment status require separate verification.

## How this was built

Built with Claude Code, directed and reviewed by the project owner. Documentation reviewed with OpenAI Codex assistance.
