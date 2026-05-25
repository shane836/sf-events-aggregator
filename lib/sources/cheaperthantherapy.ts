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
 * Cheaper Than Therapy (Union Square / Tenderloin, SF) — Tier-3 scraper.
 *
 * Discovery notes:
 *   - The "official" domain `cheaperthantherapysf.com` no longer resolves
 *     (NXDOMAIN). The venue rebranded to `cttcomedy.com` (verified via search
 *     and the homepage's own JSON-LD `url`).
 *   - `cttcomedy.com/` is server-rendered with a ComedyClub JSON-LD block but
 *     NO Event nodes — all show data lives on the JS-only ticketing SPA at
 *     `tickets.cttcomedy.com`. Per M3 rubric B4 we would normally escalate to
 *     Playwright, but the SPA is backed by a public JSON API.
 *   - The SPA calls `https://api.ninkashi.com/public_access/events/find_by_url_site`
 *     (Ninkashi is CTT's ticketing platform). Filtering by url_site=tickets.cttcomedy.com
 *     returns ONLY CTT shows (105+ entries, all Shelton Theater).
 *
 * Method: structured JSON API (preferred over HTML scraping per B1 — JSON is
 * "semantic data" stronger than JSON-LD). One network call per ingest. No
 * pagination needed — the endpoint returns the venue's full upcoming roster.
 *
 * Robots.txt (cttcomedy.com): Allow all except /selects/. The ticketing
 * subdomain is the API call target; the SPA URL we link out to is a
 * user-facing page. No robots violation.
 *
 * Anti-bot: none observed (200 OK, JSON, plain UA).
 */

const ID = "scrape:cheaperthantherapy";
const API_URL =
  "https://api.ninkashi.com/public_access/events/find_by_url_site?url_site=tickets.cttcomedy.com";
const TICKET_BASE = "https://tickets.cttcomedy.com/events/";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Cheaper Than Therapy";
const NEIGHBORHOOD = "Tenderloin";
const VENUE_ADDRESS = "533 Sutter St, San Francisco, CA 94102";
const VENUE_LAT = 37.7889145;
const VENUE_LNG = -122.4113228;
const USER_AGENT =
  "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)";

const CATEGORY: Category = "comedy";

type NinkashiTicket = {
  price?: number | null;
  ticket_type?: string | null;
  formatted_price?: string | null;
};

type NinkashiDate = {
  starts_at?: string | null;
  ends_at?: string | null;
};

type NinkashiEvent = {
  id?: number | string;
  title?: string | null;
  description?: string | null;
  venue_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  time_zone?: string | null;
  formatted_cheapest_price?: string | null;
  event_available?: boolean | null;
  event_sales_enabled?: boolean | null;
  event_dates_attributes?: NinkashiDate[] | null;
  tickets_attributes?: NinkashiTicket[] | null;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function buildSourceUrl(id: number | string, title: string | null): string {
  // tickets.cttcomedy.com routes are /events/:id/:slug. The id alone works
  // (server 301-redirects to the slug form), but we build the slug ourselves
  // so the click-out lands on the canonical URL with no redirect hop.
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0
    ? `${TICKET_BASE}${id}/${slug}/`
    : `${TICKET_BASE}${id}/`;
}

/**
 * Compute pricing from the tickets_attributes array.
 *
 * Ninkashi prices are integer cents. We collect the cheapest and most
 * expensive PAID ticket types and flag the event as free only if every
 * non-comp ticket is zero-priced.
 */
function derivePricing(tickets: NinkashiTicket[] | null | undefined): PriceInfo {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    // Fall back to CTT's published $25 floor (per their JSON-LD priceRange).
    return { priceMin: 25, priceMax: null, isFree: false };
  }
  const paidPrices: number[] = [];
  for (const t of tickets) {
    if (typeof t?.price !== "number") continue;
    const type = typeof t.ticket_type === "string" ? t.ticket_type : "";
    if (type === "comp" || type === "complimentary") continue;
    paidPrices.push(t.price);
  }
  if (paidPrices.length === 0) {
    return { priceMin: 25, priceMax: null, isFree: false };
  }
  const allFree = paidPrices.every((p) => p === 0);
  if (allFree) {
    return { priceMin: null, priceMax: null, isFree: true };
  }
  const min = Math.min(...paidPrices) / 100;
  const max = Math.max(...paidPrices) / 100;
  return {
    priceMin: min,
    priceMax: max > min ? max : null,
    isFree: false,
  };
}

/**
 * Parse one Ninkashi event into a RawEvent. Returns null for events that
 * are missing required identity fields (id, title, start time) or that have
 * already ended.
 *
 * Pure / synchronous — exported for unit testing against the JSON fixture.
 */
export function parseNinkashiEvent(
  ev: NinkashiEvent,
  fetchedAt: Date,
  now: Date = fetchedAt,
): RawEvent | null {
  if (ev == null || typeof ev !== "object") return null;

  const id = ev.id;
  if (id == null || (typeof id !== "number" && !isNonEmptyString(id))) {
    return null;
  }
  const title = isNonEmptyString(ev.title) ? ev.title.trim() : null;
  if (!title) return null;

  const dates = Array.isArray(ev.event_dates_attributes)
    ? ev.event_dates_attributes
    : [];
  const first = dates[0];
  if (!first || !isNonEmptyString(first.starts_at)) return null;

  const startTimeUtc = new Date(first.starts_at);
  if (Number.isNaN(startTimeUtc.getTime())) return null;

  // Skip past shows. Per M3 D6, no past-dated events.
  if (startTimeUtc.getTime() < now.getTime()) return null;

  const endTimeUtc = isNonEmptyString(first.ends_at)
    ? new Date(first.ends_at)
    : null;
  const endValid =
    endTimeUtc && !Number.isNaN(endTimeUtc.getTime()) ? endTimeUtc : null;

  // Tenderloin (per task spec) takes precedence over any geocoder result.
  // CTT is on the Union Square / Tenderloin border; the project's canonical
  // neighborhood for this venue is Tenderloin.
  const sourceUrl = buildSourceUrl(id, title);

  const pricing = derivePricing(ev.tickets_attributes);

  const address =
    isNonEmptyString(ev.address_1) && isNonEmptyString(ev.city)
      ? `${ev.address_1}${ev.address_2 ? " " + ev.address_2 : ""}, ${ev.city}${
          ev.state ? ", " + ev.state : ""
        }${ev.zip_code ? " " + ev.zip_code : ""}`
      : VENUE_ADDRESS;

  return {
    identity: {
      source: ID,
      externalId: String(id),
      sourceUrl,
    },
    title,
    description: isNonEmptyString(ev.description)
      ? ev.description.slice(0, 4000)
      : null,
    startTimeUtc,
    endTimeUtc: endValid,
    timezone: TZ,
    venue: {
      // Stable venue name for cross-source dedup. The API reports
      // "Shelton Theater" (the building), but our canonical venue for the
      // CTT show series is "Cheaper Than Therapy".
      name: VENUE_NAME,
      neighborhood: NEIGHBORHOOD,
      address,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: CATEGORY,
    pricing,
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      id,
      title,
      starts_at: first.starts_at,
      formatted_cheapest_price: ev.formatted_cheapest_price ?? null,
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      let resp: Response;
      try {
        resp = await fetch(API_URL, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) {
        errors.push({
          source: ID,
          stage: "fetch",
          message: `HTTP ${resp.status} fetching ${API_URL}`,
          retryable: resp.status >= 500 || resp.status === 429,
          httpStatus: resp.status,
          rateLimited: resp.status === 429,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const payload = (await resp.json()) as unknown;
      if (!Array.isArray(payload)) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `expected JSON array from ${API_URL}, got ${typeof payload}`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const seen = new Set<string>();
      for (const node of payload) {
        try {
          const ev = parseNinkashiEvent(node as NinkashiEvent, fetchedAt);
          if (!ev) continue;
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
