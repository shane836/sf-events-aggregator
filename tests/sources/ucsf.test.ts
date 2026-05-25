import { describe, expect, it } from "vitest";
import adapter from "@/lib/sources/ucsf";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "ical:ucsf",
    externalId: "ucsf-grand-rounds-12345",
    sourceUrl: "https://calendar.ucsf.edu/event/12345",
  },
  title: "Medical Grand Rounds: CRISPR Therapeutics",
  description: "Open to the public.",
  startTimeUtc: new Date("2026-06-10T15:00:00Z"),
  endTimeUtc: new Date("2026-06-10T16:00:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "UCSF Parnassus Campus",
    neighborhood: "Parnassus / Mission Bay",
    address: "513 Parnassus Ave",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "lectures",
  pricing: { priceMin: null, priceMax: null, isFree: true },
  recurrence: null,
  verificationLevel: "trusted_partner",
  rawPayload: { uid: "ucsf-grand-rounds-12345" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "ical:ucsf",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("UCSF adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("ical:ucsf");
    expect(adapter.tier).toBe("ical");
    expect(adapter.verificationLevel).toBe("trusted_partner");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("ical:ucsf");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("lectures");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("trusted_partner");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("UCSF Parnassus Campus");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // B7: normalize is pure — same input + same provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });
});
