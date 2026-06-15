import { fetchHtml, parseJsonLd, filterEventNodes, resolveUrl } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import { INGEST_CITY_NAMES } from "@/lib/ui/cities";
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
 * Eventbrite (East Bay) — Tier-3 JSON-LD scraper.
 *
 * Eventbrite's public discovery API was retired, but its public pages are
 * crawlable (robots.txt allows /d/ discovery, /e/ event, /o/ organizer) and
 * every event detail page ships a schema.org `Event` JSON-LD block. So we:
 *
 *   1. fetch each East Bay city's discovery listing and harvest `/e/` event
 *      URLs from the anchors (one request per city);
 *   2. fetch each event page (bounded by MAX_EVENTS) and parse its JSON-LD.
 *
 * City is taken from the event's own JSON-LD address (`addressLocality`), not
 * the discovery query — discovery listings bleed across the wider Bay Area, so
 * per-event addresses are the accurate signal. Events whose city isn't one we
 * cover, or whose title/description doesn't map to our 5-category taxonomy, are
 * skipped — precision over volume.
 *
 * Eventbrite is a ticketing platform with structured first-party listings →
 * verificationLevel "trusted_partner" (same tier as Ticketmaster).
 */

const ID = "scrape:eventbrite";
const TZ = "America/Los_Angeles";
const BASE = "https://www.eventbrite.com";

// One discovery listing per East Bay city. `--all-events` is the unfiltered
// city feed; we classify/skip per event afterward.
const DISCOVERY_PATHS: Record<string, string> = {
  Oakland: "/d/ca--oakland/all-events/",
  Berkeley: "/d/ca--berkeley/all-events/",
  Emeryville: "/d/ca--emeryville/all-events/",
  Alameda: "/d/ca--alameda/all-events/",
};

// Bound the per-run event-page fetches so a single source can't dominate the
// daily cron.
const MAX_EVENTS = 40;

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
 * Harvest distinct Eventbrite event-detail URLs from a discovery listing's
 * HTML. Event URLs look like `/e/<slug>-tickets-<id>`; we dedupe on the
 * trailing numeric id.
 */
