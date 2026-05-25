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
 * Dance Mission Theater — Tier-3 scraper.
 *
 * Source: dancemissiontheater.org (dancemission.com redirects here).
 *
 * Approach: the site exposes a public WordPress REST API. We query the
 * "upcoming-events" category (id 86) in a single network call and parse the
 * post title for the human-formatted date prefix (e.g. "June 14:",
 * "May 22-24:"). Times and prices live in the post body — extracted with
 * regex with safe defaults when absent.
 *
 * This is a single listing-page fetch per ingest (B3): the WP API returns
 * id, link, title, excerpt, and rendered content for every post in one
 * response, so no per-event detail-page fetches are needed.
 *
 * We considered scraping /shows-and-events/ HTML directly (saved as a fixture
 * for reference). The JSON API is preferred because:
 *   - The listing page renders cards but the time/price info lives only on
 *     the detail pages — JSON gives us rendered post content inline.
 *   - JSON is structurally stable across WordPress theme changes.
 *   - One call, ~100KB, vs N detail-page fetches.
 *
 * Robots.txt: dancemissiontheater.org disallows only /wp-admin/, allows the
 * REST API path. Crawl-delay not specified. Single request per ingest is well
 * under any reasonable rate limit.
 */

const ID = "scrape:dancemission";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Dance Mission Theater";
const VENUE_ADDRESS = "3316 24th St, San Francisco, CA 94110";
const NEIGHBORHOOD = "Mission";

const LISTING_URL = "https://dancemissiontheater.org/shows-and-events/";
const API_URL =
  "https://dancemissiontheater.org/wp-json/wp/v2/posts" +
  "?categories=86&per_page=20" +
  "&_fields=id,date,link,title,excerpt,content";

const USER_AGENT =
  "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)";

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

type WpPost = {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  excerpt?: { rendered: string };
  content?: { rendered: string };
};

/**
 * Strip HTML tags and decode the most common HTML entities to plain text.
 */
function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#8220;|&#8221;|&#8243;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8216;|&#8217;|&#8242;|&lsquo;|&rsquo;|&apos;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the human-formatted date prefix that DMT post titles always start
 * with: "June 14:", "May 22-24:", "May 1-May 3:", "March 21-22, 2026:".
 * Returns the (1-indexed) first and last day-of-month, the month index,
 * an optional explicit year, the remaining title text after the colon,
 * and an end-month for cross-month ranges.
 */
type TitleDate = {
  startDay: number;
  endDay: number;
  startMonth: number;
  endMonth: number;
  explicitYear: number | null;
  displayTitle: string;
};

export function parseTitleDate(rawTitle: string): TitleDate | null {
  const title = htmlToText(rawTitle);

  // Match "<Month> <D>[-<D>|-<Month> <D>][, YYYY]: <rest>"
  const re =
    /^([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–—]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?(?:,\s*(\d{4}))?\s*:\s*(.+)$/;
  const m = title.match(re);
  if (!m) return null;

  const startMonth = MONTHS[m[1].toLowerCase()];
  if (startMonth === undefined) return null;

  const startDay = parseInt(m[2], 10);
  const endMonth =
    m[3] !== undefined ? MONTHS[m[3].toLowerCase()] ?? startMonth : startMonth;
  const endDay = m[4] !== undefined ? parseInt(m[4], 10) : startDay;
  const explicitYear = m[5] !== undefined ? parseInt(m[5], 10) : null;
  const displayTitle = m[6].trim();

  if (Number.isNaN(startDay) || startDay < 1 || startDay > 31) return null;
  if (Number.isNaN(endDay) || endDay < 1 || endDay > 31) return null;

  return {
    startDay,
    endDay,
    startMonth,
    endMonth,
    explicitYear,
    displayTitle,
  };
}

/**
 * Resolve which calendar year the event falls in. If the title carries an
 * explicit year, trust it. Otherwise pick the year so that the event start
 * date is on or after the post publication date — if the event month is
 * before the publication month, roll to the following year.
 */
export function resolveEventYear(
  titleDate: TitleDate,
  postPublishedAt: Date,
): number {
  if (titleDate.explicitYear !== null) return titleDate.explicitYear;
  const pubYear = postPublishedAt.getUTCFullYear();
  const pubMonth = postPublishedAt.getUTCMonth();
  // Allow a small backwards tolerance (event published a few days after start)
  if (titleDate.startMonth < pubMonth - 1) return pubYear + 1;
  return pubYear;
}

/**
 * Extract the first "<hour>[:mm]<am|pm>" time from body text and return
 * { hour: 0-23, minute: 0-59 }. Returns null if no time found.
 */
export function extractFirstTime(
  body: string,
): { hour: number; minute: number } | null {
  const m = body.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
  const ap = m[3].toLowerCase();
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;
  if (ap === "am") {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }
  return { hour, minute };
}

/**
 * Find structured pricing hints in the body text.
 *
 * Patterns handled:
 *   - "Free" / "free admission" / "no charge"           → isFree: true
 *   - "$30-300", "$25-$45"                              → priceMin, priceMax
 *   - "$200/person", "$45", "$30 suggested"             → priceMin = priceMax
 *   - "donation", "sliding scale", "pay what you can"   → unknown but not free
 *   - nothing matches                                   → unknown but not free
 *
 * D2 (master rubric) requires that scraped rows have either priceMin/Max
 * populated OR is_free=true. We can only honor that when the body actually
 * states a price — when it doesn't, we leave the structured price unset and
 * flag isFree=false so the persister knows we made a positive determination
 * that "this is not a free event" (DMT performances generally aren't).
 */
export function extractPricing(body: string): PriceInfo {
  const lower = body.toLowerCase();

  // Free check (specific phrases — avoid matching "free spirit" / "free will")
  if (
    /\bfree admission\b/.test(lower) ||
    /\bno charge\b/.test(lower) ||
    /\bfree event\b/.test(lower) ||
    /\bfree to attend\b/.test(lower) ||
    /\bfree and open\b/.test(lower)
  ) {
    return { priceMin: null, priceMax: null, isFree: true };
  }

  // Range: $30-300, $25-$45, $30 - $50
  const range = body.match(/\$(\d{1,4})(?:\.\d{2})?\s*[-–—]\s*\$?(\d{1,4})(?:\.\d{2})?/);
  if (range) {
    const lo = parseInt(range[1], 10);
    const hi = parseInt(range[2], 10);
    if (!Number.isNaN(lo) && !Number.isNaN(hi) && lo <= hi && hi < 10000) {
      return { priceMin: lo, priceMax: hi, isFree: false };
    }
  }

  // Single price: $45, $200/person, $30 suggested
  const single = body.match(/\$(\d{1,4})(?:\.\d{2})?/);
  if (single) {
    const v = parseInt(single[1], 10);
    if (!Number.isNaN(v) && v < 10000) {
      return { priceMin: v, priceMax: v, isFree: false };
    }
  }

  // No structured price found — leave unknown but explicitly not free.
  return { priceMin: null, priceMax: null, isFree: false };
}

/**
 * Build a UTC Date for a given local-time wall clock in America/Los_Angeles.
 * We compute the timezone offset for that wall clock and subtract it from
 * the naive UTC timestamp — handles DST automatically.
 */
function pacificWallClockToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, monthIndex, day, hour, minute, 0, 0);
  // Inspect what time that naive UTC instant *looks like* in Los Angeles.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(naive));
  const parts: Record<string, string> = {};
  for (const p of fmt) if (p.type !== "literal") parts[p.type] = p.value;
  const seenUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parts.hour === "24" ? 0 : parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    0,
    0,
  );
  const offsetMs = seenUtc - naive;
  return new Date(naive - offsetMs);
}

