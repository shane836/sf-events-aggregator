import { fingerprint } from "@/lib/identity";
import { fetchHtml, parseJsonLd } from "@/lib/scrape";
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
 * Spark Social SF (Mission Bay) — Tier-3 scraper.
 *
 * RETARGET (replaces the original schedule-expansion adapter, which fabricated
 * 60 daily "Spark Social is open today" rows from posted operating hours).
 * The official events page (visitsparksocial.com/events/calendar/) renders an
 * Elfsight calendar widget entirely client-side — no extractable event data
 * exists in the static HTML, so we cannot use it as a source. Instead we mine
 * Eventbrite, which publishes Spark Social SF's *discrete* events (trivia
 * nights, neighborhood cleanups, food-truck collabs, popups) with full
 * schema.org JSON-LD on both its discovery pages and per-event pages.
 *
 * APPROACH (JSON-LD, two-stage):
 *   1. fetchHtml() the Eventbrite venue-discovery URL. It server-renders an
 *      ItemList JSON-LD block listing nearby events with location.name; we
 *      filter to events whose location.name is exactly "Spark Social SF".
 *   2. For each surviving listing entry (capped at MAX_DETAIL_FETCHES = 20 per
 *      M3 rubric B3), fetch the detail page and parse the schema.org Event
 *      JSON-LD. The detail page is where the precise startDate (ISO with TZ
 *      offset), endDate, and offers (lowPrice/highPrice or 0/0 for free) live.
 *      The listing JSON-LD only gives date-only startDate ("YYYY-MM-DD") and
 *      no offers, so detail traversal is mandatory for D2 (structured
 *      pricing) and B7 (correct timezone-aware startTimeUtc).
 *
 * Verification: events are scraped from Eventbrite (third-party listing
 * service Spark Social SF uses), not the venue's own site, so
 * verificationLevel is `community` rather than `official`.
 *
 * Robots.txt: eventbrite.com/robots.txt has no Disallow on /d/ (discovery)
 * or /e/ (event detail) for `User-agent: *`. B2 passes. The User-Agent on
 * every fetch is the project's identifier via fetchHtml's default.
 *
 * Past-date filter (M3 D6): events whose startTimeUtc is before fetchedAt
 * are dropped. Eventbrite listings are forward-looking but a date-tied event
 * can flip past during a long-running fetch; the filter keeps the adapter
 * safe under that edge.
 */

const ID = "scrape:sparksocial";
const LISTING_URL =
  "https://www.eventbrite.com/d/ca--san-francisco/spark-social/";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Spark Social SF";
const VENUE_NAME_NORMALIZED = VENUE_NAME.toLowerCase();
const NEIGHBORHOOD = "Mission Bay";
const VENUE_ADDRESS = "601 Mission Bay Boulevard North, San Francisco, CA 94158";
const VENUE_LAT = 37.7707793;
const VENUE_LNG = -122.3914307;
const CATEGORY: Category = "food";
// B3: cap detail fetches per the M3 rubric (one listing + ≤ 20 details).
const MAX_DETAIL_FETCHES = 20;

/**
 * schema.org subtypes Eventbrite uses for events at Spark Social. We use a
 * local matcher rather than the shared `filterEventNodes` because Eventbrite
 * frequently tags music/dance/food popups with `Festival`, which is a valid
 * Event subclass but doesn't end in "Event" (so the shared regex misses it).
 */
const EVENT_TYPES = new Set([
  "Event",
  "BusinessEvent",
  "ChildrensEvent",
  "ComedyEvent",
  "DanceEvent",
  "EducationEvent",
  "ExhibitionEvent",
  "Festival",
  "FoodEvent",
  "Hackathon",
  "LiteraryEvent",
  "MusicEvent",
  "PublicationEvent",
  "SaleEvent",
  "ScreeningEvent",
  "SocialEvent",
  "SportsEvent",
  "TheaterEvent",
  "VisualArtsEvent",
]);

function isEventNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== "object") return false;
  const t = (node as Record<string, unknown>)["@type"];
  if (typeof t === "string") return EVENT_TYPES.has(t);
  if (Array.isArray(t))
    return t.some((s) => typeof s === "string" && EVENT_TYPES.has(s));
  return false;
}

type ListingEntry = {
  url: string;
  startDate: string;
  name: string;
};

/**
 * Extract the URLs of upcoming events at Spark Social SF from the Eventbrite
 * discovery JSON-LD. Pure helper, exported for unit testing against a saved
 * fixture without driving fetch().
 */
export function parseListingEntries(html: string): ListingEntry[] {
  const blocks = extractJsonLdBlocks(html);
  const out: ListingEntry[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const items = extractItemListEvents(block);
    for (const item of items) {
      if (!isSparkSocialLocation(item)) continue;
      const url = pickString(item, "url");
      const startDate = pickString(item, "startDate");
      const name = pickString(item, "name");
      if (!url || !startDate || !name) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, startDate, name });
    }
  }

  return out;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Skip malformed blocks — Eventbrite has occasionally shipped one.
    }
  }
  return out;
}

function extractItemListEvents(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const items = obj.itemListElement;
  if (!Array.isArray(items)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const it = (entry as Record<string, unknown>).item;
    if (it && typeof it === "object") out.push(it as Record<string, unknown>);
  }
  return out;
}

function isSparkSocialLocation(item: Record<string, unknown>): boolean {
  const loc = item.location;
  if (!loc || typeof loc !== "object") return false;
  const name = (loc as Record<string, unknown>).name;
  if (typeof name !== "string") return false;
  return name.trim().toLowerCase() === VENUE_NAME_NORMALIZED;
}

