import * as cheerio from "cheerio";
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
 * Bimbo's 365 Club (North Beach, SF) — Tier-3 scraper.
 *
 * Method: CSS parse of the `.tw-section` blocks rendered server-side on
 * https://bimbos365club.com/shows/ by the TicketWeb "event-discovery"
 * WordPress plugin. Page contains ~17 upcoming shows at any given time;
 * each section has month/day/day-of-week, show time, prefix, headline,
 * detail-page URL, and TicketWeb buy URL.
 *
 * JSON-LD fallback was attempted first (see fixtures/raw/bimbos.html line
 * 24): the page emits a Yoast WebPage / WebSite / Organization graph but
 * NO schema.org Event nodes, so JSON-LD does not work here. CSS is the
 * only structured option.
 *
 * Year inference: the listing only renders month + day. The list is
 * always in chronological order starting "now-ish"; when the month
 * sequence decreases (e.g. December → January), the year rolls over.
 * `resolveYear` below is pure and deterministic given the first event's
 * month and the current date.
 *
 * Pricing: TicketWeb buy-URLs are behind a bot block (HTTP 506) and
 * detail pages render no offer/price data. Bimbo's GA tickets start
 * around $25, so we use a conservative floor (per M3 D2 invariant:
 * scraped rows must have priceMin/priceMax set OR isFree=true).
 *
 * Robots.txt: `User-agent: * / Disallow:` (empty) + Crawl-delay: 10.
 * Single GET per ingest run satisfies the crawl-delay rule.
 */

const ID = "scrape:bimbos";
const LISTING_URL = "https://bimbos365club.com/shows/";
const TZ = "America/Los_Angeles";

const VENUE_NAME = "Bimbo's 365 Club";
const VENUE_NEIGHBORHOOD = "North Beach";
const VENUE_ADDRESS = "1025 Columbus Ave, San Francisco, CA 94133";
const VENUE_LAT = 37.804154;
const VENUE_LNG = -122.415291;

// Bimbo's GA floor. priceMax left null → renderer turns this into "$25+".
const PRICE_FLOOR_USD = 25;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export type ParsedSection = {
  monthIdx: number;
  day: number;
  hour24: number;
  minute: number;
  title: string;
  prefix: string | null;
  detailUrl: string;
  buyUrl: string | null;
};

/**
 * Convert a Pacific-local wall time to a UTC Date.
 * Pacific is UTC-8 (PST) or UTC-7 (PDT); we detect via Intl rather than
 * hardcoding DST boundaries.
 */
export function pacificWallTimeToUtc(
  year: number,
  monthIdx: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, monthIdx, day, hour, minute);
  const offset1 = pacificOffsetMinutes(new Date(naive));
  const guess = naive + offset1 * 60_000;
  const offset2 = pacificOffsetMinutes(new Date(guess));
  if (offset2 === offset1) return new Date(guess);
  return new Date(naive + offset2 * 60_000);
}

function pacificOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!m) return -480;
  const sign = m[1] === "+" ? 1 : -1;
  const h = Number.parseInt(m[2], 10);
  const min = m[3] ? Number.parseInt(m[3], 10) : 0;
  return -sign * (h * 60 + min);
}

/**
 * Resolve year for an ordered list of (month, day) sections, anchored at `now`.
 * Bimbo's listing is chronologically ascending; once the month index
 * decreases between consecutive sections, the year increments.
 *
 * Pure and deterministic given inputs.
 */
export function resolveYears(
  sections: { monthIdx: number; day: number }[],
  now: Date,
): number[] {
  if (sections.length === 0) return [];
  const nowMonth = now.getUTCMonth();
  const nowYear = now.getUTCFullYear();
  const firstMonth = sections[0].monthIdx;
  // First event is in the future. If its month is before "now"'s month, it
  // must belong to next year (Bimbo's never shows past events).
  let year = firstMonth < nowMonth ? nowYear + 1 : nowYear;
  const out: number[] = [];
  let prevMonth = firstMonth;
  for (const s of sections) {
    if (s.monthIdx < prevMonth) year += 1;
    out.push(year);
    prevMonth = s.monthIdx;
  }
  return out;
}