/**
 * Build a RawEvent from a single WordPress post. Returns null if the post
 * title doesn't carry a parseable date prefix (every DMT upcoming post does
 * — but be defensive).
 */
export function buildRawEvent(post: WpPost, fetchedAt: Date): RawEvent | null {
  const titleDate = parseTitleDate(post.title.rendered);
  if (!titleDate) return null;

  const postPublishedAt = new Date(post.date + "Z");
  const year = resolveEventYear(titleDate, postPublishedAt);

  const bodyText = htmlToText(
    (post.content?.rendered ?? "") + " " + (post.excerpt?.rendered ?? ""),
  );

  const time = extractFirstTime(bodyText) ?? { hour: 19, minute: 0 };
  const pricing = extractPricing(bodyText);

  const startTimeUtc = pacificWallClockToUtc(
    year,
    titleDate.startMonth,
    titleDate.startDay,
    time.hour,
    time.minute,
  );

  // For multi-day runs, mark end as the last day at 22:00 local
  // (best-effort; the daily granularity is the structurally honest part).
  let endTimeUtc: Date | null = null;
  const isRange =
    titleDate.startMonth !== titleDate.endMonth ||
    titleDate.startDay !== titleDate.endDay;
  if (isRange) {
    // If the end-month rolls back (e.g. Dec 30 - Jan 2), bump year.
    const endYear =
      titleDate.endMonth < titleDate.startMonth ? year + 1 : year;
    endTimeUtc = pacificWallClockToUtc(
      endYear,
      titleDate.endMonth,
      titleDate.endDay,
      22,
      0,
    );
  } else {
    // Single-day event: end roughly two hours after start (typical run-time).
    endTimeUtc = new Date(startTimeUtc.getTime() + 2 * 60 * 60 * 1000);
  }

  const externalId = `dmt-${post.id}`;

  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: post.link,
    },
    title: titleDate.displayTitle,
    description: bodyText.slice(0, 4000) || null,
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      neighborhood: NEIGHBORHOOD,
      address: VENUE_ADDRESS,
      lat: null,
      lng: null,
      timezone: TZ,
    },
    primaryCategory: "dancing",
    pricing,
    recurrence: null,
    verificationLevel: "official",
    rawPayload: {
      id: post.id,
      link: post.link,
      title: post.title.rendered,
      date: post.date,
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const resp = await globalThis.fetch(API_URL, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(
          `HTTP ${resp.status} fetching ${API_URL}` +
            (resp.status === 403 || resp.status === 503
              ? " (possible anti-bot block — HUMAN-REVIEW-NEEDED)"
              : ""),
        );
      }
      const payload = (await resp.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error(
          `expected JSON array from ${API_URL}, got ${typeof payload}`,
        );
      }

      for (const item of payload) {
        try {
          const post = item as WpPost;
          if (
            !post ||
            typeof post.id !== "number" ||
            typeof post.link !== "string" ||
            typeof post.title?.rendered !== "string"
          ) {
            continue;
          }
          const raw = buildRawEvent(post, fetchedAt);
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
      }
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
    } finally {
      clearTimeout(timeout);
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

export { LISTING_URL };
export default adapter;
