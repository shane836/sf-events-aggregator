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

const ID = "scrape:sfcomedycollege";
const LISTING_URL = "https://www.sfcomedycollege.com/2026-schedule.html";
const TZ = "America/Los_Angeles";

// Verified via /contact.html: "San Francisco Comedy College, 868 Kearny, SF".
// 868 Kearny St sits at Kearny & Washington — Chinatown / North Beach border.
// (User brief said "Mission"; verification overrides — adapter ships with the
// actual address, not the user-supplied guess.)
const VENUE_NAME = "SF Comedy College";
const VENUE_ADDRESS = "868 Kearny St, San Francisco, CA 94108";
const VENUE_NEIGHBORHOOD = "Chinatown";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

// Matches the canonical Free Intro line shape on /2026-schedule.html:
//   "Free Intro – Tuesday, April 21st, 6:00 PM"
// (HTML uses &ndash; + &nbsp; which cheerio's text() decodes to "–" and " ".)
const FREE_INTRO_RE =
  /Free\s+Intro\s*[–—-]\s*(?:[A-Za-z]+),\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{1,2}):(\d{2})\s*(AM|PM)/gi;

type ParsedIntro = {
  monthIdx: number;   // 0-11
  day: number;
  hour24: number;
  minute: number;
  monthName: string;  // for externalId stability
};

export function parseFreeIntros(html: string): ParsedIntro[] {
  // Normalize entities so cheerio-decoded and curl-raw both work.
  const text = html
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—");

  const out: ParsedIntro[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(FREE_INTRO_RE)) {
    const monthRaw = m[1].toLowerCase();
    const monthIdx = MONTHS[monthRaw];
    if (monthIdx === undefined) continue;
    const day = Number.parseInt(m[2], 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    let hour = Number.parseInt(m[3], 10);
    const minute = Number.parseInt(m[4], 10);
    const ampm = m[5].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    const key = `${monthIdx}-${day}-${hour}-${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      monthIdx,
      day,
      hour24: hour,
      minute,
      monthName: m[1].toLowerCase(),
    });
  }
  return out;
}

/**
 * Resolve a (month, day) to an absolute year, anchored at `now`.
 * If the month/day has already passed this year, roll to next year.
 * Pure / deterministic given `now`.
 */
export function resolveYear(
  monthIdx: number,
  day: number,
  now: Date,
): number {
  const year = now.getUTCFullYear();
  // Compare in local PT for stability with how dates are displayed on-site.
  const nowLocalMs = now.getTime();
  const candidate = Date.UTC(year, monthIdx, day);
  // Allow a 1-day grace so today's event still ingests.
  if (candidate + 24 * 3600 * 1000 < nowLocalMs) return year + 1;
  return year;
}

/**
 * Convert a Pacific-local wall time to a UTC Date.
 * Pacific is UTC-8 (PST) or UTC-7 (PDT); we detect via Intl rather than
 * hardcoding DST boundaries.
 */
export function pacificWallTimeToUtc(
  year: number,
  monthIdx: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Start from the naive UTC interpretation, then correct by the PT offset
  // observed at that instant. Iterate once: the offset of the corrected
  // instant is the same as the original for all non-DST-boundary minutes.
  const naive = Date.UTC(year, monthIdx, day, hour, minute);
  const offset1 = pacificOffsetMinutes(new Date(naive));
  const guess = naive + offset1 * 60_000;
  const offset2 = pacificOffsetMinutes(new Date(guess));
  if (offset2 === offset1) return new Date(guess);
  // DST boundary: re-correct.
  return new Date(naive + offset2 * 60_000);
}

function pacificOffsetMinutes(instant: Date): number {
  // Returns minutes to ADD to UTC to get PT.
  // formatToParts in en-US "long" with timeZoneName=longOffset yields "GMT-7" / "GMT-8".
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!m) return -480; // safe default: PST
  const sign = m[1] === "+" ? 1 : -1;
  const h = Number.parseInt(m[2], 10);
  const min = m[3] ? Number.parseInt(m[3], 10) : 0;
  // We want minutes to ADD to UTC to get PT, then SUBTRACT from PT-wall to get UTC.
  // Convention: pacificWallTimeToUtc subtracts the returned value, so return
  // the negative offset (e.g. PDT returns +420 so naive UTC + 420 = real UTC).
  return -sign * (h * 60 + min);
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
      const { html, finalUrl } = await fetchHtml(LISTING_URL);
      const intros = parseFreeIntros(html);

      if (intros.length === 0) {
        errors.push({
          source: ID,
          stage: "parse",
          message:
            "no Free Intro entries matched on /2026-schedule.html — page format may have changed",
          retryable: false,
          occurredAt: new Date(),
        });
      }

      for (const intro of intros) {
        const year = resolveYear(intro.monthIdx, intro.day, fetchedAt);
        const startUtc = pacificWallTimeToUtc(
          year,
          intro.monthIdx,
          intro.day,
          intro.hour24,
          intro.minute,
        );
        const endUtc = new Date(startUtc.getTime() + 90 * 60_000); // 1.5h workshop

        const externalId = `free-intro-${year}-${String(intro.monthIdx + 1).padStart(2, "0")}-${String(intro.day).padStart(2, "0")}`;

        events.push({
          identity: {
            source: ID,
            externalId,
            sourceUrl: finalUrl,
          },
          title: "SFCC Free Intro to Stand-Up Comedy",
          description:
            "Free 1.5-hour introductory stand-up comedy workshop with SFCC founder Kurtis Matthews. Limited to 14 in-person students at 868 Kearny in San Francisco (additional seats online via Zoom). Open to the public.",
          startTimeUtc: startUtc,
          endTimeUtc: endUtc,
          timezone: TZ,
          venue: {
            name: VENUE_NAME,
            neighborhood: VENUE_NEIGHBORHOOD,
            address: VENUE_ADDRESS,
            lat: null,
            lng: null,
            timezone: TZ,
          },
          primaryCategory: "comedy",
          pricing: {
            priceMin: null,
            priceMax: null,
            isFree: true,
          },
          recurrence: null,
          verificationLevel: "official",
          rawPayload: {
            listingUrl: finalUrl,
            monthName: intro.monthName,
            day: intro.day,
            hour: intro.hour24,
            minute: intro.minute,
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
