import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { events, venues } from "@/db/schema";
import { formatPriceDisplay } from "@/lib/format/price";
import type { Category, PriceInfo, VerificationLevel } from "@/lib/sources/types";

/**
 * GET /api/events
 *
 * Read-only JSON endpoint that backs the M2 calendar UI (Stream E). The UI
 * never touches `db/client` directly — A3 in `rubrics/milestone-m2-calendar.md`
 * enforces that this route is the only data boundary.
 *
 * Query params (all optional):
 *   - category       repeatable; one of music|comedy|lectures|dancing|food
 *   - from           ISO date/datetime; default = now()
 *   - to             ISO date/datetime; default = now() + 30 days
 *   - city           repeatable; case-insensitive match against venues.city
 *   - neighborhood   repeatable; case-insensitive match against venues.neighborhood
 *   - limit          integer, 1..500, default 200
 *   - offset         integer, >= 0, default 0
 *
 * Response shape mirrors `fixtures/events.json` with two extras:
 *   - `venue.id`, `venue.lat`, `venue.lng` (helpful for UI/map use)
 *   - `priceDisplay` — pre-computed `formatPriceDisplay(pricing)` so the UI
 *     never has to do price arithmetic. Structured `pricing` ships alongside.
 *
 * No writes here. Sole writer is `lib/persist.ts` (see docs/IDENTITY.md).
 */

// Route segment config — dynamic per-request, but Vercel edge caches via
// the `Cache-Control` header below.
export const dynamic = "force-dynamic";

const VALID_CATEGORIES: ReadonlyArray<Category> = [
  "music",
  "comedy",
  "lectures",
  "dancing",
  "food",
];

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const DEFAULT_WINDOW_DAYS = 30;

type ParsedParams = {
  categories: Category[] | null;
  cities: string[] | null;
  neighborhoods: string[] | null;
  from: Date;
  to: Date;
  limit: number;
  offset: number;
};

type ParseError = { code: 400; message: string };

function parseParams(
  searchParams: URLSearchParams,
  now: Date,
): ParsedParams | ParseError {
  // ---- category ----
  const rawCategories = searchParams.getAll("category");
  let categories: Category[] | null = null;
  if (rawCategories.length > 0) {
    const invalid = rawCategories.find(
      (c) => !VALID_CATEGORIES.includes(c as Category),
    );
    if (invalid !== undefined) {
      return {
        code: 400,
        message: `invalid category '${invalid}' (allowed: ${VALID_CATEGORIES.join(", ")})`,
      };
    }
    categories = Array.from(new Set(rawCategories)) as Category[];
  }

  // ---- city ----
  const rawCities = searchParams.getAll("city");
  let cities: string[] | null = null;
  if (rawCities.length > 0) {
    const trimmed = rawCities
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (trimmed.length === 0) {
      return { code: 400, message: "city must not be empty" };
    }
    cities = Array.from(new Set(trimmed));
  }

  // ---- neighborhood ----
  const rawNeighborhoods = searchParams.getAll("neighborhood");
  let neighborhoods: string[] | null = null;
  if (rawNeighborhoods.length > 0) {
    const trimmed = rawNeighborhoods
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (trimmed.length === 0) {
      return { code: 400, message: "neighborhood must not be empty" };
    }
    neighborhoods = Array.from(new Set(trimmed));
  }

  // ---- from / to ----
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  const from = rawFrom == null ? now : new Date(rawFrom);
  if (Number.isNaN(from.getTime())) {
    return { code: 400, message: `invalid 'from' date: '${rawFrom}'` };
  }

  const defaultTo = new Date(now.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
  const to = rawTo == null ? defaultTo : new Date(rawTo);
  if (Number.isNaN(to.getTime())) {
    return { code: 400, message: `invalid 'to' date: '${rawTo}'` };
  }

  if (to.getTime() < from.getTime()) {
    return { code: 400, message: "'to' must be >= 'from'" };
  }

  // ---- limit ----
  const rawLimit = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit != null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return {
        code: 400,
        message: `invalid 'limit': must be integer in [1, ${MAX_LIMIT}]`,
      };
    }
    limit = n;
  }

  // ---- offset ----
  const rawOffset = searchParams.get("offset");
  let offset = 0;
  if (rawOffset != null) {
    const n = Number(rawOffset);
    if (!Number.isInteger(n) || n < 0) {
      return {
        code: 400,
        message: "invalid 'offset': must be non-negative integer",
      };
    }
    offset = n;
  }

  return { categories, cities, neighborhoods, from, to, limit, offset };
}

