import * as cheerio from "cheerio";
import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import type {
  Category,
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * Mission Community Market — Tier-3 scraper retargeted at Foodwise.
 *
 * History: the canonical missioncommunitymarket.org domain is parked at a
 * DreamHost "Site Not Found" placeholder. Since 2018 the market has been
 * operated by Foodwise (formerly CUESA) and the live event listings now
 * live at foodwise.org/events/, tagged with the "Mission" location
 * taxonomy. We scrape that listing and emit only events whose type tag
 * line includes "Mission" — those are the MCM-specific happenings
 * (Día de los Muertos, season opener / closer, anniversary celebrations,
 * occasional concerts).
 *
 * The weekly Thursday-3-to-7 farmers market itself is NOT published as
 * individual event posts by Foodwise — it's described as a recurring
 * series on the markets/mission-community-market/ page. The previous
 * implementation of this adapter synthesized those weekly occurrences
 * from agent memory; that violates the M3 rule "every event must come
 * from a verifiable HTTP response" so we no longer do it. The recurring
 * market schedule can be re-introduced later via an editorial/series
 * row, not by adapter fabrication.
 *
 * Robots.txt (foodwise.org): only disallows MJ12bot, PetalBot, and
 * Awario*bot. Our default UA is permitted (B2).
 *
 * Method: single HTTP fetch against foodwise.org/events/, parsed with
 * cheerio. The listing is ordered by event date ASC and renders the
 * full forward horizon on page 1 in practice (~10-14 cards), with
 * MCM-tagged events always appearing within page 1's date window
 * (the next page contains additional Ferry Plaza items). We don't
 * paginate — B3 requires at most one listing fetch.
 *
 * Each card is structured as:
 *   <a href="...event slug..." class="card-without-button__outer-anchor">
 *     <article class="card-without-button__container" id="...">
 *       <div class="card-without-button__image-content">...</div>
 *       <div class="card-without-button__text-content">
 *         <h2>TITLE</h2>
 *         <p class="no-margin"><small>TYPE TAGS, LOCATION</small></p>
 *         <p>FULL DATE LINE</p>
 *       </div>
 *     </article>
 *   </a>
 *
 * The trailing tag in the <small> line is the location label; we keep
 * only cards whose tag line includes "Mission".
 *
 * Dates are rendered as e.g.:
 *   "Thursday, October 29, 2026, 3:00 pm - 7:00 pm"
 *   "Saturday, July 4, 2026, 8:00 am - 12:00 am"
 * Multi-day ranges use a second weekday/date prefix on the end side:
 *   "Saturday, July 4, 2026, 12:00 pm - Saturday, August 8, 2026, 12:00 pm"
 * All times are Pacific local wall time.
 */

const ID = "scrape:missionmarket";
const LISTING_URL = "https://foodwise.org/events/";
const TZ = "America/Los_Angeles";
const CATEGORY: Category = "food";
const LOCATION_TAG = "Mission";

const VENUE_NAME = "Mission Community Market";
const VENUE_ADDRESS = "Bartlett Street between 21st & 22nd, San Francisco, CA";
const VENUE_NEIGHBORHOOD = "Mission";
// Bartlett & 22nd, San Francisco (Mission).
const VENUE_LAT = 37.7558;
const VENUE_LNG = -122.4192;

const MAX_EVENTS = 50;

export type ParsedListingItem = {
  slug: string;
  title: string;
  url: string;
  typeTags: string; // comma-joined: "Market Happening, Mission"
  dateText: string; // "Thursday, October 29, 2026, 3:00 pm - 7:00 pm"
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/**
 * Convert a Pacific-local wall time (Y/M/D/H/m) to a UTC Date. Local
 * helper — kept on this adapter so we don't reach across modules
 * (A9 invariant).
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
    timeZone: TZ,
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

type ParsedDate = {
  year: number;
  monthIdx: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * Parse a Foodwise calendar token such as
 *   "Thursday, October 29, 2026, 3:00 pm"
 * The weekday prefix is ignored; we trust the explicit date.
 */
function parseDateToken(token: string): ParsedDate | null {
  const t = token.replace(/\s+/g, " ").trim();
  const noWeekday = t.replace(
    /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*,\s*/i,
    "",
  );
  const m =
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*([ap])m$/i
      .exec(noWeekday);
  if (!m) return null;
  const monthIdx = MONTHS[m[1].toLowerCase()];
  if (monthIdx === undefined) return null;
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  let hour = Number.parseInt(m[4], 10);
  const minute = Number.parseInt(m[5], 10);
  const ampm = m[6].toLowerCase();
  if (hour === 12) hour = 0;
  if (ampm === "p") hour += 12;
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, monthIdx, day, hour, minute };
}

/**
 * Parse the full Foodwise date line, e.g.:
 *   "Thursday, October 29, 2026, 3:00 pm - 7:00 pm"
 *   "Saturday, July 4, 2026, 12:00 pm - Saturday, August 8, 2026, 12:00 pm"
 *
 * Returns null when the start side can't be parsed. End side is best-
 * effort: same-day shorthand ("3:00 pm - 7:00 pm") inherits the start
 * day; cross-day ranges use the second full token.
 */
export function parseFoodwiseDateLine(
  raw: string,
): { startUtc: Date; endUtc: Date | null } | null {
  const line = raw.replace(/\s+/g, " ").trim();
  // Split on the first " - " (en/em dashes appear too, fall back).
  const sepMatch = /\s+[-–—]\s+/.exec(line);
  const startStr = sepMatch ? line.slice(0, sepMatch.index).trim() : line;
  const endStr = sepMatch
    ? line.slice(sepMatch.index + sepMatch[0].length).trim()
    : null;

  const start = parseDateToken(startStr);
  if (!start) return null;
  const startUtc = pacificWallTimeToUtc(
    start.year,
    start.monthIdx,
    start.day,
    start.hour,
    start.minute,
  );

  let endUtc: Date | null = null;
  if (endStr) {
    // Try full end token first (cross-day ranges).
    const fullEnd = parseDateToken(endStr);
    if (fullEnd) {
      endUtc = pacificWallTimeToUtc(
        fullEnd.year,
        fullEnd.monthIdx,
        fullEnd.day,
        fullEnd.hour,
        fullEnd.minute,
      );
    } else {
      // Fall back to time-only end (same-day shorthand: "7:00 pm").
      const hm = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(endStr);
      if (hm) {
        let hour = Number.parseInt(hm[1], 10);
        const minute = Number.parseInt(hm[2], 10);
        const ampm = hm[3].toLowerCase();
        if (hour === 12) hour = 0;
        if (ampm === "p") hour += 12;
        if (hour <= 23 && minute <= 59) {
          endUtc = pacificWallTimeToUtc(
            start.year,
            start.monthIdx,
            start.day,
            hour,
            minute,
          );
          // Midnight close convention ("- 12:00 am") wraps to next day.
          if (endUtc.getTime() <= startUtc.getTime()) {
            endUtc = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000);
          }
        }
      }
    }
  }

  return { startUtc, endUtc };
}

