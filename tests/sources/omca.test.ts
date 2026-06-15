import { describe, expect, it } from "vitest";
import adapter, { classifyCategory } from "@/lib/sources/omca";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "ical:omca",
    externalId: "omca-friday-nights-20260605",
    sourceUrl: "https://museumca.org/events/friday-nights-at-omca/",
  },
  title: "Friday Nights at OMCA with Off the Grid",
  description: "Food trucks, live music, and hands-on art. Free admission.",
  startTimeUtc: new Date("2026-06-06T00:00:00Z"), // 5pm PT Fri
  endTimeUtc: new Date("2026-06-06T04:00:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "Oakland Museum of California",
    city: "Oakland",
    neighborhood: "Lake Merritt",
    address: "1000 Oak St, Oakland, CA 94607",
    lat: 37.7975,
    lng: -122.264,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "food",
  pricing: { priceMin: null, priceMax: null, isFree: true },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { uid: "omca-friday-nights-20260605" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "ical:omca",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("OMCA adapter — identity", () => {
  it("advertises an Oakland iCal source", () => {
    expect(adapter.id).toBe("ical:omca");
    expect(adapter.tier).toBe("ical");
    expect(adapter.verificationLevel).toBe("official");
  });
});

describe("OMCA adapter — normalize", () => {
  it("tags the venue's city as Oakland and is pure", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("ical:omca");
    expect(norm.venue.city).toBe("Oakland");
    expect(norm.venue.name).toBe("Oakland Museum of California");
    expect(norm.category).toBe("food");
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);

    // normalize is pure — same input + provenance → byte-identical output
    expect(adapter.normalize(sample, provenance)).toEqual(norm);
  });

  it("preserves a non-empty sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });
});

describe("classifyCategory", () => {
  it("maps Off the Grid / Friday Nights to food", () => {
    expect(
      classifyCategory("Friday Nights at OMCA with Off the Grid", null),
    ).toBe("food");
    expect(classifyCategory("Lunar New Year Food Truck Festival", null)).toBe(
      "food",
    );
  });

  it("maps talks and gallery chats to lectures", () => {
    expect(classifyCategory("Gallery Chats at OMCA", null)).toBe("lectures");
    expect(
      classifyCategory("Curator Talk: California Cool", "A panel discussion."),
    ).toBe("lectures");
  });

  it("maps concerts / performances to music", () => {
    expect(classifyCategory("Live Music in the Gardens", null)).toBe("music");
    expect(classifyCategory("Evening Concert Series", null)).toBe("music");
  });

  it("maps dance programming to dancing", () => {
    expect(
      classifyCategory("Spotlight Sundays: Community Dance Ritual", null),
    ).toBe("dancing");
  });

  it("returns null for events outside the taxonomy", () => {
    expect(classifyCategory("Members-Only Exhibition Preview", null)).toBeNull();
    expect(classifyCategory("Museum Store Holiday Sale", null)).toBeNull();
  });
});