type Row = {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  category: Category;
  startTimeUtc: Date;
  endTimeUtc: Date | null;
  timezone: string;
  priceMin: string | null;
  priceMax: string | null;
  isFree: boolean;
  seriesId: string | null;
  verificationLevel: string;
  venueId: string;
  venueName: string;
  venueCity: string;
  venueNeighborhood: string | null;
  venueAddress: string | null;
  venueLat: string | null;
  venueLng: string | null;
};

function toResponseEvent(r: Row) {
  const pricing: PriceInfo = {
    priceMin: r.priceMin != null ? Number(r.priceMin) : null,
    priceMax: r.priceMax != null ? Number(r.priceMax) : null,
    isFree: r.isFree,
  };

  return {
    id: r.id,
    title: r.title,
    category: r.category,
    startTimeUtc: r.startTimeUtc.toISOString(),
    endTimeUtc: r.endTimeUtc != null ? r.endTimeUtc.toISOString() : null,
    timezone: r.timezone,
    venue: {
      id: r.venueId,
      name: r.venueName,
      city: r.venueCity,
      neighborhood: r.venueNeighborhood,
      address: r.venueAddress,
      lat: r.venueLat != null ? Number(r.venueLat) : null,
      lng: r.venueLng != null ? Number(r.venueLng) : null,
    },
    source: r.source,
    sourceUrl: r.sourceUrl,
    verificationLevel: r.verificationLevel as VerificationLevel,
    pricing,
    priceDisplay: formatPriceDisplay(pricing),
    description: r.description,
    seriesId: r.seriesId,
  };
}

export async function GET(request: NextRequest) {
  const parsed = parseParams(request.nextUrl.searchParams, new Date());
  if ("code" in parsed) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  const { categories, cities, neighborhoods, from, to, limit, offset } = parsed;

  // Build filter clauses. Date range is always applied; category, city, and
  // neighborhood are OR-within-field, AND-across-fields.
  const conditions = [
    gte(events.startTimeUtc, from),
    lte(events.startTimeUtc, to),
  ];

  if (categories != null) {
    conditions.push(inArray(events.category, categories));
  }

  if (cities != null) {
    // Case-insensitive match against venues.city.
    const lowered = cities.map((c) => c.toLowerCase());
    conditions.push(
      sql`lower(${venues.city}) in (${sql.join(
        lowered.map((c) => sql`${c}`),
        sql`, `,
      )})`,
    );
  }

  if (neighborhoods != null) {
    // Case-insensitive: compare lower(venues.neighborhood) against
    // lower-cased user input.
    const lowered = neighborhoods.map((n) => n.toLowerCase());
    conditions.push(
      sql`lower(${venues.neighborhood}) in (${sql.join(
        lowered.map((n) => sql`${n}`),
        sql`, `,
      )})`,
    );
  }

  const where = and(...conditions);

  try {
    // Total (pre-pagination) and the page itself in parallel.
    const [countRows, rows] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .innerJoin(venues, eq(events.venueId, venues.id))
        .where(where),
      db
        .select({
          id: events.id,
          source: events.source,
          sourceUrl: events.sourceUrl,
          title: events.title,
          description: events.description,
          category: events.category,
          startTimeUtc: events.startTimeUtc,
          endTimeUtc: events.endTimeUtc,
          timezone: events.timezone,
          priceMin: events.priceMin,
          priceMax: events.priceMax,
          isFree: events.isFree,
          seriesId: events.seriesId,
          verificationLevel: events.verificationLevel,
          venueId: venues.id,
          venueName: venues.name,
          venueCity: venues.city,
          venueNeighborhood: venues.neighborhood,
          venueAddress: venues.address,
          venueLat: venues.lat,
          venueLng: venues.lng,
        })
        .from(events)
        .innerJoin(venues, eq(events.venueId, venues.id))
        .where(where)
        .orderBy(asc(events.startTimeUtc), asc(events.id))
        .limit(limit)
        .offset(offset),
    ]);

    const total = countRows[0]?.n ?? 0;
    const body = {
      events: (rows as unknown as Row[]).map(toResponseEvent),
      total,
      limit,
      offset,
    };

    return Response.json(body, {
      status: 200,
      headers: {
        // 15 min edge cache, 24h stale-while-revalidate
        "Cache-Control": "s-maxage=900, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    // Never leak stacktraces to clients. Log server-side for ops.
    console.error("[api/events] db error:", err);
    return Response.json(
      { error: "internal_error: failed to load events" },
      { status: 500 },
    );
  }
}
