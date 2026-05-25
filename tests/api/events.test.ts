/**
 * Integration tests for GET /api/events.
 *
 * Hits the live Neon DB via `db/client` (read-only). Requires DATABASE_URL
 * in `.env.local` — vitest.config.ts loads it before any imports run. We do
 * NOT mock; the route is a thin Drizzle wrapper and mocking it would test
 * nothing.
 *
 * Pre-flight P1 (rubrics/milestone-m2-calendar.md): this endpoint exists and
 * returns >= 1 event.
 */
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/route";
import { formatPriceDisplay } from "@/lib/format/price";

const VALID_CATEGORIES = ["music", "comedy", "lectures", "dancing", "food"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

type ApiVenue = {
  id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

type ApiEvent = {
  id: string;
  title: string;
  category: Category;
  startTimeUtc: string;
  endTimeUtc: string | null;
  timezone: string;
  venue: ApiVenue;
  source: string;
  sourceUrl: string;
  verificationLevel: string;
  pricing: { priceMin: number | null; priceMax: number | null; isFree: boolean };
  priceDisplay: string;
  description: string | null;
  seriesId: string | null;
};

type ApiResponse = {
  events: ApiEvent[];
  total: number;
  limit: number;
  offset: number;
};

function call(query: string): Promise<Response> {
  const url = `http://localhost/api/events${query}`;
  return GET(new NextRequest(url));
}

async function json(query: string): Promise<{ res: Response; body: ApiResponse }> {
  const res = await call(query);
  const body = (await res.json()) as ApiResponse;
  return { res, body };
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — tests need a live DB. Copy .env.local into the worktree.",
    );
  }
});

describe("GET /api/events — shape + happy path", () => {
  it("returns 200 with an envelope { events, total, limit, offset }", async () => {
    const { res, body } = await json("?limit=3");
    expect(res.status).toBe(200);
    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit", 3);
    expect(body).toHaveProperty("offset", 0);
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("applies the documented Cache-Control header", async () => {
    const res = await call("?limit=1");
    expect(res.headers.get("Cache-Control")).toBe(
      "s-maxage=900, stale-while-revalidate=86400",
    );
  });

  it("returns events with the documented shape and a priceDisplay string", async () => {
    const { body } = await json("?limit=5");
    expect(body.events.length).toBeGreaterThan(0);

    for (const e of body.events) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.title).toBe("string");
      expect(VALID_CATEGORIES).toContain(e.category);
      expect(typeof e.startTimeUtc).toBe("string");
      expect(new Date(e.startTimeUtc).toString()).not.toBe("Invalid Date");
      if (e.endTimeUtc != null) {
        expect(new Date(e.endTimeUtc).toString()).not.toBe("Invalid Date");
      }
      expect(typeof e.timezone).toBe("string");

      // venue
      expect(typeof e.venue.id).toBe("string");
      expect(typeof e.venue.name).toBe("string");

      // source link (D12 invariant — every event has one)
      expect(typeof e.sourceUrl).toBe("string");
      expect(e.sourceUrl.length).toBeGreaterThan(0);

      // pricing
      expect(e.pricing).toBeDefined();
      expect(typeof e.pricing.isFree).toBe("boolean");

      // priceDisplay must match formatPriceDisplay() server-side (D13 / E4).
      expect(e.priceDisplay).toBe(formatPriceDisplay(e.pricing));
      expect(e.priceDisplay.length).toBeGreaterThan(0);
    }
  });

  it("returns events sorted by startTimeUtc ASC", async () => {
    const { body } = await json("?limit=20");
    expect(body.events.length).toBeGreaterThan(1);
    for (let i = 1; i < body.events.length; i++) {
      expect(
        new Date(body.events[i].startTimeUtc).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(body.events[i - 1].startTimeUtc).getTime(),
      );
    }
  });
});

