import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, { mapEvent, slugify } from "@/lib/sources/offthegrid";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const TZ = "America/Los_Angeles";
const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:offthegrid",
    externalId: "salesforce-tower-2026-05-26",
    sourceUrl: "https://offthegrid.com/event/salesforce-tower/2026-05-26/11-00",
  },
  title: "Off the Grid: Salesforce Tower",
  description: "Outdoor food-truck market. Vendors include: El Fuego, Senor Sisig.",
  // 2026-05-26 11:00 PT (PDT, UTC-7) === 18:00 UTC
  startTimeUtc: new Date("2026-05-26T18:00:00Z"),
  endTimeUtc: new Date("2026-05-26T21:00:00Z"),
  timezone: TZ,
  venue: {
    name: "Off the Grid: Salesforce Tower",
    neighborhood: "SoMa",
    address: "415 Mission Street",
    lat: null,
    lng: null,
    timezone: TZ,
  },
  primaryCategory: "food",
  pricing: { isFree: true },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { id: "a1MPQ00000C6orI2AR", locationId: "x", vendorCount: 2 },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:offthegrid",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Off the Grid adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:offthegrid");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:offthegrid");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("food");
    expect(norm.timezone).toBe(TZ);
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Off the Grid: Salesforce Tower");
    expect(norm.venue.neighborhood).toBe("SoMa");
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure — same input + provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing with isFree=true (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.isFree).toBe(true);
  });
});

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("Salesforce Tower")).toBe("salesforce-tower");
    expect(slugify("Levi's Plaza")).toBe("levis-plaza");
    expect(slugify("Fort Mason Center")).toBe("fort-mason-center");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("  --foo   bar--  ")).toBe("foo-bar");
  });

  it("handles unicode by stripping diacritics", () => {
    expect(slugify("Café Münchner")).toBe("cafe-munchner");
  });
});

