import { fingerprint } from "@/lib/identity";
import type {
  Category,
  FetchResult,
  NormalizedEvent,
  PriceInfo,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
  VerificationLevel,
} from "./types";

/**
 * Ticketmaster Discovery API — Tier-1 (api) adapter.
 *
 * Endpoint:
 *   GET https://app.ticketmaster.com/discovery/v2/events.json
 *
 * Auth: API key passed as `apikey` query parameter (read from
 * `TICKETMASTER_CONSUMER_KEY` env var). The Discovery API does not require the
 * consumer secret.
 *
 * Pagination: `size=200` per page, walk `page=0..MAX_PAGES-1` and stop when a
 * page returns zero events. Free tier allows 5000 calls/day; one ingest run
 * uses at most `MAX_PAGES * classifications.length` calls.
 *
 * Category mapping (segment / genre → our 5-cat taxonomy):
 *   - segment "Music"                                  → "music"
 *   - segment "Arts & Theatre" AND genre/subGenre
 *     contains "Comedy"                                → "comedy"
 *   - everything else                                  → SKIP
 *
 * D6 (M3 rubric): drop events whose startTimeUtc is more than 24h in the past.
 */

const ID = "ticketmaster";
const API_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const TZ_FALLBACK = "America/Los_Angeles";
const VERIFICATION: VerificationLevel = "trusted_partner";
const MAX_PAGES = 5; // 5 * 200 = 1000 events per classification, plenty for a 30-day horizon
const PAGE_SIZE = 200;
const CLASSIFICATIONS = ["Music", "Comedy"] as const;

const USER_AGENT =
  "sf-events-aggregator/1.0 (+https://github.com/shane836/sf-events-aggregator)";

// Light hardcoded neighborhood lookup for well-known SF venues. Anything we
// don't recognize stays null and the persister/UI fall back to the address.
const KNOWN_VENUE_NEIGHBORHOODS: Record<string, string> = {
  "the fillmore": "Western Addition",
  "great american music hall": "Tenderloin",
  "the warfield": "Mid-Market",
  "the chapel": "Mission",
  "the independent": "Western Addition",
  "bimbo's 365 club": "North Beach",
  "bimbos 365 club": "North Beach",
  "august hall": "Union Square",
  "cobb's comedy club": "North Beach",
  "cobbs comedy club": "North Beach",
  "punch line san francisco": "Financial District",
  "punch line comedy club san francisco": "Financial District",
  "palace of fine arts": "Marina",
  "chase center": "Mission Bay",
  "the masonic": "Nob Hill",
  "regency ballroom": "Polk Gulch",
  "the regency ballroom": "Polk Gulch",
};