/**
 * Parse Foodwise's events listing HTML into structured card records.
 * Pure / synchronous so tests can run against the fixture without IO.
 *
 * The listing renders all cards regardless of taxonomy. Callers should
 * filter on `typeTags` (we look for the "Mission" location tag) before
 * lifting cards into RawEvents.
 */
export function parseListingHtml(html: string): ParsedListingItem[] {
  const $ = cheerio.load(html);
  const items: ParsedListingItem[] = [];

  $("a.card-without-button__outer-anchor").each((_, el) => {
    const $a = $(el);
    const url = ($a.attr("href") ?? "").trim();
    if (!url) return;
    // Slug = trailing path segment, used as externalId.
    const slug = url.replace(/\/+$/, "").split("/").pop() ?? "";
    if (!slug) return;

    const $content = $a.find(".card-without-button__text-content").first();
    if ($content.length === 0) return;

    const title = $content.find("h2").first().text().trim();
    if (!title) return;

    // Type/location tag line: <small> inside the first <p class="no-margin">.
    const typeTags = $content
      .find("p.no-margin small")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    // Date line: the first <p> WITHOUT class="no-margin".
    let dateText = "";
    $content.find("p").each((_i, p) => {
      const $p = $(p);
      if ($p.hasClass("no-margin")) return;
      const t = $p.text().replace(/\s+/g, " ").trim();
      if (!dateText && t) dateText = t;
    });
    if (!dateText) return;

    items.push({ slug, title, url, typeTags, dateText });
  });

  return items;
}

/**
 * True if the card's type/location tags include the Mission location
 * label. Tags arrive comma-separated; we do a token-aware match so a
 * future "Mission Bay" taxonomy wouldn't falsely qualify.
 */
export function isMissionCard(typeTags: string): boolean {
  return typeTags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(LOCATION_TAG.toLowerCase());
}

/**
 * Lift one parsed Mission-tagged item into a RawEvent. Returns null
 * when the date line can't be parsed.
 */
export function buildRawEvent(
  item: ParsedListingItem,
  fetchedAt: Date,
): RawEvent | null {
  const parsed = parseFoodwiseDateLine(item.dateText);
  if (!parsed) return null;
  const { startUtc, endUtc } = parsed;
  if (Number.isNaN(startUtc.getTime())) return null;

  return {
    identity: {
      source: ID,
      externalId: item.slug,
      sourceUrl: item.url,
    },
    title: item.title,
    description: null,
    startTimeUtc: startUtc,
    endTimeUtc: endUtc,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      address: VENUE_ADDRESS,
      neighborhood: VENUE_NEIGHBORHOOD,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: CATEGORY,
    // Mission Community Market is a free public market; the special
    // events that Foodwise publishes against it (Día de los Muertos,
    // anniversary celebrations, season open/close) are free to attend.
    // Vendors charge per-item but admission itself is free.
    pricing: { isFree: true },
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      slug: item.slug,
      title: item.title,
      url: item.url,
      typeTags: item.typeTags,
      dateText: item.dateText,
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
      const items = parseListingHtml(html);

      if (items.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `no event cards matched on ${LISTING_URL} — Foodwise page format may have changed`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const seen = new Set<string>();
      // D6: drop events more than a week in the past.
      const horizonCutoff = fetchedAt.getTime() - 7 * 24 * 60 * 60 * 1000;
      for (const item of items.slice(0, MAX_EVENTS)) {
        if (!isMissionCard(item.typeTags)) continue;
        try {
          const ev = buildRawEvent(item, fetchedAt);
          if (!ev) continue;
          if (ev.startTimeUtc.getTime() < horizonCutoff) continue;
          if (seen.has(ev.identity.externalId)) continue;
          seen.add(ev.identity.externalId);
          events.push(ev);
        } catch (err) {
          errors.push({
            source: ID,
            externalId: item.slug,
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
      pricing: raw.pricing ?? { isFree: false },
      venue: raw.venue,
      recurrence: raw.recurrence ?? null,
      verificationLevel: raw.verificationLevel,
      rawPayload: raw.rawPayload,
      provenance,
    };
  },
};

export default adapter;
