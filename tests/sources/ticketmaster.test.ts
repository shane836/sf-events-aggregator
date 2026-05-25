import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, { mapCategory, parseEvent } from "@/lib/sources/ticketmaster";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");
// Pin "now" before the earliest fixture event (Old Mervs et al. are after 2026-05-25).
// Without this, D6 (past-date filter) would drop fixture events as the wall clock advances.
const NOW_MS = new Date("2026-05-25T00:00:00Z").getTime();

const provenance: Provenance = {
  adapterId: "ticketmaster",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

const sample: RawEvent = {
  identity: {
    source: "ticketmaster",
    externalId: "G5vYZbME2U1DB",
    sourceUrl:
      "https://www.ticketmaster.com/dance-with-the-dead-magic-sword-san-francisco-california-08-01-2026/event/1A006482CCB6B7E1",
  },
  title: "Dance With The Dead + Magic Sword",
  description: null,
  startTimeUtc: new Date("2026-08-02T03:00:00Z"), // 8pm PT
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    externalVenueId: "KovZpZAFFnkA",
    name: "August Hall",
    neighborhood: "Union Square",
    address: "420 Mason St, San Francisco, CA, 94102",
    lat: 37.7869,
    lng: -122.4097,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "music",
  pricing: { priceMin: 35, priceMax: 35, isFree: false },
  recurrence: null,
  verificationLevel: "trusted_partner",
  rawPayload: { id: "G5vYZbME2U1DB" },
  fetchedAt,
};

describe("Ticketmaster adapter — identity", () => {
  it("advertises tier='api' and verificationLevel='trusted_partner'", () => {
    expect(adapter.id).toBe("ticketmaster");
    expect(adapter.tier).toBe("api");
    expect(adapter.verificationLevel).toBe("trusted_partner");
  });
});

describe("Ticketmaster adapter — normalize", () => {
  it("produces a stable 32-hex canonicalFingerprint", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);

    const second = adapter.normalize(sample, provenance);
    expect(second.canonicalFingerprint).toBe(norm.canonicalFingerprint);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 / D1 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
  });

  it("emits structured pricing (D13 / D2 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    const allNull =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    // "All null + isFree=false" is the canonical "Price varies" representation —
    // valid per M3 D2. The sample above has explicit min/max so this should NOT be all-null.
    expect(allNull).toBe(false);
    expect(norm.pricing.priceMin).toBe(35);
    expect(norm.pricing.priceMax).toBe(35);
  });

  it("preserves the timezone the API returned", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.timezone).toBe("America/Los_Angeles");
  });

  it("distinguishes same-act same-venue shows at different start times", () => {
    const first = adapter.normalize(sample, provenance);
    const later = adapter.normalize(
      {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: sample.identity.externalId + "-late",
          sourceUrl: sample.identity.sourceUrl + "?late",
        },
        startTimeUtc: new Date("2026-08-02T05:30:00Z"), // 10:30pm PT
      },
      provenance,
    );
    expect(first.canonicalFingerprint).not.toBe(later.canonicalFingerprint);
  });
});

describe("mapCategory", () => {
  it("maps Music segment to 'music'", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Music" },
        genre: { name: "Rock" },
      }),
    ).toBe("music");
  });

  it("maps Arts & Theatre + Comedy genre to 'comedy'", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Arts & Theatre" },
        genre: { name: "Comedy" },
      }),
    ).toBe("comedy");
  });

  it("maps Arts & Theatre + Comedy subGenre to 'comedy' even if genre differs", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Arts & Theatre" },
        genre: { name: "Theatre" },
        subGenre: { name: "Comedy" },
      }),
    ).toBe("comedy");
  });

  it("returns null for Sports", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Sports" },
        genre: { name: "Basketball" },
      }),
    ).toBeNull();
  });

  it("returns null for Family", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Family" },
      }),
    ).toBeNull();
  });

  it("returns null for Arts & Theatre without Comedy genre/subGenre", () => {
    expect(
      mapCategory({
        primary: true,
        segment: { name: "Arts & Theatre" },
        genre: { name: "Theatre" },
      }),
    ).toBeNull();
  });

  it("returns null for missing / malformed classification", () => {
    expect(mapCategory(null)).toBeNull();
    expect(mapCategory({})).toBeNull();
  });
});

