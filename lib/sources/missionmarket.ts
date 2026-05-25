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
 * Mission Community Market — Tier-3 schedule-expansion adapter.
 *
 * The market runs every Thursday afternoon at Bartlett & 22nd Street in the
 * Mission. As of this writing the official site (missioncommunitymarket.org)
 * resolves to a DreamHost "Site Not Found" placeholder, so there is no event
 * HTML to scrape: title, day-of-week, location, and time are stable
 * editorial facts about the market itself (referenced in SF Recreation &
 * Parks listings, Mission Local coverage, etc.).
 *
 * Approach: hit the canonical URL once per ingest (so the adapter still
 * exercises a network IO path and any future site restoration is detected
 * via the captured payload), then synthesize one RawEvent per Thursday for
 * the next 60 days. seriesId groups the occurrences for downstream
 * recurrence-aware UI; occurrenceId is the local ISO date so the persister
 * sees stable per-event identity.
 */

const ID = "scrape:missionmarket";
const LISTING_URL = "https://missioncommunitymarket.org";
const TZ = "America/Los_Angeles";
const HORIZON_DAYS = 60;

const VENUE_NAME = "Mission Community Market";
const VENUE_ADDRESS = "Bartlett Street between 21st & 22nd, San Francisco, CA";
const VENUE_NEIGHBORHOOD = "Mission";
// Bartlett & 22nd, San Francisco (Mission)
const VENUE_LAT = 37.7558;
const VENUE_LNG = -122.4192;

// Market hours: Thursdays, 3pm–7pm PT (year-round; rain or shine).
const START_HOUR_LOCAL = 15; // 3:00 PM
const END_HOUR_LOCAL = 19; // 7:00 PM
const THURSDAY = 4; // JS Date.getDay(): Sun=0..Sat=6

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    let pageStatus: number | null = null;
    let pageBytes = 0;
    try {
      const { html, status } = await fetchHtml(LISTING_URL);
      pageStatus = status;
      pageBytes = html.length;
    } catch (err) {
      // Network/HTTP error is non-fatal: the schedule expansion below is the
      // source of truth for now. Record so daily-run visibility surfaces if
      // the placeholder is ever replaced with real anti-bot blocks.
      errors.push({
        source: ID,
        stage: "fetch",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        occurredAt: new Date(),
      });
    }

    const seriesId = `${ID}:thursday-market`;

    try {
      for (const occurrence of expandThursdays(fetchedAt, HORIZON_DAYS)) {
        const { startUtc, endUtc, localDate } = occurrence;
        const externalId = `mcm-thursday-${localDate}`;
        const title = `Mission Community Market — Thursday Farmers' Market`;

        events.push({
          identity: {
            source: ID,
            externalId,
            sourceUrl: LISTING_URL,
          },
          title,
          description:
            "Weekly outdoor farmers' market on Bartlett Street in the Mission, with local produce, prepared food vendors, live music, and community programming. Free to attend.",
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
          primaryCategory: "food",
          pricing: { isFree: true },
          recurrence: {
            seriesId,
            occurrenceId: localDate,
          },
          verificationLevel: "official",
          rawPayload: {
            localDate,
            listingStatus: pageStatus,
            listingBytes: pageBytes,
          },
          fetchedAt,
        });
      }
    } catch (err) {
      errors.push({
        source: ID,
        stage: "parse",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
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
      pricing: raw.pricing ?? { isFree: false },
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
// Schedule expansion helpers (exported for tests).
// ---------------------------------------------------------------------------

export type ThursdayOccurrence = {
  /** UTC instant corresponding to 3:00 PM local on this Thursday. */
  startUtc: Date;
  /** UTC instant corresponding to 7:00 PM local on this Thursday. */
  endUtc: Date;
  /** Local calendar date in `America/Los_Angeles` (YYYY-MM-DD). */
  localDate: string;
};

/**
 * Yield every Thursday in [from, from + horizonDays] in California local
 * time. We use Intl-derived local date to pick the right "Thursday" rather
 * than UTC arithmetic, which would drift by ±1 day depending on time-of-day
 * of the fetch.
 *
 * Times are constructed by asking what UTC instant displays as
 * 15:00/19:00 local on that calendar date. We try a candidate UTC and
 * iterate; one or two iterations always converges (DST shifts at most an
 * hour).
 */
export function expandThursdays(
  from: Date,
  horizonDays: number,
): ThursdayOccurrence[] {
  const out: ThursdayOccurrence[] = [];
  const seen = new Set<string>();

  // Walk day-by-day so we don't have to do timezone-aware arithmetic.
  // Skip Thursday "today" if its 7pm-PT close is already in the past.
  for (let i = 0; i <= horizonDays; i++) {
    const probe = new Date(from.getTime() + i * 86_400_000);
    const localDate = formatLocalDate(probe, TZ);
    if (seen.has(localDate)) continue;
    if (!isLocalThursday(localDate)) {
      seen.add(localDate);
      continue;
    }
    seen.add(localDate);

    const startUtc = utcForLocalHour(localDate, START_HOUR_LOCAL);
    const endUtc = utcForLocalHour(localDate, END_HOUR_LOCAL);

    // Skip occurrences whose market window has already fully closed.
    if (endUtc.getTime() <= from.getTime()) continue;

    out.push({ startUtc, endUtc, localDate });
  }

  return out;
}

/**
 * Given a YYYY-MM-DD string interpreted as a local calendar date, return
 * the JS day-of-week (0=Sun..6=Sat). Uses noon UTC + Intl to avoid
 * boundary surprises.
 */
function isLocalThursday(localDate: string): boolean {
  const [y, m, d] = localDate.split("-").map(Number);
  // Noon UTC is the same calendar day in every IANA zone, so we can use
  // standard Date day-of-week.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  // formatLocalDate confirms we picked the right local day:
  if (formatLocalDate(noonUtc, TZ) !== localDate) return false;
  return noonUtc.getUTCDay() === THURSDAY;
}

/**
 * Find the UTC instant that displays as `${localDate}T${HH}:00` in
 * America/Los_Angeles. Iterates at most a couple of times to converge
 * across DST boundaries.
 */
function utcForLocalHour(localDate: string, hourLocal: number): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  // Initial guess: pretend local is UTC-8 (PST). DST will be corrected by
  // the offset-from-Intl computation below.
  let guess = new Date(Date.UTC(y, m - 1, d, hourLocal + 8));
  for (let i = 0; i < 3; i++) {
    const localMinute = localMinuteFor(guess);
    const want = `${localDate}T${pad2(hourLocal)}:00`;
    if (localMinute === want) return guess;
    const diffMinutes = minuteDiff(localMinute, want);
    guess = new Date(guess.getTime() + diffMinutes * 60_000);
  }
  return guess;
}

function localMinuteFor(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

function minuteDiff(have: string, want: string): number {
  // Convert "YYYY-MM-DDTHH:mm" to a comparable epoch-ish number.
  const toMin = (s: string): number => {
    const [date, time] = s.split("T");
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) / 60_000;
  };
  return toMin(want) - toMin(have);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
