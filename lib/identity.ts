import { createHash } from "node:crypto";

/**
 * Identity helpers. Pure, synchronous, no IO.
 *
 * These functions define the canonical identity model documented in
 * docs/IDENTITY.md. Every adapter funnels through them — do not reimplement
 * normalization or fingerprinting elsewhere.
 */

/**
 * Soft title normalization:
 *   - lowercase
 *   - NFKD + strip combining marks (so "Café" matches "Cafe")
 *   - collapse whitespace
 *
 * We do NOT strip punctuation: "K.Flay" and "K Flay" are intentionally
 * different fingerprints. False splits are recoverable (manual venue alias);
 * false merges are not (silent data loss).
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Venue name normalization shares the title rules. The persister upserts
 * venues on this normalized form (venues.normalized_name unique index).
 */
export function normalizeVenueName(name: string): string {
  return normalizeTitle(name);
}

/**
 * Canonical event fingerprint.
 *
 *   sha256(norm_title | norm_venue_name | local_iso_minute) truncated to 32 hex.
 *
 * Notes:
 *   - venueId is NOT an input. Surrogate IDs can be re-resolved; fingerprints
 *     must not. Same event from two adapters → same fingerprint without any
 *     dependency on shared state.
 *   - Local time is computed via Intl.DateTimeFormat with the event's
 *     timezone. Never derive local date from UTC ISO slicing.
 *   - Minute-level granularity: 7pm and 9:30pm same-night shows of the same
 *     act at the same venue produce distinct fingerprints.
 */
export function fingerprint(input: {
  title: string;
  venueName: string;
  startTimeUtc: Date;
  timezone: string;
}): string {
  const localMinute = formatLocalMinute(input.startTimeUtc, input.timezone);
  const key = [
    normalizeTitle(input.title),
    normalizeVenueName(input.venueName),
    localMinute,
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Returns "YYYY-MM-DDTHH:mm" in the given IANA timezone.
 * Used by fingerprint() and by the UI to derive calendar-day grouping.
 */
export function formatLocalMinute(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Intl returns "24" for midnight in hour12:false; normalize to "00".
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

/**
 * Local calendar date in "YYYY-MM-DD" for the given timezone.
 * Use this for calendar-grid grouping, never `.toISOString().slice(0,10)`.
 */
export function formatLocalDate(date: Date, timezone: string): string {
  return formatLocalMinute(date, timezone).slice(0, 10);
}
