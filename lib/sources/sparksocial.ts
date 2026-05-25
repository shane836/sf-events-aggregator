import { fetchHtml } from "@/lib/scrape";
import { fingerprint, formatLocalDate } from "@/lib/identity";
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
 * Spark Social is a weekly open-air food-truck park, bar, and event space.
 * Unlike a venue with ticketed shows, each operating day IS the event:
 * rotating food trucks, bar, mini golf, beer garden. The site's events page
 * (https://www.sparksocialsf.com/events redirects to
 * visitsparksocial.com/events/calendar/) embeds an Elfsight calendar widget
 * that is rendered entirely client-side from a Google Calendar — the static
 * HTML is empty of event data (B4 — but we handle this without Playwright by
 * the schedule-expansion approach below).
 *
 * APPROACH (schedule expansion):
 *   1. fetchHtml() the events page solely to (a) confirm the site is reachable
 *      and not behind a Cloudflare interstitial (B6), and (b) anchor our
 *      sourceUrl on the official redirected URL.
 *   2. Synthesize one RawEvent per calendar day for the next 60 days using the
 *      publicly posted operating hours (Mon-Sat 11am-9pm, Sun 11am-5pm). Free
 *      to attend (no cover); food/drink purchases are individually priced.
 *
 * Operating hours are taken from visitsparksocial.com/san-francisco/ (the
 * "OPERATING HOURS" table on the SF location page). If the hours change in
 * the future, update HOURS_BY_WEEKDAY below.
 *
 * Robots.txt: `Disallow: /edit/` and `Disallow: /fhbr-console/` — neither
 * affects /events/calendar/ or the static fixture URL. B2 passes.
 */

const ID = "scrape:sparksocial";
// The configured site redirects from sparksocialsf.com → visitsparksocial.com;
// we fetch the canonical, post-redirect URL directly to avoid a hop.
const LISTING_URL = "https://visitsparksocial.com/events/calendar/";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Spark Social SF";
const NEIGHBORHOOD = "Mission Bay";
const VENUE_ADDRESS = "601 Mission Bay Boulevard North, San Francisco, CA 94158";
const VENUE_LAT = 37.7707793;
const VENUE_LNG = -122.3914307;
const CATEGORY: Category = "food";
const HORIZON_DAYS = 60;

/**
 * Operating hours by weekday (0 = Sunday, 6 = Saturday), expressed as
 * 24h [openHour, closeHour] in America/Los_Angeles local time. Source:
 * https://visitsparksocial.com/san-francisco/ "OPERATING HOURS" table.
 *
 *   Mon-Sat: 11:00am – 9:00pm
 *   Sun:     11:00am – 5:00pm
 */
const HOURS_BY_WEEKDAY: Record<number, { openHour: number; closeHour: number }> =
  {
    0: { openHour: 11, closeHour: 17 }, // Sun
    1: { openHour: 11, closeHour: 21 }, // Mon
    2: { openHour: 11, closeHour: 21 }, // Tue
    3: { openHour: 11, closeHour: 21 }, // Wed
    4: { openHour: 11, closeHour: 21 }, // Thu
    5: { openHour: 11, closeHour: 21 }, // Fri
    6: { openHour: 11, closeHour: 21 }, // Sat
  };

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DESCRIPTION =
  "Spark Social SF is an open-air community space in Mission Bay with rotating food trucks, a beer garden, mini golf, and event space. Free to attend; food and drink priced individually.";

/**
 * Compute the UTC instant corresponding to a given local-time (TZ) date at
 * the given local hour. Pure: no dependence on the runtime timezone of the
 * Node process. Strategy: take a naive UTC guess (date + hour interpreted as
 * UTC), ask Intl what local time that instant represents, and shift by the
 * delta. Two iterations converge across any DST boundary because the second
 * pass always lands in the same offset window as the target.
 */
export function localDateAtHour(
  localDate: string,
  hour: number,
  timezone: string,
): Date {
  const targetEpochAsIfUtc = Date.UTC(
    Number(localDate.slice(0, 4)),
    Number(localDate.slice(5, 7)) - 1,
    Number(localDate.slice(8, 10)),
    hour,
    0,
    0,
  );
  let guess = new Date(targetEpochAsIfUtc);
  for (let i = 0; i < 2; i++) {
    const offsetMs = timezoneOffsetMs(guess, timezone);
    guess = new Date(targetEpochAsIfUtc - offsetMs);
  }
  return guess;
}