describe("GET /api/events — filters", () => {
  it("filters by category (single)", async () => {
    const { body } = await json("?category=comedy&limit=50");
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) expect(e.category).toBe("comedy");
  });

  it("filters by multiple categories (OR)", async () => {
    const { body } = await json(
      "?category=comedy&category=lectures&limit=50",
    );
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      expect(["comedy", "lectures"]).toContain(e.category);
    }
  });

  it("filters by date range — to bound is respected", async () => {
    // Window: today + next 3 days.
    const from = new Date();
    const to = new Date(from.getTime() + 3 * 86_400_000);
    const q =
      `?from=${encodeURIComponent(from.toISOString())}` +
      `&to=${encodeURIComponent(to.toISOString())}` +
      `&limit=100`;
    const { body } = await json(q);
    for (const e of body.events) {
      const t = new Date(e.startTimeUtc).getTime();
      expect(t).toBeGreaterThanOrEqual(from.getTime());
      expect(t).toBeLessThanOrEqual(to.getTime());
    }
  });

  it("filters by neighborhood (case-insensitive)", async () => {
    // Pick a neighborhood that actually exists in the DB.
    const seed = await json("?limit=100");
    const pop = new Map<string, number>();
    for (const e of seed.body.events) {
      if (e.venue.neighborhood) {
        pop.set(
          e.venue.neighborhood,
          (pop.get(e.venue.neighborhood) ?? 0) + 1,
        );
      }
    }
    const [target] = [...pop.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!target) {
      // No neighborhoods at all — skip rather than fail.
      return;
    }

    // Use a weirdly-cased version to prove case-insensitivity.
    const cased =
      target[0].toLowerCase() + target.slice(1).toUpperCase();
    const { body } = await json(
      `?neighborhood=${encodeURIComponent(cased)}&limit=50`,
    );
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      expect(e.venue.neighborhood?.toLowerCase()).toBe(target.toLowerCase());
    }
  });
});

describe("GET /api/events — pagination", () => {
  it("limit and offset slice the result set; total is pre-pagination", async () => {
    const page1 = await json("?limit=2&offset=0");
    const page2 = await json("?limit=2&offset=2");

    expect(page1.body.limit).toBe(2);
    expect(page1.body.offset).toBe(0);
    expect(page2.body.limit).toBe(2);
    expect(page2.body.offset).toBe(2);

    // total is the pre-pagination count and should be identical across pages.
    expect(page1.body.total).toBe(page2.body.total);

    // Both pages have <= limit events.
    expect(page1.body.events.length).toBeLessThanOrEqual(2);
    expect(page2.body.events.length).toBeLessThanOrEqual(2);

    // Disjoint page contents (sort + id-tiebreak is stable).
    const ids1 = new Set(page1.body.events.map((e) => e.id));
    for (const e of page2.body.events) {
      expect(ids1.has(e.id)).toBe(false);
    }
  });

  it("total is monotonically >= returned event count", async () => {
    const { body } = await json("?limit=5");
    expect(body.total).toBeGreaterThanOrEqual(body.events.length);
  });
});

describe("GET /api/events — input validation (400)", () => {
  it("rejects an unknown category", async () => {
    const res = await call("?category=bogus");
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/invalid category/i);
  });

  it("rejects a malformed 'from' date", async () => {
    const res = await call("?from=not-a-date");
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/invalid 'from'/);
  });

  it("rejects a malformed 'to' date", async () => {
    const res = await call("?to=banana");
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toMatch(/invalid 'to'/);
  });

  it("rejects a negative offset", async () => {
    const res = await call("?offset=-1");
    expect(res.status).toBe(400);
  });

  it("rejects limit above the max", async () => {
    const res = await call("?limit=501");
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer limit", async () => {
    const res = await call("?limit=1.5");
    expect(res.status).toBe(400);
  });

  it("rejects when to is before from", async () => {
    const res = await call("?from=2027-06-01&to=2026-06-01");
    expect(res.status).toBe(400);
  });
});