function parseShowTime(raw: string | null | undefined): { hour: number; minute: number } | null {
  if (!raw) return null;
  // e.g. "8:00 pm" or "10:30 PM"
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/.exec(raw);
  if (!m) return null;
  let hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the HTML of the /shows/ page into ParsedSection[].
 * Uses cheerio. Pure — takes raw HTML in, returns sections out.
 */
export function parseSections(html: string): ParsedSection[] {
  const $ = cheerio.load(html);
  const out: ParsedSection[] = [];

  $("#tw-responsive .tw-section").each((_, el) => {
    const $el = $(el);
    const monthName = cleanText($el.find(".tw-event-month").first().text()).toLowerCase();
    const dayStr = cleanText($el.find(".tw-event-date").first().text());
    const showTimeRaw = cleanText($el.find(".tw-event-time").first().text());
    const nameAnchor = $el.find(".tw-name a").first();
    const title = cleanText(nameAnchor.text());
    const detailUrl = (nameAnchor.attr("href") ?? "").trim();
    const prefix = cleanText($el.find(".tw-prefix").first().text()) || null;
    const buyUrl = (
      $el.find(".tw-info-price-buy-tix a.tw-buy-tix-btn").first().attr("href") ?? ""
    ).trim() || null;

    const monthIdx = MONTHS[monthName];
    const day = Number.parseInt(dayStr, 10);
    const t = parseShowTime(showTimeRaw);
    if (monthIdx === undefined) return;
    if (!Number.isFinite(day) || day < 1 || day > 31) return;
    if (!t) return;
    if (!title || !detailUrl) return;

    out.push({
      monthIdx,
      day,
      hour24: t.hour,
      minute: t.minute,
      title,
      prefix,
      detailUrl,
      buyUrl,
    });
  });

  return out;
}

/**
 * Build a RawEvent from a ParsedSection with a resolved year.
 * Pure / synchronous.
 */
export function buildRawEvent(
  s: ParsedSection,
  year: number,
  fetchedAt: Date,
): RawEvent {
  const startUtc = pacificWallTimeToUtc(year, s.monthIdx, s.day, s.hour24, s.minute);
  // Bimbo's shows typically run 2-3 hours. End time isn't published; we
  // leave it null so the persister doesn't fabricate one.
  const externalId = `${year}-${String(s.monthIdx + 1).padStart(2, "0")}-${String(s.day).padStart(2, "0")}-${s.detailUrl}`;
  const description = s.prefix ? `${s.prefix}. ${s.title}` : null;
  const pricing: PriceInfo = {
    priceMin: PRICE_FLOOR_USD,
    priceMax: null,
    isFree: false,
  };

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: s.detailUrl,
    },
    title: s.title,
    description,
    startTimeUtc: startUtc,
    endTimeUtc: null,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      neighborhood: VENUE_NEIGHBORHOOD,
      address: VENUE_ADDRESS,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: "music",
    pricing,
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      monthIdx: s.monthIdx,
      day: s.day,
      year,
      hour24: s.hour24,
      minute: s.minute,
      prefix: s.prefix,
      title: s.title,
      detailUrl: s.detailUrl,
      buyUrl: s.buyUrl,
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
      const { html } = await fetchHtml(LISTING_URL);
      const sections = parseSections(html);

      if (sections.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `no .tw-section blocks parsed from ${LISTING_URL} — page format may have changed`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const years = resolveYears(sections, fetchedAt);
      const seen = new Set<string>();
      for (let i = 0; i < sections.length; i++) {
        try {
          const ev = buildRawEvent(sections[i], years[i], fetchedAt);
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
