import * as cheerio from "cheerio";
import { fetchHtml } from "@/lib/scrape";
import { fingerprint } from "@/lib/identity";
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
 * Funcheap SF — Food/Eating-and-Drinking category — Tier-3 scraper.
 *
 * Method: HTML listing parse only. Funcheap renders the full
 * Eating-and-Drinking archive as a single WordPress category page where each
 * event item carries a structured `.meta.archive-meta.date-time` block with
 * `data-event-date`/`data-event-date-end` attributes in Pacific local wall
 * time (`YYYY-MM-DD HH:MM`). The title, post URL, cost text, and venue label
 * are all in the same item DOM, so a single listing fetch yields every event
 * we need — no detail-page traversal required (satisfies B3: 1 HTTP request
 * per run).
 *
 * The task spec names the path `sf.funcheap.com/category/food`, but that
 * slug 404s. The site's actual category permalink for food is
 * `/category/event/event-types/eating-drinking/`, discovered via the
 * Funcheap category widget on its event index pages.
 *
 * Funcheap is an editorial aggregator ("Free & Cheap Things to Do in San
 * Francisco"), so verificationLevel is `community`. Cost text is human-edited
 * and uses "FREE" or a single `$X` figure; we map FREE → isFree: true and a
 * dollar figure → `priceMin = priceMax = X`. When the cost cell is missing or
 * unparseable we fall back to `priceMin = 0` (advertised as "free or cheap")
 * to satisfy D2 (non-null pricing OR isFree).
 *
 * Robots.txt: `Disallow: /search/`, `/*?s=`, `/*?search=`. The eating-and-
 * drinking archive permalink is not under any Disallow rule — scraping is
 * permitted (B2).
 *
 * Venue display name comes from the item's `<span>` tail in the meta block;
 * neighborhood is unknown per-row, so we leave it null and let the persister
 * resolve from venue master data when available.
 */

const ID = "scrape:funcheapfood";
const LISTING_URL =
  "https://sf.funcheap.com/category/event/event-types/eating-drinking/";
const TZ = "America/Los_Angeles";
const CATEGORY: Category = "food";

// Hard cap on events emitted from one run. Funcheap renders ~30 entries
// per archive page; this cap keeps memory bounded if the page ever
// expands.
const MAX_EVENTS = 100;

type ParsedListingItem = {
  postId: string;
  title: string;
  url: string;
  startLocal: string; // "YYYY-MM-DD HH:MM" in Pacific wall time
  endLocal: string | null;
  costText: string | null;
  venueName: string | null;
};

/**
 * Convert a Pacific-local wall time to a UTC Date. Mirrors the helper in
 * `sources/sfcomedycollege.ts` — kept local rather than imported so adapters
 * stay decoupled (Stream A rule: no cross-adapter imports).
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

/**
 * Parse `"YYYY-MM-DD HH:MM"` (Pacific wall time) into a UTC Date.
 * Returns null when the string doesn't match the expected shape.
 */
export function parsePacificWallString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const year = Number.parseInt(y, 10);
  const monthIdx = Number.parseInt(mo, 10) - 1;
  const day = Number.parseInt(d, 10);
  const hour = Number.parseInt(h, 10);
  const minute = Number.parseInt(mi, 10);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  const utc = pacificWallTimeToUtc(year, monthIdx, day, hour, minute);
  if (Number.isNaN(utc.getTime())) return null;
  return utc;
}

/**
 * Map Funcheap cost cells to structured PriceInfo. Funcheap's editorial
 * convention is either "FREE*" or "$N*" (occasionally a decimal "$44.99*").
 * Free events get `isFree: true`; dollar figures collapse to
 * `priceMin = priceMax = N`. Anything else falls back to a $0 floor so D2
 * still passes.
 */
export function parseCost(raw: string | null): PriceInfo {
  if (!raw) {
    return { priceMin: 0, priceMax: null, isFree: false };
  }
  const text = raw.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^FREE\b/.test(text) || text === "FREE") {
    return { priceMin: null, priceMax: null, isFree: true };
  }
  // Single dollar amount, e.g. "$12", "$44.99". Funcheap uses one figure.
  const dollar = /\$\s*(\d+(?:\.\d+)?)/.exec(text);
  if (dollar) {
    const n = Number.parseFloat(dollar[1]);
    if (Number.isFinite(n) && n >= 0) {
      // Round to nearest cent to avoid float-noise in the canonical row.
      const cents = Math.round(n * 100) / 100;
      return { priceMin: cents, priceMax: cents, isFree: cents === 0 };
    }
  }
  // Unparseable cost — keep ingest unblocked with a $0 floor (Funcheap is
  // a "free or cheap" aggregator, so $0 is a safe lower bound).
  return { priceMin: 0, priceMax: null, isFree: false };
}

