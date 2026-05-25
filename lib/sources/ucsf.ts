import type { SourceAdapter, FetchResult, RawEvent, NormalizedRow } from "./types";
import { fetchICalEvents, splitLocation } from "@/lib/ical";
import { fingerprint, priceDisplay } from "@/lib/normalize";

const ID = "ical:ucsf";
const FEED_URL = "https://calendar.ucsf.edu/calendar/1.ics";
const DEFAULT_NEIGHBORHOOD = "Parnassus / Mission Bay";

export const adapter: SourceAdapter = {
  id: ID,
  tier: "ical",
  defaultCategory: "lectures",

  async fetch(): Promise<FetchResult> {
    const events: RawEvent[] = [];
    const errors: FetchResult["errors"] = [];

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
          sourceId: uid,
          title,
          description,
          startTime: ev.start,
          endTime: ev.end ?? null,
          venueName: name,
          venueAddress: address,
          venueLat: null,
          venueLng: null,
          sourceUrl,
          priceMin: null,
          priceMax: null,
          isFree: true, // UCSF academic events are overwhelmingly free
          rawPayload: { uid, summary: title },
        });
      }
    } catch (err) {
      errors.push({
        message: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return { events, errors };
  },

  normalize(raw: RawEvent): NormalizedRow {
    const fp = fingerprint({
      title: raw.title,
      venueName: raw.venueName,
      startTime: raw.startTime,
    });
    return {
      venue: {
        name: raw.venueName,
        neighborhood: DEFAULT_NEIGHBORHOOD,
        address: raw.venueAddress ?? null,
        lat: raw.venueLat != null ? raw.venueLat.toString() : null,
        lng: raw.venueLng != null ? raw.venueLng.toString() : null,
        primaryCategory: this.defaultCategory,
        sourceMetadata: null,
      },
      event: {
        sourceId: raw.sourceId,
        source: this.id,
        sourceUrl: raw.sourceUrl,
        title: raw.title,
        description: raw.description ?? null,
        category: raw.categoryHint ?? this.defaultCategory,
        startTime: raw.startTime,
        endTime: raw.endTime ?? null,
        priceMin: raw.priceMin != null ? raw.priceMin.toString() : null,
        priceMax: raw.priceMax != null ? raw.priceMax.toString() : null,
        isFree: raw.isFree ?? false,
        priceDisplay: priceDisplay({
          priceMin: raw.priceMin,
          priceMax: raw.priceMax,
          isFree: raw.isFree,
        }),
        rawPayload: raw.rawPayload,
        fingerprint: fp,
      },
    };
  },
};

export default adapter;
