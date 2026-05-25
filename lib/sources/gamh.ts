import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  PriceInfo,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * Great American Music Hall scraper.
 *
 * Site is WordPress + the SeeTickets venue plugin (same stack as The
 * Independent and other Slim's Presents venues). Calendar page is
 * server-rendered — no JS required, no JSON-LD present, so we read the
 * SeeTickets list-view markup directly. JSON-LD would have been preferred
 * (B1), but the page has none; cheerio CSS over a stable plugin template is
 * the next-best option.
 *
 * Robots.txt allows /calendar/ (only /calendar/action* is disallowed).
 * One listing-page fetch per ingest; no detail-page hops.
 */

const ID = "scrape:gamh";
const LISTING_URL = "https://gamh.com/calendar/";
const VENUE_NAME = "Great American Music Hall";
const NEIGHBORHOOD = "Tenderloin";
const ADDRESS = "859 O'Farrell St, San Francisco, CA 94109";
const TZ = "America/Los_Angeles";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

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
      const cards = $(".seetickets-list-event-container");

      cards.each((_, el) => {
        try {
          const raw = parseCard($, el, fetchedAt);
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
      });
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

// --------------------------------------------------------------------------
// helpers (exported for unit-testing)
// --------------------------------------------------------------------------

export function parseCard(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  fetchedAt: Date,
  now: Date = new Date(),
): RawEvent | null {
  const $card = $(el);
  const titleAnchor = $card.find(".event-title a").first();
  const title = titleAnchor.text().trim();
  const sourceUrl = (titleAnchor.attr("href") ?? "").trim();
  if (!title || !sourceUrl) return null;

  const externalId = extractExternalId(sourceUrl);
  if (!externalId) return null;

  const dateText = $card.find(".event-date").first().text().trim();
  const showtimeText = $card.find(".see-showtime").first().text().trim();
  if (!dateText || !showtimeText) return null;

  const startTimeUtc = parseEventDateTime(dateText, showtimeText, TZ, now);
  if (!startTimeUtc) return null;

  const priceText = $card.find(".price").first().text().trim();
  const pricing = parsePrice(priceText);

  const supportingTalent = $card.find(".supporting-talent").first().text().trim();
  const eventHeader = $card.find(".event-header").first().text().trim();
  const genre = $card.find(".genre").first().text().trim();
  const description = [eventHeader, supportingTalent, genre]
    .filter((s) => s.length > 0)
    .join(" — ") || null;

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl,
    },
    title,
    description,
    startTimeUtc,
    endTimeUtc: null,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      neighborhood: NEIGHBORHOOD,
      address: ADDRESS,
      lat: 37.7848,
      lng: -122.4187,
      timezone: TZ,
    },
    primaryCategory: "music",
    pricing,
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      title,
      dateText,
      showtimeText,
      priceText,
      sourceUrl,
    },
    fetchedAt,
  };
}

/**
 * Extract the trailing numeric event ID from a SeeTickets URL.
 * Example: https://wl.seetickets.us/event/sleepytime-gorilla-museum/683102?afflky=...
 *          → "683102"
 */
export function extractExternalId(url: string): string | null {
  const m = url.match(/\/event\/[^/]+\/(\d+)(?:[?#/]|$)/);
  return m ? m[1] : null;
}

/**
 * Parse a SeeTickets price field like "$25.00-$30.00" or "$45.00" or "Free".
 * Returns structured PriceInfo (D13 requires structured pricing on every row).
 */
export function parsePrice(text: string): PriceInfo {
  const t = (text ?? "").trim();
  if (!t) return { priceMin: null, priceMax: null, isFree: false };
  if (/free/i.test(t)) return { priceMin: null, priceMax: null, isFree: true };

  const nums = Array.from(t.matchAll(/\$?(\d+(?:\.\d+)?)/g)).map((m) =>
    Number(m[1]),
  );
  if (nums.length === 0) {
    return { priceMin: null, priceMax: null, isFree: false };
  }
  if (nums.length === 1) {
    return { priceMin: nums[0], priceMax: nums[0], isFree: false };
  }
  return {
    priceMin: Math.min(...nums),
    priceMax: Math.max(...nums),
    isFree: false,
  };
}

/**
 * Parse the SeeTickets date format ("Wed May 27") plus a showtime
 * ("8:00PM") into a UTC Date, interpreting both in America/Los_Angeles.
 *
 * The site never includes the year on the calendar card. We infer it: pick
 * the current year, then bump to next year if that would put the event in
 * the past relative to `now` (handles December → January rollover).
 */
export function parseEventDateTime(
  dateText: string,
  showtimeText: string,
  timezone: string,
  now: Date,
): Date | null {
  // "Wed May 27" → month=4, day=27
  const m = dateText.match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (!m) return null;
  const monthIdx = MONTHS[m[1].toLowerCase()];
  if (monthIdx === undefined) return null;
  const day = Number(m[2]);

  // "8:00PM" → 20:00
  const tm = showtimeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!tm) return null;
  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const meridiem = tm[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  // Infer year from "now" in the target timezone. If the resulting date is
  // more than ~24h in the past, advance to next year.
  const nowYear = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
    }).format(now),
  );

  for (const yearOffset of [0, 1]) {
    const year = nowYear + yearOffset;
    const utc = localToUtc(year, monthIdx, day, hour, minute, timezone);
    if (!utc) continue;
    // Allow up to 24h past for events happening "today".
    if (utc.getTime() >= now.getTime() - 24 * 60 * 60 * 1000) {
      return utc;
    }
  }
  return null;
}

/**
 * Convert a wall-clock time in a given IANA timezone to a UTC Date.
 * Works by inverting Intl.DateTimeFormat — no external deps.
 */
export function localToUtc(
  year: number,
  monthIdx: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date | null {
  // First approximation: treat the wall-clock as UTC.
  const guess = Date.UTC(year, monthIdx, day, hour, minute, 0);
  // Compute the timezone's offset at that instant by formatting it back.
  const offsetMs = getTimezoneOffsetMs(new Date(guess), timezone);
  // The local wall-clock minus the offset is the true UTC instant.
  const corrected = guess - offsetMs;
  // Second pass: the offset at the corrected instant may differ across a DST
  // transition; recompute to lock in.
  const offsetMs2 = getTimezoneOffsetMs(new Date(corrected), timezone);
  return new Date(guess - offsetMs2);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
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
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}