/**
 * Parse the saved listing HTML into structured per-event records. Pure /
 * synchronous so tests can hit it against the fixture without IO.
 */
export function parseListingHtml(html: string): ParsedListingItem[] {
  const $ = cheerio.load(html);
  const items: ParsedListingItem[] = [];

  $("div.tanbox[id^='post-']").each((_, el) => {
    const $post = $(el);
    const postId = ($post.attr("id") ?? "").replace(/^post-/, "");
    if (!postId) return;

    const $title = $post.find("span.title.entry-title a").first();
    const title = $title.text().trim();
    const url = ($title.attr("href") ?? "").trim();
    if (!title || !url) return;

    const $meta = $post.find("div.meta.archive-meta.date-time").first();
    if ($meta.length === 0) return;

    const startLocal = ($meta.attr("data-event-date") ?? "").trim();
    if (!startLocal) return;
    const endLocal = ($meta.attr("data-event-date-end") ?? "").trim() || null;

    const costText = $meta.find("a.tt").first().text().replace(/\*/g, "").trim()
      || null;

    // Venue: the trailing `<span>...</span>` inside the meta block (the one
    // not bearing a known class). Falls back to null when absent.
    let venueName: string | null = null;
    $meta.find("span").each((_, s) => {
      const $s = $(s);
      const cls = $s.attr("class") ?? "";
      if (cls.includes("fc-event") || cls === "cost") return;
      const t = $s.text().trim();
      if (t && t.length > 1 && !/^cost:?$/i.test(t)) {
        venueName = t;
      }
    });

    items.push({
      postId,
      title,
      url,
      startLocal,
      endLocal,
      costText,
      venueName,
    });
  });

  return items;
}

/**
 * Lift one parsed item into a RawEvent. Returns null when required identity
 * fields (start time, URL, title) cannot be derived.
 */
export function buildRawEvent(
  item: ParsedListingItem,
  fetchedAt: Date,
): RawEvent | null {
  const startTimeUtc = parsePacificWallString(item.startLocal);
  if (!startTimeUtc) return null;

  const endTimeUtc = item.endLocal
    ? parsePacificWallString(item.endLocal)
    : null;

  // Venue display: prefer the per-row span, else use the title as a soft
  // fallback so canonical-fingerprint inputs are non-empty. Many Funcheap
  // entries already embed the venue in the title.
  const venueName = item.venueName ?? item.title;

  const pricing = parseCost(item.costText);

  return {
    identity: {
      source: ID,
      externalId: item.postId,
      sourceUrl: item.url,
    },
    title: item.title,
    description: null,
    startTimeUtc,
    endTimeUtc,
    timezone: TZ,
    venue: {
      name: venueName,
      neighborhood: null,
      address: null,
      lat: null,
      lng: null,
      timezone: TZ,
    },
    primaryCategory: CATEGORY,
    pricing,
    recurrence: null,
    verificationLevel: "community",
    rawPayload: {
      postId: item.postId,
      title: item.title,
      url: item.url,
      startLocal: item.startLocal,
      endLocal: item.endLocal,
      costText: item.costText,
      venueName: item.venueName,
    },
    fetchedAt,
  };
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "community",

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
          message: `no event items matched on ${LISTING_URL} — page format may have changed`,
          retryable: false,
          occurredAt: new Date(),
        });
        return { events, errors, fetchedAt };
      }

      const seen = new Set<string>();
      for (const item of items.slice(0, MAX_EVENTS)) {
        try {
          const ev = buildRawEvent(item, fetchedAt);
          if (!ev) continue;
          if (seen.has(ev.identity.externalId)) continue;
          seen.add(ev.identity.externalId);
          events.push(ev);
        } catch (err) {
          errors.push({
            source: ID,
            externalId: item.postId,
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
