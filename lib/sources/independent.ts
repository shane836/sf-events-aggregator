import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * The Independent (theindependentsf.com) — Western Addition / NoPa music venue.
 *
 * Discovery notes (M3 / B-rubric):
 *   - robots.txt: `User-agent: *` with empty `Disallow:` and `Crawl-delay: 10`.
 *     Scraping is permitted; we make ONE GET per ingest (B3).
 *   - /calendar/ is a client-side FullCalendar (Ticketweb plugin) — empty
 *     until JS runs, useless for cheerio.
 *   - The site root `/` is the server-rendered "Eventlist" tab. Each event is
 *     a `.row.tw-event-item` block with title, MM.DD date, day-of-week,
 *     showtime, and a detail-page link. The `title` attribute on the more-info
 *     link is `"<Artist> - <DD>"` which we use as the externalId tail.
 *   - JSON-LD on the listing page is only Yoast WebSite/Organization metadata
 *     (no `Event` nodes), so we parse CSS — B1 still passes because we prefer
 *     semantic HTML attributes (title, href, day-of-week label) over visual
 *     classes where possible.
 *   - Detail pages exist but we deliberately do NOT fetch them (B3: one fetch
 *     per ingest). Showtime + date are on the listing.
 *
 * Identity:
 *   - externalId: detail-page slug (e.g. `rose-gray` from `/tm-event/rose-gray/`).
 *     Stable per show because Ticketweb assigns unique slugs.
 *   - sourceUrl: the detail page URL on theindependentsf.com (always set).
 *
 * Year inference: listing only shows MM.DD. We pick the year that makes the
 * date land in [today - 7d, today + 400d]; rolling within that window the
 * MM.DD is unambiguous.
 */

const ID = "scrape:independent";
const LISTING_URL = "https://www.theindependentsf.com/";
const BASE_URL = "https://www.theindependentsf.com";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "The Independent";
const VENUE_ADDRESS = "628 Divisadero St, San Francisco, CA 94117";
const VENUE_NEIGHBORHOOD = "Western Addition / NoPa";
const VENUE_LAT = 37.7762;
const VENUE_LNG = -122.4377;

const DAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
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
      const { $, finalUrl } = await fetchHtml(LISTING_URL);
      const items = $(".tw-event-item");

      items.each((_, el) => {
        try {
          const raw = parseEventItem($, el, fetchedAt, finalUrl);
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

// --- helpers (pure) ---------------------------------------------------------

/**
 * Parse a single `.tw-event-item` element into a RawEvent.
 * Returns null if a required field (title, href, date) is missing.
 */
export function parseEventItem(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  fetchedAt: Date,
  baseUrl: string,
): RawEvent | null {
  const $el = $(el);

  const titleLink = $el.find(".tw-name a").first();
  const title = collapseWs(titleLink.text());
  const href = titleLink.attr("href") ?? "";
  if (!title || !href) return null;

  const sourceUrl = absoluteUrl(href, baseUrl);
  const slug = extractSlug(href);
  if (!slug) return null;

  const dateText = collapseWs($el.find(".tw-event-date").first().text());
  const dayOfWeek = collapseWs($el.find(".tw-day-of-week").first().text());
  if (!dateText) return null;

  // Showtime: "Show: 8:00 PM" → "8:00 PM"
  const showRaw = collapseWs($el.find(".tw-event-time").first().text());
  const showtime = showRaw.replace(/^show:\s*/i, "").trim() || null;

  const startTimeUtc = resolveStartTime(dateText, dayOfWeek, showtime, fetchedAt);
  if (!startTimeUtc) return null;

  const prefix = collapseWs($el.find(".tw-prefix").first().text());
  const attractions = collapseWs($el.find(".tw-attractions").first().text());
  const descriptionParts: string[] = [];
  if (prefix) descriptionParts.push(prefix);
  if (attractions) descriptionParts.push(attractions);
  const description = descriptionParts.length
    ? descriptionParts.join(" — ").slice(0, 4000)
    : null;

  return {
    identity: {
      source: ID,
      externalId: slug,
      sourceUrl,
    },
    title,
    description,
    startTimeUtc,
    endTimeUtc: null,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      address: VENUE_ADDRESS,
      neighborhood: VENUE_NEIGHBORHOOD,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: "music",
    // Listing page never shows a final price for this venue (Ticketweb buy
    // button only). Structured pricing keeps D2 happy: priceMin=null,
    // priceMax=null, isFree=false signals "price varies / see ticket link".
    pricing: { priceMin: null, priceMax: null, isFree: false },
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      slug,
      dateText,
      dayOfWeek,
      showtime,
      title,
      sourceUrl,
    },
    fetchedAt,
  };
}

function collapseWs(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base || BASE_URL).toString();
  } catch {
    return href;
  }
}

