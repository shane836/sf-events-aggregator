/**
 * Internal query layer for the digest renderer.
 *
 * Reads events for the next 7 days, optionally filtered by category.
 * Reuses the events table + venues join from `app/api/events/route.ts`,
 * but as a direct DB call (no HTTP roundtrip).
 *
 * Per docs/IDENTITY.md ownership rules, Stream F reads via this query and
 * writes only to `digest_sends`. No other table is touched.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { events, venues } from "@/db/schema";
import { formatPriceDisplay } from "@/lib/format/price";
import type { Category, PriceInfo, VerificationLevel } from "@/lib/sources/types";
import {
  DIGEST_WINDOW_DAYS,
  EVENT_CAP,
  type DigestEvent,
} from "./types";

export type QueryOptions = {
  /** "now" — defaults to current time, override in tests. */
  now?: Date;
  /** Optional category filter; null/undefined means all categories. */
  categories?: Category[] | null;
  /** Cap on rows returned; defaults to EVENT_CAP. */
  limit?: number;
};

/**
 * Fetch up to `EVENT_CAP` events starting in the next 7 days, sorted
 * ascending by start time. Returns the shape the email template consumes.
 */
export async function queryDigestEvents(
  opts: QueryOptions = {},
): Promise<DigestEvent[]> {
  const now = opts.now ?? new Date();
  const to = new Date(now.getTime() + DIGEST_WINDOW_DAYS * 86_400_000);
  const limit = opts.limit ?? EVENT_CAP;

  const conditions = [
    gte(events.startTimeUtc, now),
    lte(events.startTimeUtc, to),
  ];

  if (opts.categories && opts.categories.length > 0) {
    conditions.push(inArray(events.category, opts.categories));
  }

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      category: events.category,
      startTimeUtc: events.startTimeUtc,
      endTimeUtc: events.endTimeUtc,
      timezone: events.timezone,
      sourceUrl: events.sourceUrl,
      verificationLevel: events.verificationLevel,
      priceMin: events.priceMin,
      priceMax: events.priceMax,
      isFree: events.isFree,
      venueName: venues.name,
      venueNeighborhood: venues.neighborhood,
    })
    .from(events)
    .innerJoin(venues, eq(events.venueId, venues.id))
    .where(and(...conditions))
    .orderBy(asc(events.startTimeUtc), asc(events.id))
    .limit(limit);

  return rows.map((r): DigestEvent => {
    const pricing: PriceInfo = {
      priceMin: r.priceMin != null ? Number(r.priceMin) : null,
      priceMax: r.priceMax != null ? Number(r.priceMax) : null,
      isFree: r.isFree,
    };
    return {
      id: r.id,
      title: r.title,
      category: r.category as Category,
      startTimeUtc: r.startTimeUtc.toISOString(),
      endTimeUtc: r.endTimeUtc != null ? r.endTimeUtc.toISOString() : null,
      timezone: r.timezone,
      venue: {
        name: r.venueName,
        neighborhood: r.venueNeighborhood,
      },
      sourceUrl: r.sourceUrl,
      verificationLevel: r.verificationLevel as VerificationLevel,
      pricing,
      priceDisplay: formatPriceDisplay(pricing),
    };
  });
}
