import * as cheerio from "cheerio";
import { fingerprint } from "@/lib/identity";
import { fetchHtml, filterEventNodes, parseJsonLd } from "@/lib/scrape";
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
 * Verdi Club — historic Italian-American social hall in the Mission.
 * Hosts weekly dance socials (swing, lindy hop, salsa, tango, line-dancing)
 * plus cabaret and rotating cultural events.
 *
 * Strategy: the events listing page is rendered by The Events Calendar
 * (Tribe) plugin, which emits a single `<script type="application/ld+json">`
 * block containing schema.org `Event` nodes for ~30 upcoming events on the
 * first page. This is exactly the semantic surface B1 asks for — one
 * listing-page fetch, no JS execution, no detail-page hammering.
 *
 * Pricing: most weekly socials are door-pay and have no `offers` block in
 * JSON-LD; ticketed cabaret/concert nights do. When `offers.price` is
 * present (e.g., "23 – 35"), parse the en-dashed range into priceMin/Max.
 * Otherwise fall back to `priceMin: 0, isFree: false` so the row satisfies
 * the D2 structured-pricing invariant; the persister/UI surfaces "Free" as
 * the safest default for an unticketed weekly social.
 */

const ID = "scrape:verdiclub";
const LISTING_URL = "https://www.verdiclub.net/events/";
const VENUE_NAME = "Verdi Club";
const VENUE_ADDRESS = "2424 Mariposa St";
const NEIGHBORHOOD = "Mission";
const TZ = "America/Los_Angeles";
const VERIFICATION = "official" as const;
const DEFAULT_CATEGORY: Category = "dancing";

// Cap detail-page fetches per B3. We do not fetch detail pages today; reserve
// the budget so future maintainers know the contract.
// const MAX_DETAIL_FETCHES = 20;

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: VERIFICATION,

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    try {
      const { $ } = await fetchHtml(LISTING_URL);
      const nodes = filterEventNodes(parseJsonLd($));

      if (nodes.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message:
            "no JSON-LD Event nodes found at " +
            LISTING_URL +
            " — listing markup may have changed",
          retryable: true,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      // D6: filter out past-dated events. The Verdi listing page includes
      // some past events; we keep a 24h grace window for shows currently in
      // progress (start_time < now() - 1 day → drop).
      const cutoff = new Date(fetchedAt.getTime() - 24 * 60 * 60 * 1000);

      for (const node of nodes) {
        try {
          const raw = toRawEvent(node, fetchedAt);
          if (!raw) continue;
          if (raw.startTimeUtc < cutoff) continue;
          events.push(raw);
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
      pricing: raw.pricing ?? {
        priceMin: 0,
        priceMax: null,
        isFree: false,
      },
      venue: raw.venue,
      recurrence: raw.recurrence ?? null,
      verificationLevel: raw.verificationLevel,
      rawPayload: raw.rawPayload,
      provenance,
    };
  },
};

// ---------------------------------------------------------------------------
// internal helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Build a RawEvent from a single schema.org Event JSON-LD node.
 * Returns null when the node is missing required fields (start date,
 * resolvable URL); the caller filters nulls out.
 */
export function toRawEvent(
  node: Record<string, unknown>,
  fetchedAt: Date,
): RawEvent | null {
  const startRaw = getStr(node["startDate"]);
  if (!startRaw) return null;

  const startTimeUtc = parseIsoDate(startRaw);
  if (!startTimeUtc) return null;

  const endRaw = getStr(node["endDate"]);
  const endTimeUtc = endRaw ? parseIsoDate(endRaw) : null;

  const title = decodeHtmlEntities(getStr(node["name"]) ?? "Untitled event");
  const description = (() => {
    const d = getStr(node["description"]);
    if (!d) return null;
    return decodeHtmlEntities(stripHtml(d)).slice(0, 4000);
  })();

  const sourceUrl = getStr(node["url"]);
  if (!sourceUrl) return null;

  const externalId = deriveExternalId(sourceUrl);

  const pricing = parsePricing(node["offers"]);

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl,
    },
    title,
    description,
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      address: VENUE_ADDRESS,
      neighborhood: NEIGHBORHOOD,
      lat: null,
      lng: null,
      timezone: TZ,
    },
    primaryCategory: DEFAULT_CATEGORY,
    pricing,
    recurrence: null,
    verificationLevel: VERIFICATION,
    rawPayload: {
      url: sourceUrl,
      startDate: startRaw,
      offers: node["offers"] ?? null,
    },
    fetchedAt,
  };
}

function getStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

/**
 * Parse an ISO 8601 datetime (with or without offset). Returns null on
 * unparseable input — never throws so a single malformed row doesn't take
 * down the batch.
 */
export function parseIsoDate(s: string): Date | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Pull a stable, source-scoped external id from the canonical event URL.
 * Verdi/Tribe URLs look like:
 *   https://www.verdiclub.net/events/<slug>/<YYYY-MM-DD>/
 * The slug + date combo is unique per occurrence (recurring events get a
 * fresh slug suffix from Tribe), so we use the trailing two path segments.
 */
export function deriveExternalId(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2) {
      return segs.slice(-2).join("/");
    }
    if (segs.length === 1) return segs[0];
    return url;
  } catch {
    return url;
  }
}

/**
 * Convert a schema.org Offer (or array of offers) into structured PriceInfo.
 *
 *   "23 – 35"      → { priceMin: 23,   priceMax: 35,   isFree: false }
 *   "55.20 – 81.88"→ { priceMin: 55.2, priceMax: 81.88,isFree: false }
 *   "free" / "0"   → { priceMin: 0,    priceMax: 0,    isFree: true  }
 *   no offers      → null (caller defaults in normalize())
 *
 * Splits on either an en-dash, em-dash, or hyphen surrounded by whitespace.
 */
export function parsePricing(offers: unknown): PriceInfo | null {
  if (!offers) return null;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer || typeof offer !== "object") return null;
  const priceRaw = (offer as Record<string, unknown>)["price"];
  const priceStr = typeof priceRaw === "string" ? priceRaw.trim() : "";
  if (!priceStr) return null;

  if (/^(free|0(\.0+)?)$/i.test(priceStr)) {
    return { priceMin: 0, priceMax: 0, isFree: true };
  }

  // Split on dash variants surrounded by optional whitespace.
  const parts = priceStr
    .split(/\s*[-–—]\s*/)
    .map((p) => p.replace(/[^0-9.]/g, ""))
    .filter((p) => p.length > 0);

  const nums = parts
    .map((p) => Number.parseFloat(p))
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return null;
  if (nums.length === 1) {
    const v = nums[0];
    if (v === 0) return { priceMin: 0, priceMax: 0, isFree: true };
    return { priceMin: v, priceMax: v, isFree: false };
  }
  const priceMin = Math.min(...nums);
  const priceMax = Math.max(...nums);
  return { priceMin, priceMax, isFree: false };
}

/**
 * Decode HTML entities in a plain string. JSON-LD payloads from Tribe are
 * pre-escaped (`&#8217;`, `&amp;`, etc.); use cheerio's decoder so we don't
 * ship the entity codes downstream into fingerprints or UI.
 */
export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  // Use cheerio to decode entities via the underlying parser.
  return cheerio.load(`<x>${s}</x>`, null, false)("x").text();
}

/**
 * Strip HTML tags from a description string. JSON-LD description sometimes
 * contains escaped HTML; we want a plain text preview.
 */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default adapter;