function pickString(
  node: Record<string, unknown>,
  key: string,
): string | null {
  const v = node[key];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse one Eventbrite detail-page JSON-LD Event node into a RawEvent.
 * Pure helper — no IO, tested against fixtures.
 */
export function detailNodeToRawEvent(
  node: Record<string, unknown>,
  fallbackUrl: string,
  fetchedAt: Date,
): RawEvent | null {
  const title = pickString(node, "name");
  const startStr = pickString(node, "startDate");
  if (!title || !startStr) return null;

  const startTimeUtc = new Date(startStr);
  if (Number.isNaN(startTimeUtc.getTime())) return null;

  const endStr = pickString(node, "endDate");
  const endTimeUtc =
    endStr && !Number.isNaN(new Date(endStr).getTime())
      ? new Date(endStr)
      : null;

  // Canonical click-through is the URL we actually fetched (fallbackUrl, set
  // by the listing page), not the JSON-LD's `url` field. Eventbrite events
  // sometimes carry two ticket ids — the JSON-LD's `url` points at the older
  // / canonical event, while the offer URL (and the listing URL we retrieved)
  // is the live ticketing URL the user should land on. Anchor on the latter.
  const sourceUrl = fallbackUrl;
  const externalId = extractExternalId(sourceUrl);

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl,
    },
    title,
    description: pickString(node, "description"),
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      neighborhood: NEIGHBORHOOD,
      address: VENUE_ADDRESS,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: CATEGORY,
    pricing: extractPricing(node),
    recurrence: null,
    verificationLevel: "community",
    rawPayload: node,
    fetchedAt,
  };
}

/**
 * Eventbrite event URLs end in `-tickets-<NUMERIC_ID>`. That id is stable
 * across listing/detail variants; if the URL doesn't match, fall back to the
 * full URL string as the external id so dedup still works on re-runs.
 */
function extractExternalId(url: string): string {
  const m = /-tickets-(\d+)(?:[/?#]|$)/.exec(url);
  if (m && m[1]) return `eb:${m[1]}`;
  return `url:${url}`;
}

/**
 * Pull structured pricing from the Event JSON-LD `offers` array. Eventbrite
 * conventions:
 *   - Free events: AggregateOffer with lowPrice="0.0" highPrice="0.0".
 *   - Paid events: AggregateOffer with lowPrice/highPrice as USD strings.
 *   - Mixed/RSVP-only: may have a plain Offer with `price`.
 * Falls back to `priceMin: 0, isFree: false` when offers are absent — D2
 * still passes (priceMin is not-null).
 */
export function extractPricing(node: Record<string, unknown>): PriceInfo {
  const offers = node.offers;
  if (!offers) {
    return { priceMin: 0, priceMax: null, isFree: false };
  }
  const offerList: Record<string, unknown>[] = Array.isArray(offers)
    ? (offers.filter(
        (o) => o && typeof o === "object",
      ) as Record<string, unknown>[])
    : [offers as Record<string, unknown>];

  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  for (const offer of offerList) {
    const low = toNumber(offer.lowPrice);
    const high = toNumber(offer.highPrice);
    const flat = toNumber(offer.price);
    const candidates = [low, high, flat].filter(
      (n): n is number => n !== null,
    );
    for (const c of candidates) {
      if (minPrice === null || c < minPrice) minPrice = c;
      if (maxPrice === null || c > maxPrice) maxPrice = c;
    }
  }

  if (minPrice === null && maxPrice === null) {
    return { priceMin: 0, priceMax: null, isFree: false };
  }
  if (minPrice === 0 && (maxPrice === 0 || maxPrice === null)) {
    return { priceMin: null, priceMax: null, isFree: true };
  }
  return {
    priceMin: minPrice,
    priceMax: maxPrice,
    isFree: false,
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "community",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    let entries: ListingEntry[] = [];
    try {
      const { html } = await fetchHtml(LISTING_URL);
      entries = parseListingEntries(html);
      if (entries.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message:
            `no Spark Social SF events matched on ${LISTING_URL} — venue may have no upcoming Eventbrite listings, or the JSON-LD format changed`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    // B3: cap detail fetches.
    const capped = entries.slice(0, MAX_DETAIL_FETCHES);
    const seenExternalIds = new Set<string>();

    for (const entry of capped) {
      try {
        const { $ } = await fetchHtml(entry.url);
        const eventNodes = parseJsonLd($).filter(isEventNode);
        // Prefer the node whose name matches the listing entry name; fall
        // back to the first event node on the page.
        const node =
          eventNodes.find(
            (n) =>
              typeof n.name === "string" &&
              n.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
          ) ?? eventNodes[0];
        if (!node) {
          errors.push({
            source: ID,
            externalId: entry.url,
            stage: "parse",
            message: `no Event JSON-LD on detail page ${entry.url}`,
            retryable: false,
            occurredAt: new Date(),
          });
          continue;
        }
        const raw = detailNodeToRawEvent(node, entry.url, fetchedAt);
        if (!raw) continue;
        // D6: filter past-dated events (defensive — Eventbrite listings are
        // forward-looking but date-tied events can flip past mid-run).
        if (raw.startTimeUtc.getTime() < fetchedAt.getTime()) continue;
        if (seenExternalIds.has(raw.identity.externalId)) continue;
        seenExternalIds.add(raw.identity.externalId);
        events.push(raw);
      } catch (err) {
        errors.push({
          source: ID,
          externalId: entry.url,
          stage: "fetch",
          message: err instanceof Error ? err.message : String(err),
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
