import * as cheerio from "cheerio";
import type { PriceInfo } from "@/lib/sources/types";

/**
 * Shared parsing for Funcheap WordPress listing pages. Funcheap runs one theme
 * across its feeds (event-types like `eating-drinking`, event-locations like
 * `east-bay`), so the same `div.tanbox` + `archive-meta` markup drives every
 * adapter. Kept here so the food and East Bay adapters don't duplicate it.
 *
 * Pure + synchronous: testable against saved fixtures with no IO.
 */

const TZ = "America/Los_Angeles";

export type ParsedListingItem = {
  postId: string;
  title: string;
  url: string;
  startLocal: string; // "YYYY-MM-DD HH:MM" in Pacific wall time
  endLocal: string | null;
  costText: string | null;
  venueName: string | null;
};

/** Convert a Pacific-local wall time to a UTC Date (DST-aware). */
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

/** Parse `"YYYY-MM-DD HH:MM"` (Pacific wall time) into a UTC Date, or null. */
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
 * Map a Funcheap cost cell to structured PriceInfo. "FREE" → isFree; a single
 * `$N` figure → priceMin = priceMax = N; anything else → a $0 floor (Funcheap
 * is a "free or cheap" aggregator).
 */
export function parseCost(raw: string | null): PriceInfo {
  if (!raw) {
    return { priceMin: 0, priceMax: null, isFree: false };
  }
  const text = raw.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^FREE\b/.test(text) || text === "FREE") {
    return { priceMin: null, priceMax: null, isFree: true };
  }
  const dollar = /\$\s*(\d+(?:\.\d+)?)/.exec(text);
  if (dollar) {
    const n = Number.parseFloat(dollar[1]);
    if (Number.isFinite(n) && n >= 0) {
      const cents = Math.round(n * 100) / 100;
      return { priceMin: cents, priceMax: cents, isFree: cents === 0 };
    }
  }
  return { priceMin: 0, priceMax: null, isFree: false };
}

/**
 * Parse Funcheap listing HTML into structured per-event records. Pure /
 * synchronous so tests can hit it against a fixture without IO.
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

    const costText =
      $meta.find("a.tt").first().text().replace(/\*/g, "").trim() || null;

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

    items.push({ postId, title, url, startLocal, endLocal, costText, venueName });
  });

  return items;
}
