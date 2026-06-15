import { fetchICalEvents, splitLocation } from "@/lib/ical";
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
 * Oakland Museum of California (OMCA) — Oakland, Tier-2 iCal adapter.
 *
 * OMCA publishes its public-program calendar via the WordPress "The Events
 * Calendar" plugin, which exposes a standard iCal export at
 * `/events/?ical=1`. robots.txt is fully permissive (`Disallow:` empty), so
 * the feed is fair game.
 *
 * The feed mixes event types (food-truck nights, gallery chats, performances,
 * talks). We map each to our 5-category taxonomy by keyword and SKIP anything
 * that doesn't map — better a precise subset than mis-tagged rows. The marquee
 * recurring entry is "Friday Nights at OMCA" with Off the Grid food trucks: a
 * free-admission block party, which we tag `food` + isFree.
 *
 * Pricing for non-food museum programming can't be read from iCal, so it uses
 * the canonical "price varies" shape (null/null/false) rather than guessing.
 *
 * First-party, venue-owned feed → verificationLevel "official".
 */

const ID = "ical:omca";
const FEED_URL = "https://museumca.org/events/?ical=1";
const EVENTS_URL = "https://museumca.org/events/";
const TZ = "America/Los_Angeles";
const CITY = "Oakland";

// OMCA sits at the south edge of Lake Merritt in downtown Oakland. The iCal
// feed carries no geo, so we pin the museum's coordinates as the venue default.
const VENUE_NAME = "Oakland Museum of California";
const VENUE_NEIGHBORHOOD = "Lake Merritt";
const VENUE_ADDRESS = "1000 Oak St, Oakland, CA 94607";
const VENUE_LAT = 37.7975;
const VENUE_LNG = -122.264;

const PRICE_VARIES: PriceInfo = {
  priceMin: null,
  priceMax: null,
  isFree: false,
};
const FREE: PriceInfo = { priceMin: null, priceMax: null, isFree: true };

/**
 * Map an OMCA event's text to our taxonomy. Returns null to SKIP events that
 * don't fit the 5 categories (e.g. members-only previews, fundraisers).
 *
 * Order matters: the food-truck night wins over any incidental "live music"
 * mention because the free block party is the thing people search for.
 */
export function classifyCategory(
  summary: string,
  description: string | null,
): Category | null {
  const text = `${summary} ${description ?? ""}`.toLowerCase();

  if (/friday nights|off the grid|food truck|tasting|culinary/.test(text)) {
    return "food";
  }
  if (/comedy|stand-?up|improv/.test(text)) return "comedy";
  if (/\bdance|dancing|ballet|salsa|cumbia|bachata/.test(text)) {
    return "dancing";
  }
  if (/concert|live music|\bdj\b|\bband\b|jazz|musician|performance/.test(text)) {
    return "music";
  }
  if (
    /lecture|talk|gallery chat|symposium|panel|reading|author|conversation|spotlight|workshop|tour/.test(
      text,
    )
  ) {
    return "lectures";
  }
  return null;
}

/** Food block parties are free to enter; everything else is "price varies". */
function pricingFor(category: Category): PriceInfo {
  return category === "food" ? FREE : PRICE_VARIES;
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "ical",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    try {
      const vevents = await fetchICalEvents(FEED_URL, { horizonDays: 365 });
      for (const ev of vevents) {
        if (!ev.start) continue;

        const uid = typeof ev.uid === "string" ? ev.uid : String(ev.uid);
        const title =
          typeof ev.summary === "string"
            ? ev.summary
            : (ev.summary?.val ?? "Untitled event");
        const description =
          typeof ev.description === "string"
            ? ev.description.slice(0, 4000)
            : null;

        const category = classifyCategory(title, description);
        if (!category) continue; // outside our taxonomy — skip

        const sourceUrl =
          typeof ev.url === "string" && ev.url.length > 0 ? ev.url : EVENTS_URL;
        const { address } = splitLocation(
          typeof ev.location === "string" ? ev.location : undefined,
        );

        events.push({
          identity: {
            source: ID,
            externalId: uid,
            sourceUrl,
          },
          title,
          description,
          startTimeUtc: ev.start,
          endTimeUtc: ev.end ?? null,
          timezone: TZ,
          venue: {
            name: VENUE_NAME,
            city: CITY,
            neighborhood: VENUE_NEIGHBORHOOD,
            address: address ?? VENUE_ADDRESS,
            lat: VENUE_LAT,
            lng: VENUE_LNG,
            timezone: TZ,
          },
          primaryCategory: category,
          pricing: pricingFor(category),
          recurrence: null,
          verificationLevel: "official",
          rawPayload: { uid, summary: title },
          fetchedAt,
        });
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
