import * as cheerio from "cheerio";
import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
import { pacificWallTimeToUtc } from "@/lib/funcheap";
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
 * Freight & Salvage (Berkeley) — Tier-3 HTML scraper. **Fragile by design.**
 *
 * Freight is a folk/acoustic/world-music nonprofit. It runs on WordPress +
 * Elementor with Tessitura ticketing, and exposes *no* clean structured data:
 * no Event JSON-LD, no iCal, and the REST API (`/wp-json/wp/v2/tessi_performance`)
 * omits performance datetimes. The one thing that IS server-rendered on
 * `/shows/` is each show card's visible date/time, so we parse the DOM:
 *
 *   <span class="dates">Monday, Jun 15th 2026</span>  (+ heading + ticket link)
 *
 * This couples us to Freight's markup — if they restyle the card, the selectors
 * break (the run then reports a parse error and ingests nothing rather than
 * crashing). Berkeley is also covered by ticketmaster/eventbrite/funcheap, so
 * this is depth, not a single point of failure. First-party site → "official".
 */

const ID = "scrape:freight";
const LISTING_URL = "https://thefreight.org/shows/";
const TZ = "America/Los_Angeles";

const VENUE_NAME = "Freight & Salvage";
const CITY = "Berkeley";
const VENUE_ADDRESS = "2020 Addison St, Berkeley, CA 94704";
const VENUE_LAT = 37.870339;
const VENUE_LNG = -122.268349;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export type ParsedShow = {
  title: string;
  url: string;
  startTimeUtc: Date;
};

/**
 * Combine a Freight date string ("Monday, Jun 15th 2026") and an optional time
 * ("7:00 PM") into a UTC Date in Pacific wall time. Returns null if the date
 * doesn't parse. Missing time defaults to 8pm PT (Freight's typical curtain).
 */
export function parseShowDateTime(
  dateStr: string,
  timeStr: string | null,
): Date | null {
  const d = /([A-Za-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})/.exec(dateStr);
  if (!d) return null;
  const monthIdx = MONTHS[d[1].slice(0, 3).toLowerCase()];
  if (monthIdx == null) return null;
  const day = Number.parseInt(d[2], 10);
  const year = Number.parseInt(d[3], 10);

  let hour = 20;
  let minute = 0;
  if (timeStr) {
    const tm = /(\d{1,2}):(\d{2})\s*([AaPp])[Mm]/.exec(timeStr);
    if (tm) {
      hour = Number.parseInt(tm[1], 10) % 12;
      if (/[Pp]/.test(tm[3])) hour += 12;
      minute = Number.parseInt(tm[2], 10);
    }
  }
  const utc = pacificWallTimeToUtc(year, monthIdx, day, hour, minute);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

/** Freight is overwhelmingly music; nudge obvious workshops/comedy aside. */
export function classifyCategory(title: string): Category {
  const t = title.toLowerCase();
  if (/\bcomedy\b|stand-?up/.test(t)) return "comedy";
  if (/workshop|\bclass\b|songwriting|masterclass|lecture/.test(t)) {
    return "lectures";
  }
  return "music";
}

/**
 * Parse the `/shows/` listing into structured shows. Pure/synchronous so tests
 * can run it against a saved fixture. Walks up from each `span.dates` to the
 * card that carries the show's heading + ticket link.
 */
export function parseShowsHtml(html: string): ParsedShow[] {
  const $ = cheerio.load(html);
  const out: ParsedShow[] = [];
  const seen = new Set<string>();

  $("span.dates").each((_, el) => {
    const dateStr = $(el).text().trim();
    if (!dateStr) return;

    // Walk up to the card holding a heading + a ticket/detail link.
    let title = "";
    let url = "";
    let cardText = "";
    let node = $(el);
    for (let i = 0; i < 6 && node.length; i++) {
      node = node.parent();
      const heading = node
        .find("h1,h2,h3,h4,h5,.elementor-heading-title")
        .first()
        .text()
        .trim();
      if (heading && !title) title = heading;
      const href = node
        .find("a[href]")
        .filter((_i, a) =>
          /secure\.thefreight\.org|\/productions\//.test(
            $(a).attr("href") ?? "",
          ),
        )
        .first()
        .attr("href");
      if (href && !url) url = href;
      if (title && url) {
        cardText = node.text().replace(/\s+/g, " ");
        break;
      }
    }
    if (!title || !url) return;

    const timeMatch = cardText.match(/(\d{1,2}:\d{2}\s*[AaPp][Mm])/);
    const start = parseShowDateTime(dateStr, timeMatch ? timeMatch[1] : null);
    if (!start) return;

    const key = `${url}|${start.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, url, startTimeUtc: start });
  });

  return out;
}

function buildRawEvent(show: ParsedShow, fetchedAt: Date): RawEvent {
  return {
    identity: {
      source: ID,
      externalId: `${show.url}|${show.startTimeUtc.toISOString()}`,
      sourceUrl: show.url,
    },
    title: show.title,
    description: null,
    startTimeUtc: show.startTimeUtc,
    endTimeUtc: null,
    timezone: TZ,
    venue: {
      name: VENUE_NAME,
      city: CITY,
      neighborhood: "Downtown Berkeley",
      address: VENUE_ADDRESS,
      lat: VENUE_LAT,
      lng: VENUE_LNG,
      timezone: TZ,
    },
    primaryCategory: classifyCategory(show.title),
    // Listing doesn't carry price → canonical "price varies".
    pricing: { priceMin: null, priceMax: null, isFree: false },
    recurrence: null,
    verificationLevel: "official",
    rawPayload: { title: show.title, url: show.url },
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
      const shows = parseShowsHtml(html);
      if (shows.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message: `no shows parsed from ${LISTING_URL} — Freight likely changed its markup`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }
      for (const show of shows) {
        try {
          events.push(buildRawEvent(show, fetchedAt));
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
