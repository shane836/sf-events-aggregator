import { fetchHtml } from "@/lib/scrape";
import { fingerprint, formatLocalDate } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

/**
 * Rhythm & Motion Dance Program — drop-in classes at ODC Dance Commons (SF).
 *
 * Approach: schedule-expansion. The site has no JSON-LD events and no dated
 * listings — it publishes a weekly recurring schedule as a single
 * `<ul data-rte-list>` of <li> items on /sf-odc with the format:
 *   "<time> <className> <Day> <modality> with <Instructor>"
 * We parse each line and expand the next HORIZON_DAYS of calendar dates,
 * emitting one RawEvent per occurrence with a stable externalId so dedup
 * works on the canonical_fingerprint index.
 *
 * Single listing-page fetch per ingest (B3). No detail pages.
 */

const ID = "scrape:rhythmmotion";
const LISTING_URL = "https://www.rhythmandmotion.com/sf-odc";
const TZ = "America/Los_Angeles";
const HORIZON_DAYS = 60;

const VENUE_NAME = "ODC Dance Commons";
const VENUE_ADDRESS = "351 Shotwell St, San Francisco, CA 94110";
const VENUE_NEIGHBORHOOD = "Mission";
const VENUE_LAT = 37.7651;
const VENUE_LNG = -122.4156;

