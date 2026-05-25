import { fetchICalEvents, splitLocation } from "@/lib/ical";
import { fingerprint } from "@/lib/identity";
import type {
  FetchResult,
  NormalizedEvent,
  Provenance,
  RawEvent,
  SourceAdapter,
  SourceError,
} from "./types";

const ID = "ical:ucsf";
const FEED_URL = "https://calendar.ucsf.edu/calendar/1.ics";
const TZ = "America/Los_Angeles";
const DEFAULT_NEIGHBORHOOD = "Parnassus / Mission Bay";

const adapter: SourceAdapter = {
  id: ID,
  tier: "ical",
  verificationLevel: "trusted_partner",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: SourceError[] = [];
    const fetchedAt = new Date();

    try {
      const vevents = await fetchICalEvents(FEED_URL, { horizonDays: 365 });
      for (const ev of vevents) {
        if (!ev.start) continue;

        const uid = typeof ev.uid === "string" ? ev.uid : String(ev.uid);
        const title =
          typeof ev.summary === "string"
            ? ev.summary
            : (ev.summary?.val ?? "Untitled event");
        const description =
          typeof ev.description === "string"
            ? ev.description.slice(0, 4000)
            : null;
        const sourceUrl =
          typeof ev.url === "string"
            ? ev.url
            : `https://calendar.ucsf.edu/event/${encodeURIComponent(uid)}`;
        const { name, address } = splitLocation(
          typeof ev.location === "string" ? ev.location : undefined,
        );

        events.push({
          identity: {
            source: ID,
            externalId: uid,
            sourceUrl,
          },
          title,
          description,
          startTimeUtc: ev.start,
          endTimeUtc: ev.end ?? null,
          timezone: TZ,
          venue: {
            name,
            neighborhood: DEFAULT_NEIGHBORHOOD,
            address: address ?? null,
            lat: null,
            lng: null,
            timezone: TZ,
          },
          primaryCategory: "lectures",
          pricing: {
            priceMin: null,
            priceMax: null,
            isFree: true, // UCSF academic events are overwhelmingly free
          },
          recurrence: null,
          verificationLevel: "trusted_partner",
          rawPayload: { uid, summary: title },
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