describe("mapEvent", () => {
  const baseEv = {
    id: "a1MPQ00000C6orI2AR",
    name: "Salesforce Plaza",
    startTime: "2026-05-26T11:00:00-07:00",
    endTime: "2026-05-26T14:00:00-07:00",
    locationId: "0016e00002o8dItAAI",
    locationName: "Off the Grid: Salesforce Tower",
    locationAddress: "415 Mission Street",
    locationCity: "San Francisco",
    creators: [
      { id: "x", name: "El Fuego", primaryCuisine: "Mexican" },
      { id: "y", name: "Senor Sisig", primaryCuisine: "Filipino" },
    ],
  };

  it("produces a RawEvent for a San Francisco market", () => {
    const raw = mapEvent(baseEv, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.identity.source).toBe("scrape:offthegrid");
    expect(raw!.identity.externalId).toBe("salesforce-tower-2026-05-26");
    expect(raw!.identity.sourceUrl).toMatch(/^https:\/\/offthegrid\.com\/event\//);
    expect(raw!.title).toBe("Off the Grid: Salesforce Tower");
    expect(raw!.timezone).toBe(TZ);
    expect(raw!.primaryCategory).toBe("food");
    expect(raw!.pricing?.isFree).toBe(true);
    expect(raw!.verificationLevel).toBe("official");
    expect(raw!.venue.neighborhood).toBe("SoMa");
    expect(raw!.venue.address).toBe("415 Mission Street");
    expect(raw!.description).toContain("El Fuego");
    expect(raw!.description).toContain("Senor Sisig");
    // Start time is 11am PDT == 18:00 UTC
    expect(raw!.startTimeUtc.toISOString()).toBe("2026-05-26T18:00:00.000Z");
    expect(raw!.endTimeUtc?.toISOString()).toBe("2026-05-26T21:00:00.000Z");
  });

  it("drops non-SF events (Sunnyvale, Oakland, etc.)", () => {
    expect(
      mapEvent({ ...baseEv, locationCity: "Sunnyvale" }, fetchedAt),
    ).toBeNull();
    expect(
      mapEvent({ ...baseEv, locationCity: "Oakland" }, fetchedAt),
    ).toBeNull();
    expect(
      mapEvent({ ...baseEv, locationCity: "Foster City" }, fetchedAt),
    ).toBeNull();
  });

  it("drops events with no start time", () => {
    expect(
      mapEvent({ ...baseEv, startTime: undefined as unknown as string }, fetchedAt),
    ).toBeNull();
    expect(
      mapEvent({ ...baseEv, startTime: "not-a-date" }, fetchedAt),
    ).toBeNull();
  });

  it("filters out events that started more than a day ago (D6 invariant)", () => {
    const longPast = {
      ...baseEv,
      startTime: "2026-05-01T11:00:00-07:00",
      endTime: "2026-05-01T14:00:00-07:00",
    };
    expect(mapEvent(longPast, fetchedAt)).toBeNull();
  });

  it("falls back to a derived venue name when locationName is missing", () => {
    const noLoc = { ...baseEv, locationName: undefined };
    const raw = mapEvent(noLoc, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.title).toContain("Off the Grid");
  });

  it("produces distinct externalIds per occurrence of the same market", () => {
    const day1 = mapEvent(baseEv, fetchedAt)!;
    const day2 = mapEvent(
      { ...baseEv, id: "different-id", startTime: "2026-06-02T11:00:00-07:00" },
      fetchedAt,
    )!;
    expect(day1.identity.externalId).not.toBe(day2.identity.externalId);
    // Same market name = same slug prefix, different date suffix
    expect(day1.identity.externalId.endsWith("2026-05-26")).toBe(true);
    expect(day2.identity.externalId.endsWith("2026-06-02")).toBe(true);
  });

  it("produces distinct canonical fingerprints for different occurrences", () => {
    const day1 = mapEvent(baseEv, fetchedAt)!;
    const day2 = mapEvent(
      { ...baseEv, id: "different-id", startTime: "2026-06-02T11:00:00-07:00" },
      fetchedAt,
    )!;
    const n1 = adapter.normalize(day1, provenance);
    const n2 = adapter.normalize(day2, provenance);
    expect(n1.canonicalFingerprint).not.toBe(n2.canonicalFingerprint);
  });
});

describe("Off the Grid fixture regression", () => {
  it("the saved JSON fixture parses and contains at least one SF event", () => {
    const raw = readFileSync(
      resolve(process.cwd(), "fixtures/raw/offthegrid.json"),
      "utf-8",
    );
    const payload = JSON.parse(raw) as {
      data?: { events?: Array<Parameters<typeof mapEvent>[0]> };
    };
    const events = payload?.data?.events ?? [];
    expect(events.length).toBeGreaterThan(0);

    // Map every event with a far-future fetchedAt so D6 doesn't drop the
    // fixture's now-historical dates (the fixture was captured 2026-05-24).
    const fixtureFetchedAt = new Date("2026-05-24T00:00:00Z");
    const mapped = events
      .map((e) => mapEvent(e, fixtureFetchedAt))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    expect(mapped.length).toBeGreaterThanOrEqual(1);
    for (const ev of mapped) {
      expect(ev.identity.source).toBe("scrape:offthegrid");
      expect(ev.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(ev.primaryCategory).toBe("food");
      expect(ev.pricing?.isFree).toBe(true);
      expect(ev.timezone).toBe(TZ);
    }

    // Every mapped event should have a unique canonicalFingerprint.
    const fps = new Set<string>();
    for (const ev of mapped) {
      const norm = adapter.normalize(ev, provenance);
      fps.add(norm.canonicalFingerprint);
    }
    expect(fps.size).toBe(mapped.length);
  });

  it("the HTML fixture is the SPA shell with site-wide JSON-LD", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/offthegrid.html"),
      "utf-8",
    );
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('<div id="root"></div>');
    expect(html.toLowerCase()).toContain("off the grid");
  });
});
