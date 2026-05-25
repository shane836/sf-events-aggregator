import { describe, expect, it } from "vitest";
import adapter from "@/lib/sources/alonzoking";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:alonzoking",
    externalId: "pre-professional-summer-program-showcase",
    sourceUrl:
      "https://linesballet.org/event/pre-professional-summer-program-showcase/",
  },
  title: "Pre-Professional Summer Program Showcase",
  description:
    "Experience the beauty and artistry of amazing young dancers from across the U.S.",
  startTimeUtc: new Date("2026-06-28T03:00:00Z"), // 8pm PDT on 2026-06-27
  endTimeUtc: new Date("2026-06-28T04:30:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "The Cowell Theater at Pier 2",
    neighborhood: "Marina / Fort Mason",
    address: "2 Marina Boulevard, San Francisco, CA, 94123",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "dancing",
  pricing: { priceMin: 0, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: {
    url: "https://linesballet.org/event/pre-professional-summer-program-showcase/",
    name: "Pre-Professional Summer Program Showcase",
    startDate: "2026-06-27T20:00:00-07:00",
    endDate: "2026-06-27T21:30:00-07:00",
    locationName: "The Cowell Theater at Pier 2",
  },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:alonzoking",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Alonzo King LINES Ballet adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:alonzoking");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:alonzoking");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("dancing");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("The Cowell Theater at Pier 2");
    expect(norm.venue.neighborhood).toBe("Marina / Fort Mason");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // pure: same input + same provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.identity.sourceUrl).toContain("linesballet.org");
  });

  it("emits structured pricing that survives D2 (price_min || price_max || is_free)", () => {
    const norm = adapter.normalize(sample, provenance);
    const { priceMin, priceMax, isFree } = norm.pricing;
    const d2Survives = priceMin != null || priceMax != null || isFree === true;
    expect(d2Survives).toBe(true);
  });

  it("produces distinct fingerprints for same-act-same-venue, different times (camp series)", () => {
    const day1 = adapter.normalize(sample, provenance);
    const day2 = adapter.normalize(
      {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: "pre-professional-summer-program-showcase-2",
          sourceUrl:
            "https://linesballet.org/event/pre-professional-summer-program-showcase-2/",
        },
        startTimeUtc: new Date("2026-06-29T03:00:00Z"),
      },
      provenance,
    );
    expect(day1.canonicalFingerprint).not.toBe(day2.canonicalFingerprint);
  });
});