/**
 * Offset (ms) between the given instant's clock reading in `timezone` and
 * UTC. PDT returns -7*60*60*1000 (the local clock is 7 hours behind UTC).
 * Implementation: ask Intl for the local clock parts of `date` in `timezone`,
 * reassemble them as if they were UTC, and subtract the real epoch.
 */
function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  const localAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  );
  return localAsUtc - date.getTime();
}

/**
 * Build one RawEvent for a given local date string ("YYYY-MM-DD"). Returns
 * null if that weekday has no posted hours (currently always non-null —
 * Spark is open 7 days/week — but keeps the door open for closures).
 */
export function buildDailyEvent(
  localDate: string,
  fetchedAt: Date,
): RawEvent | null {
  // Determine weekday in LOCAL (Pacific) time, not the Node process's TZ.
  const noon = localDateAtHour(localDate, 12, TZ);
  const weekday = weekdayInTimezone(noon, TZ);
  const hours = HOURS_BY_WEEKDAY[weekday];
  if (!hours) return null;

  const startTimeUtc = localDateAtHour(localDate, hours.openHour, TZ);
  const endTimeUtc = localDateAtHour(localDate, hours.closeHour, TZ);

  const title = `Spark Social SF — Food Trucks, Bar & Mini Golf (${WEEKDAY_NAMES[weekday]})`;
  const externalId = `sparksocial-${localDate}`;
  // Anchor the click-through on the canonical events page; per-day permalinks
  // are not exposed by the client-side calendar widget.
  const sourceUrl = LISTING_URL;

  const pricing: PriceInfo = { priceMin: null, priceMax: null, isFree: true };

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl,
    },
    title,
    description: DESCRIPTION,
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
    pricing,
    recurrence: {
      seriesId: "sparksocial-daily",
      occurrenceId: externalId,
    },
    verificationLevel: "official",
    rawPayload: {
      localDate,
      weekday: WEEKDAY_NAMES[weekday],
      hours,
    },
    fetchedAt,
  };
}

/**
 * Returns 0..6 (Sun..Sat) for the given UTC date interpreted in `timezone`.
 * Uses Intl rather than Date.getDay() so the Node TZ doesn't matter.
 */
function weekdayInTimezone(date: Date, timezone: string): number {
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  // "Sun" -> 0, "Mon" -> 1, ..., "Sat" -> 6
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wk] ?? 0;
}

/**
 * Generate the next `horizonDays` local dates ("YYYY-MM-DD") starting at
 * `from`, evaluated in the configured timezone. Pure given `from`.
 */
export function nextLocalDates(from: Date, horizonDays: number): string[] {
  const out: string[] = [];
  const startLocal = formatLocalDate(from, TZ);
  // Walk by adding 24h to the noon-UTC anchor of startLocal, then re-derive
  // local date. This handles DST transitions correctly because we only ever
  // sample local-noon, which is never the spring-forward/fall-back boundary.
  let anchor = localDateAtHour(startLocal, 12, TZ);
  for (let i = 0; i < horizonDays; i++) {
    out.push(formatLocalDate(anchor, TZ));
    anchor = new Date(anchor.getTime() + 24 * 60 * 60_000);
  }
  return out;
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    // Single network call: verify the events page is reachable and not
    // anti-bot blocked (B6 / fetchHtml throws if it detects an interstitial).
    // We don't parse anything from the response — the calendar is a client-
    // side Elfsight widget — but a non-200 here is signal that the site is
    // down or the URL changed, and we surface that as a fetch error.
    try {
      await fetchHtml(LISTING_URL);
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
      // Continue: schedule expansion does not actually depend on the fetch
      // succeeding (operating hours are baked in). But we DO record the
      // error so the runner knows the upstream is degraded.
    }

    const dates = nextLocalDates(fetchedAt, HORIZON_DAYS);
    for (const localDate of dates) {
      try {
        const ev = buildDailyEvent(localDate, fetchedAt);
        if (ev) events.push(ev);
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
