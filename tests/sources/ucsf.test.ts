import { describe, expect, it } from "vitest";
import adapter from "@/lib/sources/ucsf";
import type { RawEvent } from "@/lib/sources/types";

const sample: RawEvent = {
  sourceId: "ucsf-grand-rounds-12345",
  title: "Medical Grand Rounds: CRISPR Therapeutics",
  description: "Open to the public.",
  startTime: new Date("2026-06-10T15:00:00Z"),
  endTime: new Date("2026-06-10T16:00:00Z"),
  venueName: "UCSF Parnassus Campus",
  venueAddress: "513 Parnassus Ave",
  venueLat: null,
  venueLng: null,
  sourceUrl: "https://calendar.ucsf.edu/event/12345",
  priceMin: null,
  priceMax: null,
  isFree: true,
  rawPayload: { uid: "ucsf-grand-rounds-12345", summary: "Medical Grand Rounds: CRISPR Therapeutics" },
};

describe("UCSF adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("ical:ucsf");
    expect(adapter.tier).toBe("ical");
    expect(adapter.defaultCategory).toBe("lectures");
  });

  it("normalizes a raw event into venue + event with stable fingerprint", () => {
    const { venue, event } = adapter.normalize(sample);

    // Venue stays in SF — UCSF Parnassus neighborhood is hard-coded by the adapter
    expect(venue.name).toBe("UCSF Parnassus Campus");
    expect(venue.address).toBe("513 Parnassus Ave");
    expect(venue.neighborhood).toBe("Parnassus / Mission Bay");
    expect(venue.primaryCategory).toBe("lectures");

    // Event carries source identity + category + free-price display
    expect(event.source).toBe("ical:ucsf");
    expect(event.sourceId).toBe(sample.sourceId);
    expect(event.sourceUrl).toBe(sample.sourceUrl);
    expect(event.title).toBe(sample.title);
    expect(event.category).toBe("lectures");
    expect(event.isFree).toBe(true);
    expect(event.priceDisplay).toBe("Free");
    expect(event.startTime).toEqual(sample.startTime);
    expect(event.endTime).toEqual(sample.endTime);

    // Fingerprint is deterministic — same input → same hash
    expect(event.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    const second = adapter.normalize(sample);
    expect(second.event.fingerprint).toBe(event.fingerprint);
  });

  it("honors a categoryHint over the default", () => {
    const { event } = adapter.normalize({ ...sample, categoryHint: "music" });
    expect(event.category).toBe("music");
  });

  it("never produces a null/empty source_url or price_display (D12/D13 invariants)", () => {
    const { event } = adapter.normalize(sample);
    expect(event.sourceUrl?.length ?? 0).toBeGreaterThan(0);
    expect(event.priceDisplay?.length ?? 0).toBeGreaterThan(0);
  });
});
