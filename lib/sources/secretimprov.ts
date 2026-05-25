import { fetchHtml, filterEventNodes, parseJsonLd } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
  VenueCandidate,
} from "./types";

/**
 * Secret Improv Society — long-running short-form improv comedy show at the
 * Shelton Theater (533 Sutter Street, downtown SF). Tickets are sold via
 * SimpleTix; the secretimprov.com site itself is a GoDaddy builder page with
 * no event data.
 *
 * Strategy:
 *   1. Hit the SimpleTix storefront (one fetch) to enumerate event detail URLs.
 *      Filter out multi-week classes ("Foundations Program", "Characters
 *      Program") whose pricing and shape don't match a comedy show.
 *   2. For each show (capped at the 20-detail budget from rubric B3), fetch
 *      the detail page and parse:
 *        - <script type="application/ld+json"> for canonical metadata
 *          (title, description, price, venue, lat/lng)
 *        - the inline `var timeArray = [...]` for individual occurrence
 *          dates+times. The JSON-LD startDate/endDate covers the whole run,
 *          not individual shows; the timeArray is the per-occurrence list.
 *   3. Emit one RawEvent per occurrence, with seriesId = SimpleTix event id
 *      and occurrenceId = SimpleTix time id, so cross-source dedup remains
 *      stable at the canonicalFingerprint level (title|venue|local minute).
 */