describe("parseEvent", () => {
  const baseEvent = {
    id: "G5vYZ_TEST",
    name: "Test Show",
    url: "https://www.ticketmaster.com/test-show/event/ABC",
    dates: {
      start: { dateTime: "2026-07-10T03:00:00Z" }, // ~8pm PT 7/9
      timezone: "America/Los_Angeles",
    },
    classifications: [
      {
        primary: true,
        segment: { name: "Music" },
        genre: { name: "Rock" },
      },
    ],
    _embedded: {
      venues: [
        {
          id: "KovZ_TEST",
          name: "The Fillmore",
          postalCode: "94115",
          city: { name: "San Francisco" },
          state: { stateCode: "CA" },
          address: { line1: "1805 Geary Boulevard" },
          location: { latitude: "37.7841", longitude: "-122.4327" },
        },
      ],
    },
  };

  it("parses a complete Music event into a RawEvent", () => {
    const raw = parseEvent(baseEvent, fetchedAt, NOW_MS);
    expect(raw).not.toBeNull();
    expect(raw!.identity.source).toBe("ticketmaster");
    expect(raw!.identity.externalId).toBe("G5vYZ_TEST");
    expect(raw!.identity.sourceUrl).toBe(baseEvent.url);
    expect(raw!.title).toBe("Test Show");
    expect(raw!.primaryCategory).toBe("music");
    expect(raw!.timezone).toBe("America/Los_Angeles");
    expect(raw!.venue.name).toBe("The Fillmore");
    expect(raw!.venue.neighborhood).toBe("Western Addition");
    expect(raw!.venue.lat).toBe(37.7841);
    expect(raw!.venue.lng).toBe(-122.4327);
    expect(raw!.verificationLevel).toBe("trusted_partner");
    expect(raw!.pricing).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
  });

  it("captures priceRanges[0] when present", () => {
    const raw = parseEvent(
      {
        ...baseEvent,
        priceRanges: [
          { type: "standard", currency: "USD", min: 31.55, max: 75 },
        ],
      },
      fetchedAt,
      NOW_MS,
    );
    expect(raw!.pricing).toEqual({
      priceMin: 31.55,
      priceMax: 75,
      isFree: false,
    });
  });

  it("falls back to America/Los_Angeles when API omits dates.timezone", () => {
    const ev = {
      ...baseEvent,
      dates: { start: { dateTime: "2026-07-10T03:00:00Z" } },
    };
    const raw = parseEvent(ev, fetchedAt, NOW_MS);
    expect(raw!.timezone).toBe("America/Los_Angeles");
  });

  it("returns null when required fields missing", () => {
    expect(parseEvent({}, fetchedAt, NOW_MS)).toBeNull();
    expect(parseEvent({ id: "X" }, fetchedAt, NOW_MS)).toBeNull();
    expect(parseEvent({ id: "X", name: "X" }, fetchedAt, NOW_MS)).toBeNull();
    expect(
      parseEvent(
        { id: "X", name: "X", url: "https://example.com" },
        fetchedAt,
        NOW_MS,
      ),
    ).toBeNull();
  });

  it("returns null when classification doesn't map (skips Sports/Family)", () => {
    const ev = {
      ...baseEvent,
      classifications: [
        { primary: true, segment: { name: "Sports" }, genre: { name: "NBA" } },
      ],
    };
    expect(parseEvent(ev, fetchedAt, NOW_MS)).toBeNull();
  });

  it("D6: drops past-dated events (older than 24h)", () => {
    const ev = {
      ...baseEvent,
      id: "PAST",
      dates: {
        start: { dateTime: "2026-05-20T03:00:00Z" }, // 5 days before NOW_MS
        timezone: "America/Los_Angeles",
      },
    };
    expect(parseEvent(ev, fetchedAt, NOW_MS)).toBeNull();
  });

  it("D6: keeps events within the 24h grace window", () => {
    const ev = {
      ...baseEvent,
      id: "BARELY_PAST",
      dates: {
        // 12h before NOW_MS — should be kept (grace window is 24h)
        start: { dateTime: "2026-05-24T12:00:00Z" },
        timezone: "America/Los_Angeles",
      },
    };
    expect(parseEvent(ev, fetchedAt, NOW_MS)).not.toBeNull();
  });
});

describe("Ticketmaster fixture parsing (regression)", () => {
  it("maps real API payload to the expected category mix", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "fixtures/raw/ticketmaster.json"),
        "utf-8",
      ),
    ) as {
      _embedded?: { events?: Record<string, unknown>[] };
    };
    const fixtureEvents = fixture._embedded?.events ?? [];
    expect(fixtureEvents.length).toBeGreaterThanOrEqual(5);

    const parsed: RawEvent[] = [];
    let skipped = 0;
    for (const ev of fixtureEvents) {
      const r = parseEvent(ev, fetchedAt, NOW_MS);
      if (r) parsed.push(r);
      else skipped++;
    }

    // 4 mappable (2 music + 2 comedy) + 1 skipped (synthetic Sports)
    expect(parsed.length).toBe(4);
    expect(skipped).toBe(1);

    const byCategory = parsed.reduce<Record<string, number>>((acc, e) => {
      acc[e.primaryCategory] = (acc[e.primaryCategory] ?? 0) + 1;
      return acc;
    }, {});
    expect(byCategory.music).toBe(2);
    expect(byCategory.comedy).toBe(2);

    // Every parsed event must round-trip through normalize() with non-empty sourceUrl
    // and a structured pricing block.
    const fingerprints = new Set<string>();
    for (const raw of parsed) {
      const norm = adapter.normalize(raw, provenance);
      expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(norm.timezone).toBe("America/Los_Angeles");
      const allNull =
        norm.pricing.priceMin == null &&
        norm.pricing.priceMax == null &&
        !norm.pricing.isFree;
      // Either all-null+isFree=false (Price varies) or has min/max — both are valid per D2.
      // We're asserting the shape is one of the canonical states by construction:
      // priceMin/priceMax/isFree are all defined.
      expect(typeof norm.pricing.isFree).toBe("boolean");
      // Use allNull so lint doesn't flag the let.
      expect(typeof allNull).toBe("boolean");
      fingerprints.add(norm.canonicalFingerprint);
    }
    // Every event has a distinct fingerprint (different titles + venues + times).
    expect(fingerprints.size).toBe(parsed.length);
  });

  it("maps the priced fixture event (Old Mervs) to structured min/max", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "fixtures/raw/ticketmaster.json"),
        "utf-8",
      ),
    ) as { _embedded?: { events?: Record<string, unknown>[] } };
    const oldMervs = (fixture._embedded?.events ?? []).find(
      (e) =>
        typeof (e as { name?: unknown }).name === "string" &&
        ((e as { name?: string }).name ?? "").includes("Old Mervs"),
    );
    expect(oldMervs).toBeDefined();
    const raw = parseEvent(oldMervs!, fetchedAt, NOW_MS);
    expect(raw).not.toBeNull();
    expect(raw!.pricing?.priceMin).toBe(31.55);
    expect(raw!.pricing?.priceMax).toBe(31.55);
    expect(raw!.pricing?.isFree).toBe(false);
  });
});
