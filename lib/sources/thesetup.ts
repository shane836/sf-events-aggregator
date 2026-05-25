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
 * The Setup — independent comedy producer that runs weekly shows at
 * The Palace Theater (North Beach) and The Lost Church (North Beach).
 *
 * Why the Google Sheet CSV instead of HTML scraping:
 *   The public site (setupcomedy.com/comedyshow-sanfrancisco) is a
 *   client-side renderer — the show list is empty in initial HTML and
 *   gets injected at runtime from a published Google Sheet CSV (the URL
 *   is hard-coded in the page's `<script>` block). Hitting the CSV
 *   directly is one network call, structured data, and venue-owned —
 *   strictly cleaner than DOM-scraping a JS-rendered page (B4 would
 *   force Playwright otherwise; M3 rubric prefers cheerio-first).
 *
 * Pricing: The Setup charges a flat $35 across venues. Confirmed via
 *   spot-check of three ticket pages' JSON-LD `Product.offers.price`
 *   (Palace Theater Mar 13, Palace Theater May 29, Lost Church Apr 4 —
 *   all $35.00 USD). Hard-coding the flat price avoids 26+ detail-page
 *   fetches per run (B3 cap is 20).
 *
 * Verification level: `official` per the assignment — this is the
 *   venue's own data source.
 */

const ID = "scrape:thesetup";
const TZ = "America/Los_Angeles";

/**
 * Published Google Sheet CSV. Parsed out of the homepage `<script>` block
 * on 2026-05-24; the URL has been stable since the site was rebuilt.
 * If The Setup changes their data source, this constant updates and a
 * fresh fixture goes in `fixtures/raw/thesetup.html` to show where the
 * new URL was found.
 */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTGjBPXefy3N-RiCW15l_DaDovBB8d11X9PpGMRxUt_BRYzjoBtKUTyNhIf1AzaRJFLFxF71rMOWWku/pub?gid=495747966&single=true&output=csv";

const LISTING_URL = "https://setupcomedy.com/comedyshow-sanfrancisco";

const USER_AGENT =
  "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)";

const FLAT_PRICE_USD = 35;

/**
 * Venue metadata. Hardcoded per IDENTITY.md guidance ("geocoding is the
 * persister's job — hardcode lat/lng per adapter if needed"). Addresses
 * verified from each venue's own site.
 */
const VENUES: Record<string, VenueCandidate> = {
  "the palace theater": {
    name: "The Palace Theater",
    address: "644 Broadway, San Francisco, CA 94133",
    neighborhood: "North Beach",
    lat: 37.7975,
    lng: -122.4078,
    timezone: TZ,
  },
  "the lost church": {
    name: "The Lost Church",
    address: "988 Columbus Ave, San Francisco, CA 94133",
    neighborhood: "North Beach",
    lat: 37.8021,
    lng: -122.4129,
    timezone: TZ,
  },
};

/**
 * Fallback venue for any future venue that appears in the CSV before
 * we add it to the map. We still emit the event (so it shows up in the
 * aggregator) but with minimal venue data; the persister handles upsert.
 */
function resolveVenue(rawName: string, rawCity: string): VenueCandidate {
  const key = rawName.trim().toLowerCase();
  const known = VENUES[key];
  if (known) return known;
  return {
    name: rawName.trim(),
    address: null,
    neighborhood:
      rawCity.trim().toLowerCase() === "san francisco"
        ? null
        : (rawCity.trim() || null),
    lat: null,
    lng: null,
    timezone: TZ,
  };
}

export type CsvRow = {
  date: string; // YYYY-MM-DD
  day: string; // Fri, Sat, etc.
  time: string; // "9:00 PM"
  title: string;
  venue: string;
  city: string;
  ticket_url: string;
  urgency_tag: string;
  sold_out: string;
};

/**
 * Minimal CSV parser scoped to this source. The published Google Sheet
 * does not quote fields containing commas in any observed row, but we
 * still handle simple double-quote escaping to be safe.
 *
 * Exported for unit tests.
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (cells[j] ?? "").trim();
    }
    out.push(row as unknown as CsvRow);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/**
 * Convert a CSV row to a UTC Date. The CSV stores local-PT dates and
 * times — we materialize them as a wall-clock instant in
 * America/Los_Angeles and convert to UTC via the offset for that day.
 *
 * Exported for unit tests.
 */
export function csvRowToUtc(date: string, time: string): Date | null {
  // date: "2026-05-29"
  // time: "9:00 PM" | "9:30 PM" | "8:00 PM"
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dm) return null;
  const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!tm) return null;

  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  let h = Number(tm[1]);
  const min = Number(tm[2]);
  const ampm = tm[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  // Step 1: candidate UTC if PT were a fixed offset of 0.
  const utcGuess = Date.UTC(y, mo - 1, d, h, min);

  // Step 2: figure out PT offset at that instant (handles PST vs PDT).
  const offsetMinutes = ptOffsetMinutes(new Date(utcGuess));

  // Step 3: shift by the offset to get true UTC.
  return new Date(utcGuess + offsetMinutes * 60_000);
}

