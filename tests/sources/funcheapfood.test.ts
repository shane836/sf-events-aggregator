import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildRawEvent,
  parseCost,
  parseListingHtml,
  parsePacificWallString,
} from "@/lib/sources/funcheapfood";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:funcheapfood",
    externalId: "1507663",
    sourceUrl:
      "https://sf.funcheap.com/foodieland-night-market-cow-palace-3/",
  },
  title: "FoodieLand Night Market 2026 at the Cow Palace (May 22-24)",
  description: null,
  // 2026-05-24 13:00 PT == 20:00 UTC (PDT = UTC-7).
  startTimeUtc: new Date("2026-05-24T20:00:00Z"),
  endTimeUtc: new Date("2026-05-25T05:00:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "Cow Palace",
    neighborhood: null,
    address: null,
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "food",
  pricing: { priceMin: 12, priceMax: 12, isFree: false },
  recurrence: null,
  verificationLevel: "community",
  rawPayload: { postId: "1507663" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:funcheapfood",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Funcheap Food adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:funcheapfood");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("community");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:funcheapfood");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("food");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("community");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Cow Palace");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize is pure — same input + same provenance → identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.priceMin).toBe(12);
    expect(norm.pricing.priceMax).toBe(12);
    expect(norm.pricing.isFree).toBe(false);
  });

  it("produces distinct fingerprints for same-title same-night different times", () => {
    const first = adapter.normalize(sample, provenance);
    const second = adapter.normalize(
      {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: sample.identity.externalId + "-evening",
        },
        startTimeUtc: new Date("2026-05-25T02:30:00Z"), // 7:30pm PT
      },
      provenance,
    );
    expect(first.canonicalFingerprint).not.toBe(second.canonicalFingerprint);
  });
});

describe("parsePacificWallString", () => {
  it("converts PDT wall times to UTC (UTC-7)", () => {
    // 2026-06-15 20:00 PT (PDT) -> 2026-06-16 03:00 UTC
    const utc = parsePacificWallString("2026-06-15 20:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-06-16T03:00:00.000Z");
  });

  it("converts PST wall times to UTC (UTC-8)", () => {
    // 2026-01-10 20:00 PT (PST) -> 2026-01-11 04:00 UTC
    const utc = parsePacificWallString("2026-01-10 20:00");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-01-11T04:00:00.000Z");
  });

  it("rejects malformed strings", () => {
    expect(parsePacificWallString("")).toBeNull();
    expect(parsePacificWallString("not-a-date")).toBeNull();
    expect(parsePacificWallString("2026-13-01 12:00")).toBeNull();
    expect(parsePacificWallString("2026-05-25 25:00")).toBeNull();
  });
});

describe("parseCost", () => {
  it("maps FREE to isFree=true", () => {
    expect(parseCost("FREE")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
    expect(parseCost("FREE*")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
  });

  it("maps a single dollar amount to priceMin=priceMax", () => {
    expect(parseCost("$12")).toEqual({
      priceMin: 12,
      priceMax: 12,
      isFree: false,
    });
    expect(parseCost("$44.99")).toEqual({
      priceMin: 44.99,
      priceMax: 44.99,
      isFree: false,
    });
  });

  it("falls back to $0 floor on null/unparseable cost (D2 keep-pass)", () => {
    expect(parseCost(null)).toEqual({
      priceMin: 0,
      priceMax: null,
      isFree: false,
    });
    expect(parseCost("varies")).toEqual({
      priceMin: 0,
      priceMax: null,
      isFree: false,
    });
  });
});

describe("buildRawEvent", () => {
  it("returns null when start time is missing/invalid", () => {
    const item = {
      postId: "abc",
      title: "Test",
      url: "https://sf.funcheap.com/test/",
      startLocal: "not-a-date",
      endLocal: null,
      costText: "FREE",
      venueName: "Somewhere",
    };
    expect(buildRawEvent(item, fetchedAt)).toBeNull();
  });

  it("uses title as venue fallback when no venueName parsed", () => {
    const item = {
      postId: "xyz",
      title: "Some Pop-up at Mission Bowling",
      url: "https://sf.funcheap.com/some-popup/",
      startLocal: "2026-06-15 19:00",
      endLocal: null,
      costText: "FREE",
      venueName: null,
    };
    const raw = buildRawEvent(item, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.venue.name).toBe("Some Pop-up at Mission Bowling");
  });

  it("sets timezone, category, and verification level correctly", () => {
    const item = {
      postId: "1507663",
      title: "FoodieLand Night Market",
      url: "https://sf.funcheap.com/foodieland-night-market-cow-palace-3/",
      startLocal: "2026-05-24 13:00",
      endLocal: "2026-05-24 22:00",
      costText: "$12",
      venueName: "Cow Palace",
    };
    const raw = buildRawEvent(item, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.timezone).toBe("America/Los_Angeles");
    expect(raw!.primaryCategory).toBe("food");
    expect(raw!.verificationLevel).toBe("community");
    expect(raw!.identity.source).toBe("scrape:funcheapfood");
    expect(raw!.identity.externalId).toBe("1507663");
    expect(raw!.pricing?.priceMin).toBe(12);
  });
});

describe("Funcheap Food fixture parsing (regression)", () => {
  it("extracts >= 10 events from the saved HTML fixture", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/funcheapfood.html"),
      "utf-8",
    );
    const items = parseListingHtml(html);
    expect(items.length).toBeGreaterThanOrEqual(10);

    const fingerprints = new Set<string>();
    let parsed = 0;
    for (const item of items) {
      const raw = buildRawEvent(item, fetchedAt);
      if (!raw) continue;
      parsed++;
      const norm = adapter.normalize(raw, provenance);
      expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(norm.category).toBe("food");
      expect(norm.timezone).toBe("America/Los_Angeles");
      // D2: not (priceMin null AND priceMax null AND isFree false)
      const noPriceData =
        norm.pricing.priceMin == null &&
        norm.pricing.priceMax == null &&
        !norm.pricing.isFree;
      expect(noPriceData).toBe(false);
      fingerprints.add(norm.canonicalFingerprint);
    }
    expect(parsed).toBeGreaterThanOrEqual(10);
    // Most parsed items should have distinct fingerprints.
    expect(fingerprints.size).toBeGreaterThanOrEqual(
      Math.floor(parsed * 0.5),
    );
  });

  it("emits at least one FREE event from the fixture (Funcheap is a free/cheap aggregator)", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/funcheapfood.html"),
      "utf-8",
    );
    const items = parseListingHtml(html);
    const freeCount = items
      .map((it) => parseCost(it.costText))
      .filter((p) => p.isFree).length;
    expect(freeCount).toBeGreaterThanOrEqual(1);
  });
});
