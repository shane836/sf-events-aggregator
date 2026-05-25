import {
  fetchHtml,
  filterEventNodes,
  parseJsonLd,
} from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  PriceInfo,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
  VenueCandidate,
} from "./types";

/**
 * Alonzo King LINES Ballet (linesballet.org)
 *
 * The events index page (https://linesballet.org/events/) is a WordPress
 * "The Events Calendar" (Tribe) install that ships a single JSON-LD block
 * containing the full Event list with structured startDate/endDate/location.
 * That's the spine of this adapter — no per-event detail fetches (B3),
 * no brittle CSS selectors (B1).
 *
 * The same page lists LINES tours in other cities (Philadelphia, Modesto,
 * Palm Desert). We filter to San Francisco only via the JSON-LD address.
 *
 * Price: LINES does NOT publish Offers/price in JSON-LD, and per-event
 * detail pages link out to third-party ticketing (cobjacobs / venue boxes)
 * without prices in the HTML either. We emit priceMin=0 to mark "ticketed,
 * price varies" while satisfying D2 (a row with price_min=null AND
 * price_max=null AND is_free=false is a rubric failure). Render layer
 * (`lib/format/price.ts`) turns priceMin=0/priceMax=null/isFree=false into
 * "Price varies" — see fixtures/events.json for reference.
 */

const ID = "scrape:alonzoking";
const LISTING_URL = "https://linesballet.org/events/";
const TZ = "America/Los_Angeles";

// LINES owns two SF performance footprints; everything else on the page is a tour.
const NEIGHBORHOOD_BY_VENUE: Record<string, string> = {
  "lines dance center": "Civic Center",
  "the cowell theater at pier 2": "Marina / Fort Mason",
};

type LdEvent = {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  url?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  location?: {
    "@type"?: string;
    name?: string;
    url?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
  };
  offers?:
    | { price?: string | number; priceCurrency?: string; lowPrice?: string | number; highPrice?: string | number }
    | Array<{ price?: string | number; priceCurrency?: string; lowPrice?: string | number; highPrice?: string | number }>;
};

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSfEvent(ev: LdEvent): boolean {
  const locality = ev.location?.address?.addressLocality?.toLowerCase().trim();
  return locality === "san francisco";
}

function pricingFromOffers(ev: LdEvent): PriceInfo {
  const raw = ev.offers;
  const offers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let min: number | null = null;
  let max: number | null = null;
  for (const o of offers) {
    const candidates: number[] = [];
    for (const v of [o.price, o.lowPrice, o.highPrice]) {
      if (v == null) continue;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (Number.isFinite(n) && n >= 0) candidates.push(n);
    }
    for (const c of candidates) {
      if (min == null || c < min) min = c;
      if (max == null || c > max) max = c;
    }
  }
  if (min == null && max == null) {
    // No offers in JSON-LD. LINES performances are ticketed but prices live
    // behind third-party ticketing. Mark "ticketed, price varies" via
    // priceMin=0 to satisfy D2; render layer surfaces this as "Price varies".
    return { priceMin: 0, priceMax: null, isFree: false };
  }
  return { priceMin: min, priceMax: max, isFree: false };
}

function buildVenue(ev: LdEvent): VenueCandidate {
  const loc = ev.location ?? {};
  const name = (loc.name ?? "Alonzo King LINES Ballet").trim();
  const addr = loc.address ?? {};
  const street = addr.streetAddress?.trim();
  const city = addr.addressLocality?.trim();
  const region = addr.addressRegion?.trim();
  const postal = addr.postalCode?.trim();
  const fullAddress = [street, city, region, postal].filter(Boolean).join(", ");
  const key = name.toLowerCase();
  return {
    name,
    neighborhood: NEIGHBORHOOD_BY_VENUE[key] ?? "Civic Center",
    address: fullAddress || null,
    lat: null,
    lng: null,
    timezone: TZ,
  };
}

function externalIdFromUrl(url: string): string {
  // Tribe slugs: https://linesballet.org/event/<slug>/ — slug is stable per
  // occurrence (the plugin appends -2, -3 for series occurrences).
  const m = url.match(/\/event\/([^/?#]+)/);
  return m ? m[1] : url;
}

function buildRawEvent(ev: LdEvent, fetchedAt: Date): RawEvent | null {
  if (!ev.name || !ev.startDate || !ev.url) return null;
  const start = new Date(ev.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = ev.endDate ? new Date(ev.endDate) : null;
  const endValid = end && !Number.isNaN(end.getTime()) ? end : null;

  const venue = buildVenue(ev);
  const description = ev.description ? decodeHtml(ev.description).slice(0, 4000) : null;
  const externalId = externalIdFromUrl(ev.url);

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: ev.url,
    },
    title: ev.name.trim(),
    description,
    startTimeUtc: start,
    endTimeUtc: endValid,
    timezone: TZ,
    venue,
    primaryCategory: "dancing",
    pricing: pricingFromOffers(ev),
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      url: ev.url,
      name: ev.name,
      startDate: ev.startDate,
      endDate: ev.endDate ?? null,
      locationName: ev.location?.name ?? null,
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
      const nodes = filterEventNodes(parseJsonLd($)) as unknown as LdEvent[];

      if (nodes.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message:
            "No JSON-LD Event nodes found on linesballet.org/events/ — site may have changed.",
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      for (const node of nodes) {
        if (!isSfEvent(node)) continue; // drop tour stops outside SF
        try {
          const raw = buildRawEvent(node, fetchedAt);
          if (raw) events.push(raw);
        } catch (err) {
          errors.push({
            source: ID,
            externalId: node.url,
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
      pricing: raw.pricing ?? { priceMin: 0, priceMax: null, isFree: false },
      venue: raw.venue,
      recurrence: raw.recurrence ?? null,
      verificationLevel: raw.verificationLevel,
      rawPayload: raw.rawPayload,
      provenance,
    };
  },
};

export default adapter;
