import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import {
  parseCost,
  parseListingHtml,
  parsePacificWallString,
  type ParsedListingItem,
} from "@/lib/funcheap";
import { EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY } from "@/lib/ui/cities";
import type {
  Category,
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * Funcheap East Bay — Tier-3 scraper, broad free/cheap coverage.
 *
 * Funcheap has no `eastbay.` subdomain; the East Bay lives on the main site as
 * an event-location archive:
 *   https://sf.funcheap.com/category/event/event-locations/east-bay/
 * Same WordPress `div.tanbox` markup as the SF food adapter, so listing/date/
 * cost parsing is shared via `lib/funcheap.ts`.
 *
 * Unlike the single-category food feed, this location feed mixes categories, so
 * we keyword-classify each item into our taxonomy and SKIP what doesn't map.
 * Funcheap groups the whole region as "East Bay" without a per-event city, so
 * we detect a specific city from the title/venue when one is named and
 * otherwise tag the generic "East Bay" bucket (which the "All East Bay"
 * selector includes).
 *
 * Editorial aggregator → verificationLevel "community". robots.txt only blocks
 * /search/ and `?s=` query forms; the event-location archive is allowed.
 */

const ID = "scrape:funcheapeastbay";
const LISTING_URL =
  "https://sf.funcheap.com/category/event/event-locations/east-bay/";
const TZ = "America/Los_Angeles";
const MAX_EVENTS = 100;

/**
 * Map a Funcheap listing's title/venue to our taxonomy, or null to SKIP.
 * Order is deliberate: comedy and dance/DJ nights win over a generic "music"
 * read, food over everything food-shaped.
 */
export function classifyCategory(
  title: string,
  venue: string | null,
): Category | null {
  const text = `${title} ${venue ?? ""}`.toLowerCase();

  if (/comedy|stand-?up|improv|open mic.*comed/.test(text)) return "comedy";
  if (
    /\bdance\b|dancing|salsa|bachata|cumbia|ballroom|\brave\b|club night|disco|\bdj\b/.test(
      text,
    )
  ) {
    return "dancing";
  }
  if (
    /\bfood\b|food truck|tasting|brunch|happy hour|\bwine\b|\bbeer\b|cocktail|culinary|night market|farmers? market|pop-?up/.test(
      text,
    )
  ) {
    return "food";
  }
  if (
    /concert|live music|\bband\b|jazz|orchestra|symphony|acoustic|hip-?hop|songwriter|tribute|open mic/.test(
      text,
    )
  ) {
    return "music";
  }
  if (
    /lecture|\btalk\b|\bauthor\b|book reading|\breading\b|seminar|workshop|panel|poetry|spoken word|history/.test(
      text,
    )
  ) {
    return "lectures";
  }
  return null;
}

/**
 * Best-effort city from the title/venue text. Funcheap's feed is region-wide;
 * when no specific East Bay city is named we fall back to the generic bucket.
 */
export function detectCity(title: string, venue: string | null): string {
  const text = `${title} ${venue ?? ""}`;
  for (const city of EAST_BAY_CITY_NAMES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(text)) return city;
  }
  return GENERIC_EAST_BAY;
}

/**
 * Lift one parsed listing item into a RawEvent, or null when it lacks a usable
 * start time or doesn't map to our taxonomy.
 */
export function buildRawEvent(
  item: ParsedListingItem,
  fetchedAt: Date,
): RawEvent | null {
  const startTimeUtc = parsePacificWallString(item.startLocal);
  if (!startTimeUtc) return null;

  const category = classifyCategory(item.title, item.venueName);
  if (!category) return null;

  const endTimeUtc = item.endLocal
    ? parsePacificWallString(item.endLocal)
    : null;
  const venueName = item.venueName ?? item.title;

  return {
    identity: { source: ID, externalId: item.postId, sourceUrl: item.url },
    title: item.title,
    description: null,
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: venueName,
      city: detectCity(item.title, item.venueName),
      neighborhood: null,
      address: null,
      lat: null,
      lng: null,
      timezone: TZ,
    },
    primaryCategory: category,
    pricing: parseCost(item.costText),
    recurrence: null,
    verificationLevel: "community",
    rawPayload: {
      postId: item.postId,
      title: item.title,
      url: item.url,
      startLocal: item.startLocal,
      costText: item.costText,
      venueName: item.venueName,
    },
    fetchedAt,
  };
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "community",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    try {
      const { html } = await fetchHtml(LISTING_URL);
      const items = parseListingHtml(html);

      if (items.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `no event items matched on ${LISTING_URL} — page format may have changed`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const seen = new Set<string>();
      for (const item of items.slice(0, MAX_EVENTS)) {
        try {
          const ev = buildRawEvent(item, fetchedAt);
          if (!ev) continue;
          if (seen.has(ev.identity.externalId)) continue;
          seen.add(ev.identity.externalId);
          events.push(ev);
        } catch (err) {
          errors.push({
            source: ID,
            externalId: item.postId,
            stage: "parse",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
            occurredAt: new Date(),
          });
        }
      }
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
    }

    return { events, errors, fetchedAt };
  },

  normalize(raw: RawEvent, provenance: Provenance): NormalizedEvent {
    const canonicalFingerprint = fingerprint({
      title: raw.title,
      venueName: raw.venue.name,
      startTimeUtc: raw.startTimeUtc,
      timezone: raw.timezone,
    });

    return {
      canonicalFingerprint,
      identity: raw.identity,
      title: raw.title,
      description: raw.description ?? null,
      startTimeUtc: raw.startTimeUtc,
      endTimeUtc: raw.endTimeUtc ?? null,
      timezone: raw.timezone,
      category: raw.primaryCategory,
      pricing: raw.pricing ?? { priceMin: null, priceMax: null, isFree: false },
      venue: raw.venue,
      recurrence: raw.recurrence ?? null,
      verificationLevel: raw.verificationLevel,
      rawPayload: raw.rawPayload,
      provenance,
    };
  },
};

export default adapter;