/**
 * Returns how many minutes PT is BEHIND UTC at the given instant
 * (e.g., 480 for PST, 420 for PDT). Uses Intl to avoid timezone-library
 * dependencies.
 */
function ptOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!m) return 480; // PST fallback
  const sign = m[1] === "+" ? 1 : -1;
  const hours = Number(m[2]);
  const mins = Number(m[3] ?? "0");
  // PT is "GMT-8" or "GMT-7" → behind UTC → we want a positive number.
  return -sign * (hours * 60 + mins);
}

async function fetchCsv(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/csv,text/plain,*/*",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    let csv: string;
    try {
      csv = await fetchCsv(CSV_URL);
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

    let rows: CsvRow[];
    try {
      rows = parseCsv(csv);
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

    // Only keep SF rows. The sheet is currently SF-only, but defending
    // against a future column rename / multi-city sheet.
    const sfRows = rows.filter((r) => {
      const city = (r.city ?? "").toLowerCase();
      return (
        city.includes("san francisco") ||
        city.includes("sf") ||
        city.includes("north beach")
      );
    });

    // D6: filter out past-dated events. The published sheet includes prior
    // weeks' shows; we keep a 24h grace window for shows currently in
    // progress (start_time < now() - 1 day → drop).
    const cutoff = new Date(fetchedAt.getTime() - 24 * 60 * 60 * 1000);

    for (const row of sfRows) {
      const start = csvRowToUtc(row.date, row.time);
      if (!start) {
        errors.push({
          source: ID,
          externalId: row.ticket_url || `${row.date}-${row.time}`,
          stage: "parse",
          message: `unparseable date/time: '${row.date}' '${row.time}'`,
          retryable: false,
          occurredAt: new Date(),
        });
        continue;
      }

      if (start < cutoff) continue;

      const sourceUrl = row.ticket_url?.trim();
      if (!sourceUrl) {
        errors.push({
          source: ID,
          externalId: `${row.date}-${row.time}-${row.venue}`,
          stage: "parse",
          message: "missing ticket_url (D1 invariant: sourceUrl required)",
          retryable: false,
          occurredAt: new Date(),
        });
        continue;
      }

      const isSoldOut = (row.sold_out ?? "").trim().length > 0;
      // Even sold-out shows are surfaced — UI can decide to badge or hide.
      // External id from the ticket-page slug: deterministic and stable
      // across runs (the slug encodes venue+date+time).
      const externalId = sourceUrl.replace(/^https?:\/\/[^/]+\//, "");

      events.push({
        identity: {
          source: ID,
          externalId,
          sourceUrl,
        },
        title: row.title || "The Setup",
        description: row.urgency_tag ? row.urgency_tag.trim() : null,
        startTimeUtc: start,
        endTimeUtc: null,
        timezone: TZ,
        venue: resolveVenue(row.venue, row.city),
        primaryCategory: "comedy",
        pricing: {
          priceMin: isSoldOut ? null : FLAT_PRICE_USD,
          priceMax: isSoldOut ? null : FLAT_PRICE_USD,
          isFree: false,
        },
        recurrence: null,
        verificationLevel: "official",
        rawPayload: {
          listingUrl: LISTING_URL,
          row,
        },
        fetchedAt,
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
