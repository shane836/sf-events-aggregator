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
 * The Chapel — live music venue, 777 Valencia, Mission District.
 *
 * The /music/ listing is a server-rendered WordPress page that embeds a
 * SeeTickets "list view" widget. Each event is a `.seetickets-list-event-container`
 * with semantic child elements (`.title`, `.date`, `.see-showtime`, `.price`).
 *
 * No JSON-LD for events on this page (the only ld+json block describes the
 * WebPage/Organization itself), so we go straight to CSS. Selectors are stable
 * because they come from the SeeTickets widget shortcode, not the WP theme.
 *
 * One listing fetch per ingest (B3). No detail-page hits — we have enough on
 * the listing card.
 */

const ID = "scrape:chapel";
const LISTING_URL = "https://thechapelsf.com/music/";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "The Chapel";
const VENUE_ADDRESS = "777 Valencia St, San Francisco, CA 94110";
const NEIGHBORHOOD = "Mission";
const UA =
  "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)";

export type ParsedCard = {
  externalId: string;
  title: string;
  sourceUrl: string;
  dateText: string;
  showtimeText: string | null;
  doortimeText: string | null;
  priceText: string | null;
  header: string | null;
  genre: string | null;
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
      const { $ } = await fetchHtml(LISTING_URL, { ua: UA });

      const cards = $(".seetickets-list-event-container").toArray();
      if (cards.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message:
            "No .seetickets-list-event-container nodes found on /music/. Page structure may have changed.",
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      for (const el of cards) {
        const parsed = parseCard($, el);
        if (!parsed) continue;

        const startTimeUtc = combineDateAndTime(
          parsed.dateText,
          parsed.showtimeText,
          fetchedAt,
        );
        if (!startTimeUtc) {
          errors.push({
            source: ID,
            externalId: parsed.externalId,
            stage: "parse",
            message: `Could not parse date/time: "${parsed.dateText}" + "${parsed.showtimeText ?? ""}"`,
            retryable: false,
            occurredAt: new Date(),
          });
          continue;
        }

        const pricing = parsePrice(parsed.priceText);
        const descParts = [parsed.header, parsed.genre]
          .filter((s): s is string => !!s && s.trim().length > 0)
          .map((s) => s.trim());
        const description = descParts.length > 0 ? descParts.join(" — ") : null;

        events.push({
          identity: {
            source: ID,
            externalId: parsed.externalId,
            sourceUrl: parsed.sourceUrl,
          },
          title: parsed.title,
          description,
          startTimeUtc,
          endTimeUtc: null,
          timezone: TZ,
          venue: {
            name: VENUE_NAME,
            neighborhood: NEIGHBORHOOD,
            address: VENUE_ADDRESS,
            lat: null,
            lng: null,
            timezone: TZ,
          },
          primaryCategory: "music",
          pricing,
          recurrence: null,
          verificationLevel: "official",
          rawPayload: {
            externalId: parsed.externalId,
            title: parsed.title,
            dateText: parsed.dateText,
            showtimeText: parsed.showtimeText,
            priceText: parsed.priceText,
            genre: parsed.genre,
          },
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

// ---------- helpers (exported for tests) ----------

export function parseCard(
  $: cheerio.CheerioAPI,
  el: unknown,
): ParsedCard | null {
  const $el = $(el as never);
  const titleLink = $el.find(".event-info-block .title a").first();
  const title = (titleLink.text() || "").trim();
  const href = (titleLink.attr("href") || "").trim();
  if (!title || !href) return null;

  const externalId = extractSeeTicketsId(href);
  if (!externalId) return null;

  const dateText =
    ($el.find(".event-info-block .date").first().text() || "").trim();
  const showtimeText =
    ($el.find(".event-info-block .see-showtime").first().text() || "").trim() ||
    null;
  const doortimeText =
    ($el.find(".event-info-block .see-doortime").first().text() || "").trim() ||
    null;
  const priceText =
    ($el.find(".event-info-block .price").first().text() || "").trim() || null;
  const header =
    ($el.find(".event-info-block .header").first().text() || "").trim() || null;
  const genre =
    ($el.find(".event-info-block .genre").first().text() || "").trim() || null;

  return {
    externalId,
    title,
    sourceUrl: href,
    dateText,
    showtimeText,
    doortimeText,
    priceText,
    header,
    genre,
  };
}

/**
 * SeeTickets event URLs look like:
 *   https://wl.seetickets.us/event/the-crosseyed/692844?afflky=TheChapel
 * The numeric ID at the end of the path is the stable per-event identifier.
 * We prefix with "seetickets-" so the ID is self-describing in the DB.
 */
export function extractSeeTicketsId(url: string): string | null {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean); // ["event","slug","ID"]
    const last = segs[segs.length - 1];
    if (!last) return null;
    if (!/^\d+$/.test(last)) return null;
    const slug = segs[segs.length - 2] ?? "event";
    return `seetickets-${last}-${slug}`;
  } catch {
    return null;
  }
}

/**
 * SeeTickets list cards render the date as "Fri Jul 31" (no year) and the
 * show time as "9:00PM". Combine them, in America/Los_Angeles, using the
 * fetchedAt clock as the year-inference anchor.
 *
 *   - If the parsed month/day is < (fetchedAt local month/day - 7d slack),
 *     it must be next year.
 *   - Otherwise use fetchedAt's year.
 *
 * Returns a Date in UTC representing that local wall-clock instant, or
 * null if either input fails to parse.
 */
export function combineDateAndTime(
  dateText: string,
  showtimeText: string | null,
  now: Date,
): Date | null {
  const md = parseMonthDay(dateText);
  if (!md) return null;
  const hm = parseClockTime(showtimeText ?? "");
  // If we don't have a show time, default to 20:00 local — Chapel doors are
  // usually 7-8 PM and shows 8-9 PM. Better than dropping the event.
  const hour = hm ? hm.hour : 20;
  const minute = hm ? hm.minute : 0;

  const localNow = getLocalYmd(now, TZ);
  let year = localNow.year;
  const candidateOrdinal = md.month * 100 + md.day;
  const nowOrdinal = localNow.month * 100 + localNow.day;
  // 7-day backward slack so a show "tonight" doesn't roll to next year if
  // local-vs-UTC date drift bites us.
  if (candidateOrdinal < nowOrdinal - 7) {
    year += 1;
  }

  return localWallClockToUtc(year, md.month, md.day, hour, minute, TZ);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonthDay(text: string): { month: number; day: number } | null {
  // Accepts "Fri Jul 31", "Jul 31", "Fri Jul 31, 2026" — we ignore weekday +
  // any trailing year (we re-derive year ourselves).
  const m = text.match(/([A-Za-z]{3,})\s+(\d{1,2})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day = parseInt(m[2], 10);
  if (!month || !day || day < 1 || day > 31) return null;
  return { month, day };
}

function parseClockTime(text: string): { hour: number; minute: number } | null {
  // "9:00PM", "8PM", "10:30 PM"
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const isPm = m[3].toLowerCase() === "p";
  if (hour === 12) hour = isPm ? 12 : 0;
  else if (isPm) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Get YYYY-MM-DD parts of `date` interpreted in `tz`.
 */
function getLocalYmd(date: Date, tz: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
  };
}

/**
 * Convert a wall-clock instant in tz to UTC. Handles DST via the offset
 * round-trip trick: compute the timezone offset at the candidate UTC instant,
 * then subtract it from the naive UTC reading of the wall-clock.
 */
export function localWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Naive: pretend the wall-clock IS UTC.
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // What does that naive UTC instant look like in tz?
  const tzParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(naive));
  const m: Record<string, string> = {};
  for (const p of tzParts) if (p.type !== "literal") m[p.type] = p.value;
  const tzReading = Date.UTC(
    parseInt(m.year, 10),
    parseInt(m.month, 10) - 1,
    parseInt(m.day, 10),
    m.hour === "24" ? 0 : parseInt(m.hour, 10),
    parseInt(m.minute, 10),
    parseInt(m.second, 10),
  );
  // The difference is the tz offset (ms) at that instant.
  const offset = tzReading - naive;
  return new Date(naive - offset);
}

/**
 * Parse SeeTickets price strings:
 *   "$20.00-$25.00"  → { priceMin: 20, priceMax: 25, isFree: false }
 *   "$30.00"         → { priceMin: 30, priceMax: 30, isFree: false }
 *   "Free" / "FREE"  → { priceMin: null, priceMax: null, isFree: true }
 *   ""/null/garbage  → null  (caller defaults to {priceMin:null,priceMax:null,isFree:false})
 *
 * D2 invariant: we never want a row with no pricing signal at all. If the
 * Chapel page literally omits price (rare), we still emit
 * `{ priceMin: null, priceMax: null, isFree: false }` via the normalize
 * fallback — but with priceMin/priceMax both null AND isFree false, D2's
 * rubric check fails. So when we see no price text, we tag it as
 * `{ priceMin: 0, priceMax: null, isFree: false }` is wrong — better signal
 * is "the venue charges something but the page didn't say": we leave priceMin
 * null but flag isFree=false; D2 will catch it. In practice every Chapel
 * card we saw had a price.
 */
export function parsePrice(text: string | null): PriceInfo {
  if (!text) return { priceMin: null, priceMax: null, isFree: false };
  const trimmed = text.trim();
  if (/^free$/i.test(trimmed)) {
    return { priceMin: null, priceMax: null, isFree: true };
  }
  const nums = Array.from(trimmed.matchAll(/\$?\s*(\d+(?:\.\d+)?)/g)).map(
    (m) => parseFloat(m[1]),
  );
  if (nums.length === 0) {
    return { priceMin: null, priceMax: null, isFree: false };
  }
  if (nums.length === 1) {
    return { priceMin: nums[0], priceMax: nums[0], isFree: false };
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { priceMin: min, priceMax: max, isFree: false };
}