const ID = "scrape:secretimprov";
const LISTING_URL = "https://secretimprov.simpletix.com/";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "Shelton Theater";
const VENUE_NEIGHBORHOOD = "Union Square";
const VENUE_ADDRESS = "533 Sutter Street, San Francisco, CA 94102";
const VENUE_LAT = 37.78895568847656;
const VENUE_LNG = -122.40911865234375;
const DETAIL_FETCH_CAP = 20; // rubric B3

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    let detailUrls: string[] = [];
    try {
      const { $ } = await fetchHtml(LISTING_URL);
      const seen = new Set<string>();
      $("#showlist .list-box a.links").each((_, el) => {
        const href = $(el).attr("href");
        const title = ($(el).attr("title") ?? "").trim();
        // Filter out multi-week classes; only ticketed shows belong in comedy.
        if (/\bprogram\b/i.test(title)) return;
        if (!href) return;
        let abs: string;
        try {
          abs = new URL(href, LISTING_URL).toString();
        } catch {
          return;
        }
        if (!/simpletix\.com\/e\//.test(abs)) return;
        if (seen.has(abs)) return;
        seen.add(abs);
        detailUrls.push(abs);
      });
    } catch (err) {
      errors.push({
        source: ID,
        stage: "fetch",
        message:
          err instanceof Error
            ? `listing fetch failed: ${err.message}`
            : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
      return { events, errors, fetchedAt };
    }

    if (detailUrls.length > DETAIL_FETCH_CAP) {
      detailUrls = detailUrls.slice(0, DETAIL_FETCH_CAP);
    }

    for (const url of detailUrls) {
      try {
        const { $, html } = await fetchHtml(url);
        const ld = filterEventNodes(parseJsonLd($))[0];
        if (!ld) {
          errors.push({
            source: ID,
            externalId: url,
            stage: "parse",
            message: `no JSON-LD Event node at ${url}`,
            retryable: false,
            occurredAt: new Date(),
          });
          continue;
        }

        const title = typeof ld.name === "string" ? ld.name.trim() : "";
        if (!title) {
          errors.push({
            source: ID,
            externalId: url,
            stage: "parse",
            message: `JSON-LD missing name at ${url}`,
            retryable: false,
            occurredAt: new Date(),
          });
          continue;
        }
        const description = stripHtml(
          typeof ld.description === "string" ? ld.description : null,
        );
        const sourceUrl = typeof ld.url === "string" ? ld.url : url;

        const pricing = extractPricing(ld);
        const venue = extractVenue(ld);
        const seriesId = extractSeriesId(url);

        const occurrences = extractTimeArray(html);
        if (occurrences.length === 0) {
          // Fall back to JSON-LD start/end if no per-occurrence list — only
          // emit if the start looks like a single show window (< 6h), not a
          // multi-month run.
          const start = parseIsoDate(
            typeof ld.startDate === "string" ? ld.startDate : null,
          );
          const end = parseIsoDate(
            typeof ld.endDate === "string" ? ld.endDate : null,
          );
          if (start && end && end.getTime() - start.getTime() < 6 * 3600 * 1000) {
            events.push(
              buildRawEvent({
                title,
                description,
                sourceUrl,
                start,
                end,
                pricing,
                venue,
                seriesId,
                occurrenceId: `${seriesId}-single`,
                fetchedAt,
              }),
            );
          } else {
            errors.push({
              source: ID,
              externalId: url,
              stage: "parse",
              message: `no per-occurrence timeArray found and JSON-LD startDate/endDate spans more than 6h (looks like a series window, not a single show)`,
              retryable: false,
              occurredAt: new Date(),
            });
          }
          continue;
        }

        for (const occ of occurrences) {
          if (occ.start < fetchedAt) continue; // drop past shows
          events.push(
            buildRawEvent({
              title,
              description,
              sourceUrl,
              start: occ.start,
              end: occ.end,
              pricing,
              venue,
              seriesId,
              occurrenceId: String(occ.id),
              fetchedAt,
            }),
          );
        }
      } catch (err) {
        errors.push({
          source: ID,
          externalId: url,
          stage: "fetch",
          message:
            err instanceof Error
              ? `detail fetch failed: ${err.message}`
              : String(err),
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

// --- helpers ---------------------------------------------------------------

type Occurrence = { id: string; start: Date; end: Date | null };

function buildRawEvent(input: {
  title: string;
  description: string | null;
  sourceUrl: string;
  start: Date;
  end: Date | null;
  pricing: { priceMin: number | null; priceMax: number | null; isFree: boolean };
  venue: VenueCandidate;
  seriesId: string;
  occurrenceId: string;
  fetchedAt: Date;
}): RawEvent {
  const externalId = `${input.seriesId}#${input.occurrenceId}`;
  return {
    identity: {
      source: ID,
      externalId,
      sourceUrl: input.sourceUrl,
    },
    title: input.title,
    description: input.description,
    startTimeUtc: input.start,
    endTimeUtc: input.end,
    timezone: TZ,
    venue: input.venue,
    primaryCategory: "comedy",
    pricing: input.pricing,
    recurrence: {
      seriesId: input.seriesId,
      occurrenceId: input.occurrenceId,
    },
    verificationLevel: "official",
    rawPayload: { seriesId: input.seriesId, occurrenceId: input.occurrenceId },
    fetchedAt: input.fetchedAt,
  };
}

/**
 * The SimpleTix detail page embeds a JS array of per-occurrence shows:
 *   var timeArray = [{"Id":1337005,"Time":"Sat, Dec 20, 2025 8:00 PM - 9:30 PM"}, ...];
 *
 * Parse via balanced-bracket scan; never `eval()`. Returns occurrences in
 * (id, start, end) form. Failing time parses are silently dropped so a
 * single malformed entry doesn't poison the rest of the series.
 *
 * Exported for unit tests; not part of the SourceAdapter contract.
 */
export function extractTimeArray(html: string): Occurrence[] {
  const marker = "var timeArray";
  const i = html.indexOf(marker);
  if (i < 0) return [];
  const eq = html.indexOf("=", i);
  if (eq < 0) return [];
  const start = html.indexOf("[", eq);
  if (start < 0) return [];
  let depth = 0;
  let end = -1;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end < 0) return [];
  const raw = html.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Occurrence[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = e.Id ?? e.id;
    const timeStr = typeof e.Time === "string" ? e.Time : null;
    if (id === undefined || id === null || !timeStr) continue;
    const parsedTime = parseSimpleTixTime(timeStr);
    if (!parsedTime) continue;
    out.push({
      id: String(id),
      start: parsedTime.start,
      end: parsedTime.end,
    });
  }
  return out;
}

/**
 * Parse SimpleTix's display time format, interpreted in America/Los_Angeles:
 *   "Sat, Dec 20, 2025 8:00 PM - 9:30 PM"   (range)
 *   "Sat, Dec 20, 2025 8:00 PM"             (no end)
 *
 * Returns UTC Date objects. We can't use Date.parse — it would assume the
 * runner's local timezone. Build the PT offset manually so behavior is
 * identical in CI, dev, and prod.
 *
 * Exported for unit tests.
 */
export function parseSimpleTixTime(
  s: string,
): { start: Date; end: Date | null } | null {
  // Strip leading weekday + comma if present.
  const cleaned = s.replace(/^[A-Za-z]{3},\s*/, "").trim();
  // Match: "Mon DD, YYYY HH:MM AM/PM" optionally followed by " - HH:MM AM/PM"
  const re =
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM))?$/;
  const m = re.exec(cleaned);
  if (!m) return null;
  const [, monStr, dayStr, yrStr, h1, mi1, ap1, h2, mi2, ap2] = m;
  const month = MONTHS[monStr];
  if (month === undefined) return null;
  const year = Number(yrStr);
  const day = Number(dayStr);
  const start = ptWallTimeToUtc(year, month, day, to24h(h1, ap1), Number(mi1));
  if (!start) return null;
  let end: Date | null = null;
  if (h2 && mi2 && ap2) {
    let endDate = ptWallTimeToUtc(
      year,
      month,
      day,
      to24h(h2, ap2),
      Number(mi2),
    );
    if (endDate && endDate.getTime() < start.getTime()) {
      // Crossed midnight — bump end by 24h.
      endDate = new Date(endDate.getTime() + 24 * 3600 * 1000);
    }
    end = endDate;
  }
  return { start, end };
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function to24h(hourStr: string, ampm: string): number {
  let h = Number(hourStr) % 12;
  if (/PM/i.test(ampm)) h += 12;
  return h;
}

/**
 * Convert a wall-clock time in America/Los_Angeles to a UTC Date.
 *
 * Approach: build a UTC date as if the input were UTC, then compute the
 * actual PT offset for that instant via Intl, and shift. Robust across DST
 * transitions because we re-check the offset after the initial guess.
 */
function ptWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  const guessUtcMs = Date.UTC(year, month, day, hour, minute);
  if (!Number.isFinite(guessUtcMs)) return null;
  const offsetMs = ptOffsetMs(new Date(guessUtcMs));
  // wall = utc + offset (offset is negative west of UTC).
  // utc = wall - offset; here our "guessUtc" treats wall as utc, so subtract.
  const utc1 = guessUtcMs - offsetMs;
  // DST guard: re-check offset at the corrected instant.
  const offset2 = ptOffsetMs(new Date(utc1));
  if (offset2 !== offsetMs) {
    return new Date(guessUtcMs - offset2);
  }
  return new Date(utc1);
}

function ptOffsetMs(at: Date): number {
  // Get the wall time PT sees at this UTC instant; difference vs UTC = offset.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const wallUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "00" : map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return wallUtcMs - at.getTime();
}

function extractPricing(ld: Record<string, unknown>): {
  priceMin: number | null;
  priceMax: number | null;
  isFree: boolean;
} {
  const offers = ld.offers;
  let min: number | null = null;
  let max: number | null = null;
  const visit = (o: Record<string, unknown>) => {
    const lo = numOrNull(o.lowPrice);
    const hi = numOrNull(o.highPrice);
    const p = numOrNull(o.price);
    const candidates = [lo, hi, p].filter((n): n is number => n !== null);
    for (const v of candidates) {
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
  };
  if (Array.isArray(offers)) {
    for (const o of offers) {
      if (o && typeof o === "object") visit(o as Record<string, unknown>);
    }
  } else if (offers && typeof offers === "object") {
    visit(offers as Record<string, unknown>);
  }
  const isFree = min === 0 && (max === 0 || max === null);
  return {
    priceMin: min,
    priceMax: max,
    isFree,
  };
}

function extractVenue(ld: Record<string, unknown>): VenueCandidate {
  const loc = ld.location;
  if (!loc || typeof loc !== "object") {
    return {
      name: VENUE_NAME,
      neighborhood: VENUE_NEIGHBORHOOD,
      address: VENUE_ADDRESS,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    };
  }
  const l = loc as Record<string, unknown>;
  const name = typeof l.name === "string" ? l.name.trim() : VENUE_NAME;
  let address: string | null = null;
  if (l.address && typeof l.address === "object") {
    const a = l.address as Record<string, unknown>;
    const parts = [
      typeof a.streetAddress === "string" ? a.streetAddress : null,
      typeof a.addressLocality === "string" ? a.addressLocality : null,
      typeof a.addressRegion === "string" ? a.addressRegion : null,
      typeof a.postalCode === "string" ? a.postalCode : null,
    ].filter((p): p is string => Boolean(p && p.trim()));
    if (parts.length > 0) address = parts.join(", ");
  }
  let lat: number | null = VENUE_LAT;
  let lng: number | null = VENUE_LNG;
  if (l.geo && typeof l.geo === "object") {
    const g = l.geo as Record<string, unknown>;
    // SimpleTix uses "Latitude"/"Longitude" (capitalized, non-standard).
    const latVal = numOrNull(g.latitude) ?? numOrNull(g.Latitude);
    const lngVal = numOrNull(g.longitude) ?? numOrNull(g.Longitude);
    if (latVal !== null) lat = latVal;
    if (lngVal !== null) lng = lngVal;
  }
  return {
    name,
    neighborhood: VENUE_NEIGHBORHOOD,
    address: address ?? VENUE_ADDRESS,
    lat,
    lng,
    timezone: TZ,
  };
}

function extractSeriesId(url: string): string {
  // URLs look like https://www.simpletix.com/e/secret-improv-society-tickets-250887
  const m = /\/e\/([^/?#]+)/.exec(url);
  return m ? m[1] : url;
}

function parseIsoDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stripHtml(s: string | null): string | null {
  if (!s) return null;
  // Strip tags and decode the small handful of named entities SimpleTix emits.
  const text = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&mdash;/gi, "—")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 4000) : null;
}
