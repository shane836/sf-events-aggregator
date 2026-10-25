import * as cheerio from "cheerio";
import { fingerprint } from "@/lib/identity";
import type { Category, FetchResult, NormalizedEvent, Provenance, RawEvent, SourceAdapter, SourceError } from "./types";

// Public Tessitura calendar used by secure.thefreight.org/events. The WordPress
// /shows/ page returns 403 to ingestion runners; this is a separately published,
// unauthenticated first-party listing, with explicit performance IDs and UTC dates.
const ID = "scrape:freight";
const LISTING_URL = "https://secure.thefreight.org/api/products/productionseasons";
const TZ = "America/Los_Angeles";

export function classifyCategory(title: string): Category {
  if (/\bcomedy\b|stand-?up/i.test(title)) return "comedy";
  if (/workshop|\bclass\b|songwriting|masterclass|lecture/i.test(title)) return "lectures";
  return "music";
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected calendar object");
  return value as Record<string, unknown>;
}

const adapter: SourceAdapter = {
  id: ID, tier: "scrape", verificationLevel: "official",
  async fetch(): Promise<FetchResult> {
    const fetchedAt = new Date();
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const report = (error: unknown, stage: "fetch" | "parse") => {
      errors.push({ source: ID, stage, message: error instanceof Error ? error.message : String(error), retryable: stage === "fetch", occurredAt: new Date() });
    };
    let body: unknown;
    try {
      const end = new Date(fetchedAt);
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      const response = await fetch(LISTING_URL, {
        method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "User-Agent": "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)" },
        body: JSON.stringify({ startDate: fetchedAt.toISOString(), endDate: end.toISOString(), productionSeasonIdFilter: [], keywordIds: null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${LISTING_URL}`);
      body = await response.json();
    } catch (error) {
      report(error, error instanceof SyntaxError ? "parse" : "fetch");
      return { events, errors, fetchedAt };
    }
    try {
      const productions = object(body).productions;
      if (!Array.isArray(productions)) throw new Error("Freight calendar missing productions array");
      const seen = new Set<string>();
      for (const item of productions) {
        try {
          const production = object(item);
          if (!Array.isArray(production.performances)) throw new Error("Freight production missing performances array");
          for (const value of production.performances) {
            try {
              const performance = object(value);
              if (performance.isPerformanceVisible === false) continue;
              const id = performance.id;
              const date = performance.performanceDate;
              if ((typeof id !== "number" && typeof id !== "string") || !/^\d+$/.test(String(id))) throw new Error("Freight performance missing numeric ID");
              if (typeof date !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(date)) throw new Error(`Freight performance ${id} missing timezone-aware date`);
              const startTimeUtc = new Date(date);
              if (Number.isNaN(startTimeUtc.getTime())) throw new Error(`Freight performance ${id} has invalid date`);
              if (startTimeUtc < fetchedAt) continue;
              const $ = cheerio.load(String(performance.performanceTitle ?? production.productionTitle ?? ""), null, false);
              $("br").replaceWith(" ");
              const title = $.text().replace(/\s+/g, " ").trim();
              const sourceUrl = new URL(String(performance.actionUrl ?? production.productionSeasonActionUrl ?? ""));
              if (!title || sourceUrl.protocol !== "https:") throw new Error(`Freight performance ${id} missing title or HTTPS ticket URL`);
              // The calendar also advertises off-site programs (e.g. Berkeley
              // Public Library). Do not assign those to Freight's venue.
              if (sourceUrl.hostname !== "secure.thefreight.org") continue;
              if (seen.has(String(id))) continue;
              seen.add(String(id));
              events.push({
                identity: { source: ID, externalId: `performance:${id}`, sourceUrl: sourceUrl.href },
                title, description: null, startTimeUtc, endTimeUtc: null, timezone: TZ,
                venue: { name: "Freight & Salvage", city: "Berkeley", neighborhood: "Downtown Berkeley", address: "2020 Addison St, Berkeley, CA 94704", lat: 37.870339, lng: -122.268349, timezone: TZ },
                primaryCategory: classifyCategory(title), pricing: { priceMin: null, priceMax: null, isFree: false },
                recurrence: null, verificationLevel: "official", rawPayload: performance, fetchedAt,
              });
            } catch (error) { report(error, "parse"); }
          }
        } catch (error) { report(error, "parse"); }
      }
    } catch (error) { report(error, "parse"); }
    return { events, errors, fetchedAt };
  },
  normalize(raw: RawEvent, provenance: Provenance): NormalizedEvent {
    return {
      canonicalFingerprint: fingerprint({ title: raw.title, venueName: raw.venue.name, startTimeUtc: raw.startTimeUtc, timezone: raw.timezone }),
      identity: raw.identity, title: raw.title, description: raw.description ?? null,
      startTimeUtc: raw.startTimeUtc, endTimeUtc: raw.endTimeUtc ?? null, timezone: raw.timezone,
      category: raw.primaryCategory, pricing: raw.pricing ?? { priceMin: null, priceMax: null, isFree: false },
      venue: raw.venue, recurrence: raw.recurrence ?? null, verificationLevel: raw.verificationLevel,
      rawPayload: raw.rawPayload, provenance,
    };
  },
};
export default adapter;