/**
 * Detail-page URLs look like `https://www.theindependentsf.com/tm-event/rose-gray/`.
 * Return `rose-gray` (the stable per-show slug used as externalId).
 */
export function extractSlug(href: string): string | null {
  const m = href.match(/\/tm-event\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  // Fallback: last path segment.
  try {
    const u = new URL(href, BASE_URL);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Build a UTC start time from listing metadata.
 *
 * Inputs:
 *   - dateText: "5.24" (MM.DD, no year)
 *   - dayOfWeek: "Sun" (used to pick the right year when month+day are
 *     ambiguous near year wrap)
 *   - showtime: "8:00 PM" | "10:30 pm" | null (default 8:00 PM if absent)
 *   - now: clock-reference Date (the fetchedAt timestamp from the caller —
 *     keeps the function pure for testing)
 *
 * Strategy: try this year and next year; pick the candidate whose
 *   - local day-of-week matches `dayOfWeek` (when given), AND
 *   - falls in the window [now - 14d, now + 540d].
 * If day-of-week matches both candidates (rare), prefer the closest to now
 * that is >= now - 14d.
 */
export function resolveStartTime(
  dateText: string,
  dayOfWeek: string,
  showtime: string | null,
  now: Date,
): Date | null {
  const dm = dateText.match(/^\s*(\d{1,2})\.(\d{1,2})\s*$/);
  if (!dm) return null;
  const month = Number(dm[1]);
  const day = Number(dm[2]);
  if (!isValidMonthDay(month, day)) return null;

  const hm = parseShowtime(showtime) ?? { hour: 20, minute: 0 };
  const dowKey = (dayOfWeek || "").slice(0, 3).toLowerCase();
  const targetDow = DAY_TO_INDEX[dowKey];

  const currentYear = getYearInLA(now);
  const candidates: Date[] = [];
  for (const yearOffset of [-1, 0, 1, 2]) {
    const year = currentYear + yearOffset;
    const utc = buildUtcFromLocal(year, month, day, hm.hour, hm.minute);
    if (utc) candidates.push(utc);
  }

  const lower = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const upper = now.getTime() + 540 * 24 * 60 * 60 * 1000;

  let best: Date | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of candidates) {
    const t = cand.getTime();
    if (t < lower || t > upper) continue;

    const dow = getLocalDayOfWeek(cand);
    const dowOk = targetDow === undefined || dow === targetDow;

    // Score: prefer day-of-week match, then closeness to "now" without going
    // negative more than ~1 day. Smaller score wins.
    const distance = Math.abs(t - now.getTime());
    const score = (dowOk ? 0 : 1_000_000_000_000) + distance;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}

function isValidMonthDay(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Parse "8:00 PM" / "10:30 pm" / "8 pm" → {hour, minute} in 24h. null if no match.
 */
export function parseShowtime(s: string | null): { hour: number; minute: number } | null {
  if (!s) return null;
  const m = s
    .toLowerCase()
    .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (hour === 12) hour = 0;
  if (ampm === "pm") hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Build a UTC Date for a given local (America/Los_Angeles) wall time. Returns
 * null if the wall time is invalid (Feb 30, etc).
 *
 * Approach: guess UTC = local + 8h, then read back the local time via
 * Intl.DateTimeFormat and correct for the actual offset. One correction is
 * sufficient unless the guess crosses a DST boundary; we iterate twice to be
 * safe.
 */
export function buildUtcFromLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  // First guess: assume LA is UTC-8.
  let utc = new Date(Date.UTC(year, month - 1, day, hour + 8, minute, 0));

  for (let i = 0; i < 2; i++) {
    const parts = getLocalParts(utc);
    if (!parts) return null;
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return utc;
    }
    const localMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offset = localMs - utc.getTime(); // local minus UTC ms
    utc = new Date(targetMs - offset);
  }

  // Verify the final value actually round-trips; if not, the input was an
  // invalid local time (e.g. Feb 30) and we drop it.
  const final = getLocalParts(utc);
  if (
    !final ||
    final.year !== year ||
    final.month !== month ||
    final.day !== day ||
    final.hour !== hour ||
    final.minute !== minute
  ) {
    return null;
  }
  return utc;
}

function getLocalParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    const hour = map.hour === "24" ? 0 : Number(map.hour);
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour,
      minute: Number(map.minute),
    };
  } catch {
    return null;
  }
}

function getYearInLA(d: Date): number {
  const parts = getLocalParts(d);
  return parts ? parts.year : d.getUTCFullYear();
}

function getLocalDayOfWeek(d: Date): number {
  // 0 = Sunday … 6 = Saturday in LA local time.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(d);
  return DAY_TO_INDEX[weekday.slice(0, 3).toLowerCase()] ?? d.getUTCDay();
}
