import { describe, expect, it } from "vitest";
import adapter, {
  buildStartUtc,
  parseMonthDay,
  parseTimeOfDay,
} from "@/lib/sources/odc";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:odc",
    externalId:
      "https://odcsf.my.salesforce-sites.com/ticket/#/events/abc@2026-05-29T02:30",
  },
  // identity.sourceUrl filled below for clarity
  // (placed inline so the spread below doesn't trip ts-noUncheckedIndexedAccess)
  // eslint-disable-next-line
  title: "RAWdance: CONCEPT series #21",
  description: null,
  startTimeUtc: new Date("2026-05-29T02:30:00Z"), // 7:30PM PT on 5/28
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "ODC Theater",
    neighborhood: "Mission",
    address: "3153 17th St, San Francisco, CA 94110",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "dancing",
  pricing: { priceMin: null, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { dateLabel: "5/28", timeLabel: "7:30PM", href: "x" },
  fetchedAt,
} as RawEvent;
sample.identity.sourceUrl =
  "https://odcsf.my.salesforce-sites.com/ticket/#/events/abc";

const provenance: Provenance = {
  adapterId: "scrape:odc",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("ODC adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:odc");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes raw → DB-ready row with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:odc");
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("dancing");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.venue.name).toBe("ODC Theater");
    expect(norm.venue.neighborhood).toBe("Mission");
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);

    // pure: same input + provenance → byte-identical
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("never produces an empty source_url (D12)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing (D13)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.pricing).toBeDefined();
    expect(typeof norm.pricing.isFree).toBe("boolean");
  });
});

describe("ODC helpers", () => {
  it("parses M/D date strings", () => {
    expect(parseMonthDay("5/29")).toEqual({ month: 5, day: 29 });
    expect(parseMonthDay("12/1")).toEqual({ month: 12, day: 1 });
    expect(parseMonthDay("13/1")).toBeNull();
    expect(parseMonthDay("abc")).toBeNull();
  });

  it("parses ODC time-of-day labels", () => {
    expect(parseTimeOfDay("7:30PM")).toEqual({ hour: 19, minute: 30 });
    expect(parseTimeOfDay("11:45AM")).toEqual({ hour: 11, minute: 45 });
    expect(parseTimeOfDay("12:00PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseTimeOfDay("12:00AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay("8PM")).toEqual({ hour: 20, minute: 0 });
    expect(parseTimeOfDay("nope")).toBeNull();
  });

  it("builds a UTC instant for an LA wall-clock time", () => {
    // 5/29 7:30PM PT in DST (PDT, UTC-7) → 2026-05-30 02:30Z
    const utc = buildStartUtc(fetchedAt, 5, 29, { hour: 19, minute: 30 });
    expect(utc?.toISOString()).toBe("2026-05-30T02:30:00.000Z");
  });

  it("rolls forward to next year for dates >60 days in the past", () => {
    // now = 2026-05-25. 1/15 is ~130 days back → should resolve to 2027-01-15
    const utc = buildStartUtc(fetchedAt, 1, 15, { hour: 20, minute: 0 });
    expect(utc?.getUTCFullYear()).toBe(2027);
  });
});
