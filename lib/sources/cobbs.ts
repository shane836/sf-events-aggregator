import {
  fetchHtml,
  filterEventNodes,
  parseJsonLd,
} from "@/lib/scrape";
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
} from "./types";

/**
 * Cobb's Comedy Club (North Beach, SF) — Tier-3 scraper.
 *
 * Method: JSON-LD first (`MusicEvent` nodes are embedded on /shows, one per
 * show; the page renders ~36 entries). No `offers` field is provided, so we
 * use a conservative price floor for Cobb's general admission tickets (D2 in
 * milestone-m3-scrapers requires non-null pricing OR isFree=true).
 *
 * The schema.org type on Cobb's pages is "MusicEvent", but Cobb's is a
 * dedicated comedy venue, so we hard-code primaryCategory='comedy'.
 *
 * Robots.txt: `User-agent: * / Allow: /` — scraping /shows is permitted.
 */

const ID = "scrape:cobbs";
const LISTING_URL = "https://www.cobbscomedy.com/shows";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Cobb's Comedy Club";
const NEIGHBORHOOD = "North Beach";
const VENUE_ADDRESS = "915 Columbus Ave, San Francisco, CA 94133";
const VENUE_LAT = 37.802909;
const VENUE_LNG = -122.414217;

// Cobb's headliners and showcase tickets start around $25 GA; JSON-LD on this
// site never carries explicit prices, so we set a floor and let priceMax
// remain null. Renderer turns this into "$25+".
const PRICE_FLOOR_USD = 25;

const CATEGORY: Category = "comedy";

function getString(node: Record<string, unknown>, key: string): string | null {
  const v = node[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function getNested(
  node: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const v = node[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/**
 * Parse one schema.org Event node into a RawEvent. Returns null when the
 * node is missing required identity fields (url, startDate, name).
 */
export function parseEventNode(
  node: Record<string, unknown>,
  fetchedAt: Date,
): RawEvent | null {
  const name = getString(node, "name");
  const startStr = getString(node, "startDate");
  const url = getString(node, "url");
  if (!name || !startStr || !url) return null;

  const startTimeUtc = new Date(startStr);
  if (Number.isNaN(startTimeUtc.getTime())) return null;

  const endStr = getString(node, "endDate");
  const endTimeUtc = endStr ? new Date(endStr) : null;
  const endValid = endTimeUtc && !Number.isNaN(endTimeUtc.getTime())
    ? endTimeUtc
    : null;

  const location = getNested(node, "location");
  const locName = location ? getString(location, "name") : null;
  const venueName = locName ?? VENUE_NAME;

  const address = location ? getNested(location, "address") : null;
  let venueAddress: string | null = VENUE_ADDRESS;
  if (address) {
    const street = getString(address, "streetAddress");
    const locality = getString(address, "addressLocality");
    const region = getString(address, "addressRegion");
    const postal = getString(address, "postalCode");
    const parts = [street, [locality, region].filter(Boolean).join(", "), postal]
      .filter(Boolean)
      .join(", ");
    if (parts) venueAddress = parts;
  }

  const geo = location ? getNested(location, "geo") : null;
  const lat =
    geo && typeof geo.latitude === "number" ? geo.latitude : VENUE_LAT;
  const lng =
    geo && typeof geo.longitude === "number" ? geo.longitude : VENUE_LNG;

  // externalId: use the ticket URL — stable per show, unique across the
  // page. Falls back to the URL if no obvious id segment exists.
  const externalId = url;

  const pricing: PriceInfo = {
    priceMin: PRICE_FLOOR_USD,
    priceMax: null,
    isFree: false,
  };

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: url,
    },
    title: name,
    description: getString(node, "description"),
    startTimeUtc,
    endTimeUtc: endValid,
    timezone: TZ,
    venue: {
      name: venueName,
      neighborhood: NEIGHBORHOOD,
      address: venueAddress,
      lat,
      lng,
      timezone: TZ,
    },
    primaryCategory: CATEGORY,
    pricing,
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      name,
      startDate: startStr,
      url,
    },
    fetchedAt,
  };
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    try {
      const { $ } = await fetchHtml(LISTING_URL);
      const ldNodes = parseJsonLd($);
      const eventNodes = filterEventNodes(ldNodes);

      if (eventNodes.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `no schema.org Event nodes found at ${LISTING_URL}`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const seen = new Set<string>();
      for (const node of eventNodes) {
        try {
          const ev = parseEventNode(node, fetchedAt);
          if (!ev) continue;
          // De-dupe within a single page on externalId (the ticket URL).
          if (seen.has(ev.identity.externalId)) continue;
          seen.add(ev.identity.externalId);
          events.push(ev);
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
