import { fingerprint } from "@/lib/identity";
import {
  fetchHtml,
  filterEventNodes,
  parseJsonLd,
} from "@/lib/scrape";
import type {
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * Punch Line SF (Financial District) — Tier-3 scraper.
 *
 * Strategy: the /shows listing page emits one schema.org MusicEvent
 * JSON-LD block per upcoming show (server-rendered by the Live Nation
 * widget), so we never need to drive a headless browser. JSON-LD is
 * preferred over CSS per M3 rubric B1.
 *
 * Pricing: the JSON-LD blocks do not carry `offers`, and the rubric D2
 * forbids rows where priceMin / priceMax / isFree are all unset. Punch
 * Line advertises a published $25 minimum cover (plus a two-drink
 * minimum), so we set priceMin=25 as a known per-venue floor and leave
 * priceMax null. Per-event detail fetches would violate B3 (one listing
 * fetch, ≤20 detail fetches), and the Ticketmaster checkout flow does
 * not expose price in JSON-LD anyway.
 */

const ID = "scrape:punchline";
const LISTING_URL = "https://www.punchlinecomedyclub.com/shows";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Punch Line SF";
const NEIGHBORHOOD = "Financial District";
const ADDRESS = "444 Battery Street, San Francisco, CA 94111";
const LAT = 37.79550849;
const LNG = -122.40013361;
const MIN_PRICE_FLOOR_USD = 25;

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
      const eventNodes = filterEventNodes(parseJsonLd($));

      for (const node of eventNodes) {
        try {
          const raw = jsonLdToRawEvent(node, fetchedAt);
          if (raw) events.push(raw);
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
        priceMin: MIN_PRICE_FLOOR_USD,
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

/**
 * Translate one schema.org Event JSON-LD node into a RawEvent.
 * Pure helper, exported for unit-testing without driving fetch().
 */
export function jsonLdToRawEvent(
  node: Record<string, unknown>,
  fetchedAt: Date,
): RawEvent | null {
  const title = pickString(node, "name");
  const startStr = pickString(node, "startDate");
  const url = pickString(node, "url");
  if (!title || !startStr || !url) return null;

  const startTimeUtc = new Date(startStr);
  if (Number.isNaN(startTimeUtc.getTime())) return null;

  const endStr = pickString(node, "endDate");
  const endTimeUtc =
    endStr && !Number.isNaN(new Date(endStr).getTime())
      ? new Date(endStr)
      : null;

  const externalId = extractExternalId(url, title, startStr);

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: url,
    },
    title,
    description: pickString(node, "description"),
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      neighborhood: NEIGHBORHOOD,
      address: ADDRESS,
      lat: LAT,
      lng: LNG,
      timezone: TZ,
    },
    primaryCategory: "comedy",
    pricing: {
      priceMin: MIN_PRICE_FLOOR_USD,
      priceMax: null,
      isFree: false,
    },
    recurrence: null,
    verificationLevel: "official",
    rawPayload: node,
    fetchedAt,
  };
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
 * Ticketmaster URLs end in `/event/<HEX_ID>`. That id is the stable
 * source-of-truth external identifier (Punch Line's listing page is just
 * a relay). If the URL pattern doesn't match, fall back to a
 * deterministic title+date composite.
 */
function extractExternalId(
  url: string,
  title: string,
  startStr: string,
): string {
  const m = url.match(/\/event\/([A-Za-z0-9]+)/);
  if (m && m[1]) return `tm:${m[1]}`;
  return `${title}|${startStr}`.toLowerCase().replace(/\s+/g, "-");
}

export default adapter;
