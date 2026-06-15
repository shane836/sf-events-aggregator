import { fetchHtml, parseJsonLd, filterEventNodes } from "@/lib/scrape";
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
 * Eventbrite's public discovery API was retired, but its discovery pages are
 * crawlable (robots.txt allows /d/) and each one embeds a schema.org `ItemList`
 * of ~20 fully-populated `Event` nodes (name, date, address, geo, url). So we
 * fetch ONE discovery page per East Bay city and read the ItemList — no
 * per-event page fetches. That keeps the run to a handful of requests:
 * Eventbrite 405-throttles rapid repeated hits, so request volume matters.
 *
 * City is taken from each event's own JSON-LD address (`addressLocality`) — not
 * the discovery query — because listings bleed across the wider Bay Area.
 * Events outside our cities, or whose title/description doesn't map to our
 * 5-category taxonomy, are skipped: precision over volume.
 *
 * The discovery ItemList carries no price, so pricing is the canonical "price
 * varies" shape (null/null/false). Eventbrite is a ticketing platform with
 * structured first-party listings → verificationLevel "trusted_partner".
 */

const ID = "scrape:eventbrite";
const TZ = "America/Los_Angeles";
const BASE = "https://www.eventbrite.com";

// One discovery listing per East Bay city. `all-events` is the unfiltered city
// feed; we classify/skip per event afterward.
// Discovery listings bleed across the wider Bay Area, so a handful of spread-out
// East Bay anchors (inner ring + West County + Central County) is enough to
// surface events from every East Bay city; each event is re-tagged with its own
// city. Kept small because Eventbrite 405-throttles request bursts.
const DISCOVERY_PATHS: Record<string, string> = {
  Oakland: "/d/ca--oakland/all-events/",
  Berkeley: "/d/ca--berkeley/all-events/",
  Emeryville: "/d/ca--emeryville/all-events/",
  Alameda: "/d/ca--alameda/all-events/",
  Richmond: "/d/ca--richmond/all-events/",
  "Walnut Creek": "/d/ca--walnut-creek/all-events/",
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
 * Pull `Event` nodes out of parsed JSON-LD. Eventbrite discovery pages nest
 * events inside an `ItemList` as `itemListElement[].item`; we also accept
 * top-level Event nodes as a fallback (event detail pages / format changes).
 */
export function extractEventNodes(
  nodes: unknown[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const node = n as Record<string, unknown>;
    if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
      for (const el of node.itemListElement) {
        const item = el && typeof el === "object"
          ? getNested(el as Record<string, unknown>, "item")
          : null;
        if (item && /Event/i.test(String(item["@type"]))) out.push(item);
      }
    }
  }
  // Top-level Event nodes (de-duped against ItemList items by reference is
  // unnecessary — Eventbrite uses one or the other per page).
  out.push(...filterEventNodes(nodes));
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

  if (/comedy|stand-?up|improv|\bcomic\b|sketch show|laugh/.test(text)) {
    return "comedy";
  }
  if (
    /\bdance\b|dancing|salsa|bachata|cumbia|reggaeton|merengue|kizomba|ballroom|swing night|\brave\b|club night|night ?club|\bdj\b|house music|\btechno\b|\bedm\b|bollywood|afrobeat|\bdisco\b|line danc|two-?step|burlesque/.test(
      text,
    )
  ) {
    return "dancing";
  }
  if (
    /\bfood\b|food truck|tasting|brunch|\bdinner\b|supper|\bbrewery\b|happy hour|\bwine\b|\bbeer\b|cocktail|mixolog|culinary|\beats\b|pop-?up|night market|farmers? market|\bvegan\b|\bbbq\b|barbecue|restaurant|chef|bites|dim sum|tea ceremony/.test(
      text,
    )
  ) {
    return "food";
  }
  if (
    /concert|live music|live band|\bband\b|jazz|blues|\bfunk\b|soul\b|orchestra|symphony|philharmonic|acoustic|singer|songwriter|\bgig\b|album release|residency|hip-?hop|\brap\b|\br&b\b|reggae|\bindie\b|\bpunk\b|\bmetal\b|\brock\b|open mic|karaoke|tribute|music festival|showcase/.test(
      text,
    )
  ) {
    return "music";
  }
  if (
    /lecture|\btalk\b|artist talk|fireside|keynote|book reading|\bauthor\b|panel|discussion|seminar|workshop|\bclass\b|masterclass|symposium|poetry|spoken word|storytelling|\breading\b|teach-?in|q&a|conversation with/.test(
      text,
    )
  ) {
    return "lectures";
  }
  return null;
}

/**
 * Derive PriceInfo from a schema.org `offers` value (object or array). Eventbrite
 * uses `price` / `lowPrice` / `highPrice`. All-zero → free; absent → the
 * canonical "price varies" shape (null/null/false). The discovery ItemList
 * carries no offers, so most events resolve to "price varies".
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
 * Parse one schema.org Event JSON-LD node into a RawEvent. Returns null when
 * required identity fields are missing, the venue is outside our cities, or the
 * category doesn't map.
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

  const geo = location ? getNested(location, "geo") : null;
  const lat = geo ? numberFrom(geo.latitude) : null;
  const lng = geo ? numberFrom(geo.longitude) : null;

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
      lat,
      lng,
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
    const seenIds = new Set<string>();

    const paths = Object.values(DISCOVERY_PATHS);
    for (let i = 0; i < paths.length; i++) {
      // Space requests out — Eventbrite 405-throttles bursts.
      if (i > 0) await sleep(1500);
      const url = `${BASE}${paths[i]}`;
      try {
        const { $ } = await fetchHtml(url);
        const nodes = extractEventNodes(parseJsonLd($));
        for (const node of nodes) {
          try {
            const ev = parseEventbriteNode(node, fetchedAt);
            if (!ev) continue;
            if (seenIds.has(ev.identity.externalId)) continue;
            seenIds.add(ev.identity.externalId);
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
          message: `discovery ${url}: ${err instanceof Error ? err.message : String(err)}`,
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