/** Narrow JSON helpers — Ticketmaster's shape is loose, treat everything as unknown. */

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function getString(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function getNumber(
  obj: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Map a Ticketmaster classification to our category or null (=> SKIP). */
export function mapCategory(
  classification: Record<string, unknown> | null,
): Category | null {
  if (!classification) return null;
  const segment = getString(asObject(classification.segment), "name");
  if (!segment) return null;
  if (segment === "Music") return "music";
  if (segment === "Arts & Theatre") {
    const genre = getString(asObject(classification.genre), "name");
    const subGenre = getString(asObject(classification.subGenre), "name");
    if (
      (genre && /comedy/i.test(genre)) ||
      (subGenre && /comedy/i.test(subGenre))
    ) {
      return "comedy";
    }
  }
  return null;
}

function inferNeighborhood(venueName: string | null): string | null {
  if (!venueName) return null;
  const key = venueName.toLowerCase().trim();
  return KNOWN_VENUE_NEIGHBORHOODS[key] ?? null;
}

function buildAddress(
  address: Record<string, unknown> | null,
  city: Record<string, unknown> | null,
  state: Record<string, unknown> | null,
  postalCode: string | null,
): string | null {
  const line1 = getString(address, "line1");
  const cityName = getString(city, "name");
  const stateCode = getString(state, "stateCode");
  const parts: string[] = [];
  if (line1) parts.push(line1);
  const cityState = [cityName, stateCode].filter(Boolean).join(", ");
  if (cityState) parts.push(cityState);
  if (postalCode) parts.push(postalCode);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildPricing(priceRanges: unknown): PriceInfo {
  const first = asArray(priceRanges)[0];
  const pr = asObject(first);
  if (!pr) {
    // Canonical "Price varies" representation: null/null/false.
    return { priceMin: null, priceMax: null, isFree: false };
  }
  const min = getNumber(pr, "min");
  const max = getNumber(pr, "max");
  if (min == null && max == null) {
    return { priceMin: null, priceMax: null, isFree: false };
  }
  return {
    priceMin: min,
    priceMax: max,
    isFree: false,
  };
}

/**
 * Parse one Ticketmaster event JSON object into a RawEvent.
 * Returns null when required fields are missing, the classification doesn't
 * map to music/comedy, or the event is past-dated (D6).
 */
export function parseEvent(
  ev: Record<string, unknown>,
  fetchedAt: Date,
  nowMs: number = Date.now(),
): RawEvent | null {
  const id = getString(ev, "id");
  const name = getString(ev, "name");
  const url = getString(ev, "url");
  if (!id || !name || !url) return null;

  const dates = asObject(ev.dates);
  const start = asObject(dates?.start);
  const dateTimeStr = getString(start, "dateTime");
  if (!dateTimeStr) return null;

  const startTimeUtc = new Date(dateTimeStr);
  if (Number.isNaN(startTimeUtc.getTime())) return null;

  // D6: drop events more than 24h in the past.
  if (startTimeUtc.getTime() < nowMs - 24 * 60 * 60 * 1000) return null;

  const classifications = asArray(ev.classifications);
  const primaryClass =
    asObject(
      classifications.find(
        (c) => asObject(c)?.primary === true,
      ),
    ) ?? asObject(classifications[0]);

  const category = mapCategory(primaryClass);
  if (!category) return null;

  const timezone = getString(dates, "timezone") ?? TZ_FALLBACK;

  const venues = asArray(asObject(ev._embedded)?.venues);
  const venueObj = asObject(venues[0]);
  const venueName = getString(venueObj, "name") ?? "Unknown venue";
  const address = buildAddress(
    asObject(venueObj?.address),
    asObject(venueObj?.city),
    asObject(venueObj?.state),
    getString(venueObj, "postalCode"),
  );
  const location = asObject(venueObj?.location);
  const lat = getNumber(location, "latitude");
  const lng = getNumber(location, "longitude");

  const pricing = buildPricing(ev.priceRanges);

  return {
    identity: {
      source: ID,
      externalId: id,
      sourceUrl: url,
    },
    title: name,
    description: getString(ev, "info"),
    startTimeUtc,
    endTimeUtc: null,
    timezone,
    venue: {
      externalVenueId: getString(venueObj, "id"),
      name: venueName,
      neighborhood: inferNeighborhood(venueName),
      address,
      lat,
      lng,
      timezone,
    },
    primaryCategory: category,
    pricing,
    recurrence: null,
    verificationLevel: VERIFICATION,
    rawPayload: {
      id,
      name,
      url,
      classification: primaryClass,
    },
    fetchedAt,
  };
}

async function fetchPage(
  apiKey: string,
  classification: string,
  page: number,
): Promise<{
  events: Record<string, unknown>[];
  error: SourceError | null;
}> {
  const url = new URL(API_BASE);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("city", "San Francisco");
  url.searchParams.set("stateCode", "CA");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("classificationName", classification);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json",
      },
    });
  } catch (err) {
    return {
      events: [],
      error: {
        source: ID,
        stage: "fetch",
        message: `network error (${classification} p${page}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: true,
        occurredAt: new Date(),
      },
    };
  }

  if (!res.ok) {
    return {
      events: [],
      error: {
        source: ID,
        stage: "fetch",
        message: `HTTP ${res.status} (${classification} p${page})`,
        retryable: res.status >= 500 || res.status === 429,
        httpStatus: res.status,
        rateLimited: res.status === 429,
        occurredAt: new Date(),
      },
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      events: [],
      error: {
        source: ID,
        stage: "parse",
        message: `invalid JSON (${classification} p${page}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        occurredAt: new Date(),
      },
    };
  }

  const events = asArray(asObject(asObject(body)?._embedded)?.events) as Record<
    string,
    unknown
  >[];
  return { events, error: null };
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "api",
  verificationLevel: VERIFICATION,

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();
    const nowMs = fetchedAt.getTime();

    const apiKey = process.env.TICKETMASTER_CONSUMER_KEY;
    if (!apiKey || apiKey.trim() === "") {
      errors.push({
        source: ID,
        stage: "fetch",
        message:
          "TICKETMASTER_CONSUMER_KEY env var is missing — cannot call Discovery API",
        retryable: false,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    const seenIds = new Set<string>();

    for (const classification of CLASSIFICATIONS) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const { events: rawEvents, error } = await fetchPage(
          apiKey,
          classification,
          page,
        );
        if (error) {
          errors.push(error);
          // Stop paginating this classification on error, but continue with the
          // next classification — partial coverage is better than nothing.
          break;
        }
        if (rawEvents.length === 0) break;

        for (const rawEv of rawEvents) {
          try {
            const parsed = parseEvent(rawEv, fetchedAt, nowMs);
            if (!parsed) continue;
            // De-dupe within a single run (an event listed under both Music and
            // a sub-classification could appear twice).
            if (seenIds.has(parsed.identity.externalId)) continue;
            seenIds.add(parsed.identity.externalId);
            events.push(parsed);
          } catch (err) {
            errors.push({
              source: ID,
              stage: "parse",
              message: err instanceof Error ? err.message : String(err),
              retryable: false,
              occurredAt: new Date(),
            });
          }
        }

        if (rawEvents.length < PAGE_SIZE) break; // last page
      }
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