// Drop-in single-class prices (from /sf-odc):
//   In-person:  $21 ($12 Arts Access)
//   Livestream: $14
const PRICE_INPERSON = 21;
const PRICE_LIVESTREAM = 14;

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type ParsedClass = {
  rawText: string;
  hour: number;
  minute: number;
  className: string;
  dayIndex: DayIndex;
  modality: "in-person" | "hybrid" | "livestream";
  instructor: string;
  slug: string;
};

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    let html: string;
    try {
      const result = await fetchHtml(LISTING_URL);
      html = result.html;
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    let parsed: ParsedClass[];
    try {
      parsed = parseSchedule(html);
    } catch (err) {
      errors.push({
        source: ID,
        stage: "parse",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    if (parsed.length === 0) {
      errors.push({
        source: ID,
        stage: "parse",
        message:
          "no class items parsed from /sf-odc schedule list (selector or page structure changed)",
        retryable: false,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    // Expand each weekly class across HORIZON_DAYS of upcoming dates.
    const today = startOfLocalDay(fetchedAt, TZ);
    for (const cls of parsed) {
      const occurrences = expandWeekly(today, cls.dayIndex, HORIZON_DAYS);
      for (const localDate of occurrences) {
        const startUtc = buildUtcFromLocal(
          localDate,
          cls.hour,
          cls.minute,
          TZ,
        );
        if (!startUtc) continue;

        const dateKey = formatLocalDate(startUtc, TZ);
        const externalId = `${cls.slug}-${dateKey}`;
        const sourceUrl = `${LISTING_URL}#${cls.slug}`;
        const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);

        events.push({
          identity: {
            source: ID,
            externalId,
            sourceUrl,
          },
          title: `Rhythm & Motion: ${cls.className} with ${cls.instructor}`,
          description: `Drop-in ${cls.modality} dance class at ODC Dance Commons. ${cls.rawText}`,
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
          primaryCategory: "dancing",
          pricing:
            cls.modality === "livestream"
              ? { priceMin: PRICE_LIVESTREAM, priceMax: PRICE_LIVESTREAM, isFree: false }
              : { priceMin: PRICE_INPERSON, priceMax: PRICE_INPERSON, isFree: false },
          recurrence: {
            seriesId: `rhythmmotion:${cls.slug}`,
            occurrenceId: dateKey,
          },
          verificationLevel: "official",
          rawPayload: {
            rawText: cls.rawText,
            className: cls.className,
            instructor: cls.instructor,
            dayIndex: cls.dayIndex,
            modality: cls.modality,
            occurrenceDate: dateKey,
          },
          fetchedAt,
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

// ---------------------------------------------------------------------------
// Schedule parsing (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Extract <li> items from the first `<ul data-rte-list...>` block on the
 * page, decode entities, strip tags, collapse whitespace. We deliberately
 * use a focused regex rather than full cheerio here: the schedule list is
 * the only data-rte-list on /sf-odc and the structure is stable.
 */
export function parseSchedule(html: string): ParsedClass[] {
  const ulMatch = html.match(/<ul data-rte-list[^>]*>([\s\S]*?)<\/ul>/);
  if (!ulMatch) return [];
  const block = ulMatch[1];
  const itemHtmls = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(
    (m) => m[1],
  );

  const out: ParsedClass[] = [];
  let lastDayIndex: DayIndex | null = null;
  for (const itemHtml of itemHtmls) {
    const text = decodeEntities(stripTags(itemHtml)).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const parsed = parseClassLine(text, lastDayIndex);
    if (parsed) {
      lastDayIndex = parsed.dayIndex;
      out.push(parsed);
    }
  }
  return out;
}

/**
 * Parse one schedule line. Format observed on /sf-odc:
 *   "8:30am Fusion Sundays in-person with Katie Clay"
 *   "5:45 Modern Thursdays in-person with Katie Clay"      (no am/pm: default pm)
 *   "10am Fusion in-person with Dudley Flores"             (no day: inherit prev)
 *   "5:45pm Fusion Mondays hybrid (in-person and livestream) with Aimee Zawitz"
 */
export function parseClassLine(
  text: string,
  inheritedDayIndex: DayIndex | null,
): ParsedClass | null {
  // 1. Time at the start: "8:30am" | "10am" | "5:45" | "12pm"
  const timeMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;
  const rawHour = parseInt(timeMatch[1], 10);
  const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3]?.toLowerCase() as "am" | "pm" | undefined;

  // Default missing am/pm to pm (the two affected lines on /sf-odc are evening classes).
  // Sanity guard: if no meridiem and hour is 7-11, assume morning context only if
  // the previous parsed class on the same day was also morning. Simpler default:
  // assume pm when meridiem missing — observed lines (`5:45 Fusion`, `5:45 Modern`)
  // are all evening.
  const effectiveMeridiem: "am" | "pm" = meridiem ?? "pm";
  const hour = normalizeHour12To24(rawHour, effectiveMeridiem);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const afterTime = text.slice(timeMatch[0].length).trim();

  // 2. " with <Instructor>" — last segment.
  const withIdx = afterTime.toLowerCase().lastIndexOf(" with ");
  if (withIdx < 0) return null;
  const instructor = afterTime.slice(withIdx + 6).trim();
  const middle = afterTime.slice(0, withIdx).trim();

  // 3. Day name (Sundays|Mondays|...). May be missing → inherit.
  const dayMatch = middle.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i,
  );
  let dayIndex: DayIndex | null = null;
  let withoutDay = middle;
  if (dayMatch) {
    dayIndex = DAY_NAMES.indexOf(dayMatch[1].toLowerCase() as (typeof DAY_NAMES)[number]) as DayIndex;
    withoutDay = (middle.slice(0, dayMatch.index ?? 0) + middle.slice((dayMatch.index ?? 0) + dayMatch[0].length)).trim();
  } else if (inheritedDayIndex !== null) {
    dayIndex = inheritedDayIndex;
  } else {
    return null;
  }

  // 4. Modality: "in-person" | "hybrid" | "livestream". Look at the tail.
  const lower = withoutDay.toLowerCase();
  let modality: "in-person" | "hybrid" | "livestream" = "in-person";
  let modalityRegex: RegExp | null = null;
  if (/\bhybrid\b/.test(lower)) {
    modality = "hybrid";
    modalityRegex = /\s*hybrid\b\s*(\([^)]*\))?\s*/i;
  } else if (/\bin[- ]person\b/.test(lower)) {
    modality = "in-person";
    modalityRegex = /\s*in[- ]person\b\s*/i;
  } else if (/\blivestream\b/.test(lower)) {
    modality = "livestream";
    modalityRegex = /\s*livestream\b\s*/i;
  }

  const className = (
    modalityRegex ? withoutDay.replace(modalityRegex, " ") : withoutDay
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!className || !instructor) return null;

  const dayName = DAY_NAMES[dayIndex];
  const slug = [
    slugify(className),
    dayName,
    pad2(hour) + pad2(minute),
    slugify(instructor),
  ].join("-");

  return {
    rawText: text,
    hour,
    minute,
    className,
    dayIndex,
    modality,
    instructor,
    slug,
  };
}

function normalizeHour12To24(hour12: number, meridiem: "am" | "pm"): number {
  if (hour12 < 1 || hour12 > 12) {
    // tolerate 13-23 if the source ever ships 24h: treat meridiem as ignored.
    return hour12;
  }
  if (meridiem === "am") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ---------------------------------------------------------------------------
// Recurrence expansion (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Return an array of local-midnight Dates (interpreted in `tz`) starting
 * with the next occurrence of `dayIndex` on/after `localToday`, for up to
 * `horizonDays` calendar days. Today counts if it matches the day-of-week.
 */
export function expandWeekly(
  localToday: { year: number; month: number; day: number },
  dayIndex: DayIndex,
  horizonDays: number,
): Array<{ year: number; month: number; day: number }> {
  const out: Array<{ year: number; month: number; day: number }> = [];
  const start = utcDateFromLocalParts(localToday);
  for (let offset = 0; offset < horizonDays; offset++) {
    const d = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
    if (d.getUTCDay() === dayIndex) {
      out.push({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      });
    }
  }
  return out;
}

/**
 * Convert "local Y-M-D H:M in tz" to a UTC Date by computing the offset
 * Intl reports for that moment and applying it.
 */
export function buildUtcFromLocal(
  localDate: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  tz: string,
): Date | null {
  // First approximation: pretend the local clock is UTC.
  const guess = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    hour,
    minute,
    0,
  );
  // Determine the wall-clock time `guess` corresponds to in `tz`. The delta
  // (in minutes) is the timezone offset we need to subtract to get the
  // correct UTC instant.
  const wallAtGuess = getLocalParts(new Date(guess), tz);
  if (!wallAtGuess) return null;
  const wallGuessUtc = Date.UTC(
    wallAtGuess.year,
    wallAtGuess.month - 1,
    wallAtGuess.day,
    wallAtGuess.hour,
    wallAtGuess.minute,
    0,
  );
  const offsetMs = wallGuessUtc - guess; // tz offset at that instant
  const utc = guess - offsetMs;
  return new Date(utc);
}

function getLocalParts(
  date: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  if (!map.year || !map.month || !map.day || !map.hour || !map.minute) return null;
  const hour = map.hour === "24" ? "00" : map.hour;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(hour, 10),
    minute: parseInt(map.minute, 10),
  };
}

function startOfLocalDay(
  now: Date,
  tz: string,
): { year: number; month: number; day: number } {
  const parts = getLocalParts(now, tz);
  if (!parts) {
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
    };
  }
  return { year: parts.year, month: parts.month, day: parts.day };
}

function utcDateFromLocalParts(p: {
  year: number;
  month: number;
  day: number;
}): Date {
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}