export function extractEventUrls(html: string, baseUrl: string = BASE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\/e\/[a-z0-9-]*?(\d{6,})(?:[/?#]|")/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const path = m[0].replace(/["/?#]+$/, "");
    const abs = resolveUrl(path, baseUrl);
    if (abs) out.push(abs);
  }
  return out;
}

/** The numeric Eventbrite event id embedded in a `/e/...-<id>` URL. */
export function eventIdFromUrl(url: string): string | null {
  const m = /(\d{6,})(?:[/?#]|$)/.exec(url);
  return m ? m[1] : null;
}

/**
 * Resolve a JSON-LD `addressLocality` to one of the cities we cover (matched
 * case-insensitively against `venues.city` values). Returns null when the
 * event is outside our metros so the caller can skip it.
 */
export function resolveCity(addressLocality: string | null): string | null {
  if (!addressLocality) return null;
  const match = INGEST_CITY_NAMES.find(
    (c) => c.toLowerCase() === addressLocality.toLowerCase(),
  );
  return match ?? null;
}

/**
 * Map an Eventbrite event's text to our taxonomy, or null to SKIP. Eventbrite
 * lists everything (yacht parties, expos, marathons); we only keep clear
 * music / comedy / lectures / dancing / food.
 */
export function classifyCategory(
  name: string,
  description: string | null,
): Category | null {
  const text = `${name} ${description ?? ""}`.toLowerCase();

  if (/comedy|stand-?up|improv/.test(text)) return "comedy";
  if (
    /\bdance\b|dancing|salsa|bachata|cumbia|ballroom|\brave\b|club night|dj set|afrobeat/.test(
      text,
    )
  ) {
    return "dancing";
  }
  if (
    /\bfood\b|food truck|tasting|brunch|happy hour|\bwine\b|\bbeer\b|cocktail|culinary|night market|pop-?up dinner/.test(
      text,
    )
  ) {
    return "food";
  }
  if (
    /concert|live music|\bband\b|jazz|orchestra|symphony|acoustic|album release|residency|\bdj\b|hip-?hop/.test(
      text,
    )
  ) {
    return "music";
  }
  if (
    /lecture|artist talk|book reading|\bauthor\b|panel discussion|seminar|workshop|poetry|spoken word|\breading\b/.test(
      text,
    )
  ) {
    return "lectures";
  }
  return null;
}

function numberFrom(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Derive PriceInfo from a schema.org `offers` value (object or array). Eventbrite
 * uses `price` / `lowPrice` / `highPrice`. All-zero → free; absent → the
 * canonical "price varies" shape (null/null/false).
 */
export function parseOffers(offers: unknown): PriceInfo {
  const list = Array.isArray(offers) ? offers : offers != null ? [offers] : [];
  const prices: number[] = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const obj = o as Record<string, unknown>;
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const n = numberFrom(obj[key]);
      if (n != null) prices.push(n);
    }
  }
  if (prices.length === 0) {
    return { priceMin: null, priceMax: null, isFree: false };
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { priceMin: min, priceMax: max, isFree: min === 0 && max === 0 };
}

/**
 * Parse one schema.org Event JSON-LD node from an Eventbrite event page into a
 * RawEvent. Returns null when required identity fields are missing, the venue
 * is outside our cities, or the category doesn't map.
 */
export function parseEventbriteNode(
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
  const end = endStr ? new Date(endStr) : null;
  const endTimeUtc = end && !Number.isNaN(end.getTime()) ? end : null;

  const location = getNested(node, "location");
  const address = location ? getNested(location, "address") : null;
  const locality = address ? getString(address, "addressLocality") : null;
  const city = resolveCity(locality);
  if (!city) return null; // outside our metros

  const description = getString(node, "description");
  const category = classifyCategory(name, description);
  if (!category) return null; // outside our taxonomy

  const venueName = location ? getString(location, "name") : null;
  let venueAddress: string | null = null;
  if (address) {
    const street = getString(address, "streetAddress");
    const region = getString(address, "addressRegion");
    const postal = getString(address, "postalCode");
    venueAddress =
      [street, [locality, region].filter(Boolean).join(", "), postal]
        .filter(Boolean)
        .join(", ") || null;
  }

  const id = eventIdFromUrl(url) ?? url;

  return {
    identity: { source: ID, externalId: id, sourceUrl: url },
    title: name,
    description,
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: venueName ?? `${city} venue`,
      city,
      neighborhood: null,
      address: venueAddress,
      lat: null,
      lng: null,
      timezone: TZ,
    },
    primaryCategory: category,
    pricing: parseOffers(node.offers),
    recurrence: null,
    verificationLevel: "trusted_partner",
    rawPayload: { id, name, url },
    fetchedAt,
  };
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "trusted_partner",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    // Phase 1: harvest event-detail URLs from each city's discovery listing.
    const eventUrls: string[] = [];
    const seenIds = new Set<string>();
    for (const path of Object.values(DISCOVERY_PATHS)) {
      const listingUrl = `${BASE}${path}`;
      try {
        const { html } = await fetchHtml(listingUrl);
        for (const url of extractEventUrls(html, BASE)) {
          const id = eventIdFromUrl(url);
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          eventUrls.push(url);
        }
      } catch (err) {
        errors.push({
          source: ID,
          stage: "fetch",
          message: `discovery ${listingUrl}: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
          occurredAt: new Date(),
        });
      }
    }

    if (eventUrls.length === 0 && errors.length === 0) {
      errors.push({
        source: ID,
        stage: "parse",
        message: "no event URLs found on East Bay discovery listings — page format may have changed",
        retryable: false,
        occurredAt: new Date(),
      });
    }

    // Phase 2: fetch each event page (bounded) and parse its JSON-LD Event.
    for (const url of eventUrls.slice(0, MAX_EVENTS)) {
      try {
        const { $ } = await fetchHtml(url);
        const nodes = filterEventNodes(parseJsonLd($));
        for (const node of nodes) {
          const ev = parseEventbriteNode(node, fetchedAt);
          if (ev) events.push(ev);
        }
      } catch (err) {
        errors.push({
          source: ID,
          externalId: eventIdFromUrl(url) ?? undefined,
          stage: "parse",
          message: `event ${url}: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
          occurredAt: new Date(),
        });
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
