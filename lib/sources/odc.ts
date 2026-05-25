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

/**
 * ODC Theater calendar scraper.
 *
 * Site: https://odc.dance/calendar/events (Drupal-backed listing page)
 *
 * Approach: CSS selectors over the `.table-calendar__item` blocks. Each block
 * has a `<h4>M/D</h4>` date and a `<ul class="list future|past">` of events;
 * each `<li>` has an `<a>` (title + ticket URL) and a `<time>` (start time).
 *
 * No JSON-LD, no og: event metadata on the calendar page — the calendar is
 * rendered server-side as a Drupal view, so a single fetch is enough and the
 * markup is stable enough to walk with cheerio.
 *
 * Year inference: dates on the listing are MM/DD only. We default to the
 * current year; any date that resolves to more than 60 days in the past is
 * bumped to next year. The listing only renders the current season window
 * (May–August at time of writing), so wrap-around is rare in practice.
 */

const ID = "scrape:odc";
const LISTING_URL = "https://odc.dance/calendar/events";
const TZ = "America/Los_Angeles";
const VENUE_NAME = "ODC Theater";
const VENUE_ADDRESS = "3153 17th St, San Francisco, CA 94110";
const VENUE_NEIGHBORHOOD = "Mission";

const adapter: SourceAdapter = {
  id: ID,
  tier: "scrape",
  verificationLevel: "official",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();
    const now = fetchedAt;

    try {
      const { $ } = await fetchHtml(LISTING_URL);

      $(".table-calendar__item").each((_, item) => {
        const $item = $(item);
        const dateText = $item.find(".date h4").first().text().trim();
        const parsed = parseMonthDay(dateText);
        if (!parsed) return;
        const { month, day } = parsed;

        // Only consume the `future` list — past entries are still rendered.
        $item.find("ul.list.future li").each((_, li) => {
          const $li = $(li);
          const $a = $li.find("a").first();
          const rawTitle = $a.text().trim();
          const href = $a.attr("href") ?? "";
          const timeText = $li.find("time").first().text().trim();

          if (!rawTitle || !href || !timeText) return;

          const timeOfDay = parseTimeOfDay(timeText);
          if (!timeOfDay) return;

          const startUtc = buildStartUtc(now, month, day, timeOfDay);
          if (!startUtc) return;
          // Skip anything that already happened — runner / D6 invariant.
          if (startUtc.getTime() < now.getTime() - 6 * 60 * 60 * 1000) return;

          const externalId = makeExternalId(href, startUtc);

          events.push({
            identity: {
              source: ID,
              externalId,
              sourceUrl: href,
            },
            title: rawTitle,
            description: null,
            startTimeUtc: startUtc,
            endTimeUtc: null,
            timezone: TZ,
            venue: {
              name: VENUE_NAME,
              neighborhood: VENUE_NEIGHBORHOOD,
              address: VENUE_ADDRESS,
              lat: null,
              lng: null,
              timezone: TZ,
            },
            primaryCategory: "dancing",
            // ODC tickets are paid but per-show pricing isn't on the listing.
            // priceMin/Max null + isFree false = "Price varies" at render.
            pricing: { priceMin: null, priceMax: null, isFree: false },
            recurrence: null,
            verificationLevel: "official",
            rawPayload: {
              dateLabel: dateText,
              timeLabel: timeText,
              href,
            },
            fetchedAt,
          });
        });
      });
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

// ---------------- helpers (pure) ----------------

export function parseMonthDay(
  s: string,
): { month: number; day: number } | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function parseTimeOfDay(
  s: string,
): { hour: number; minute: number } | null {
  const m = s
    .replace(/\s+/g, "")
    .toUpperCase()
    .match(/^(\d{1,2}):?(\d{2})?(AM|PM)$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3];
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Build a UTC Date for an event at the given local M/D and time, with
 * year inferred from `now`. Roll forward to next year only if the resulting
 * date is more than 60 days behind now (handles the late-Dec → early-Jan
 * calendar wrap without misclassifying merely "past" events).
 */
export function buildStartUtc(
  now: Date,
  month: number,
  day: number,
  time: { hour: number; minute: number },
): Date | null {
  const year = now.getUTCFullYear();
  const candidate = makeZonedDate(year, month, day, time.hour, time.minute);
  if (!candidate) return null;
  const ageMs = now.getTime() - candidate.getTime();
  if (ageMs > 60 * 24 * 60 * 60 * 1000) {
    return makeZonedDate(year + 1, month, day, time.hour, time.minute);
  }
  return candidate;
}

/**
 * Construct a Date representing the given local wall-clock time in the
 * America/Los_Angeles timezone. Done by guessing UTC, asking Intl how that
 * UTC instant renders in LA, and correcting by the difference.
 */
function makeZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  // Start from a UTC guess; resolve LA offset for that instant.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (Number.isNaN(guess.getTime())) return null;
  const offsetMinutes = laOffsetMinutes(guess);
  // Local time = UTC + offset. We want UTC such that UTC+offset == desired local.
  // So UTC = desired_local - offset.
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

function laOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return -480; // PST fallback
  const sign = m[1] === "+" ? 1 : -1;
  const hours = Number(m[2]);
  const minutes = m[3] ? Number(m[3]) : 0;
  return sign * (hours * 60 + minutes);
}

function makeExternalId(href: string, startUtc: Date): string {
  // href + ISO-minute keys an event without depending on the title (which
  // can drift). Two shows at the same time with different href → distinct.
  const minute = startUtc.toISOString().slice(0, 16);
  return `${href}@${minute}`;
}
