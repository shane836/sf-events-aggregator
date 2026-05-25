import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildRawEvent,
  isMissionCard,
  parseFoodwiseDateLine,
  parseListingHtml,
} from "@/lib/sources/missionmarket";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const TZ = "America/Los_Angeles";

const fetchedAt = new Date("2026-05-25T17:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:missionmarket",
    externalId: "dia-de-los-muertos-and-halloween-at-mission-community-market",
    sourceUrl:
      "https://foodwise.org/events/dia-de-los-muertos-and-halloween-at-mission-community-market/",
  },
  title: "Día de los Muertos and Halloween at Mission Community Market",
  description: null,
  // Thursday, October 29, 2026, 3:00 pm PT (PDT, UTC-7) -> 22:00 UTC.
  startTimeUtc: new Date("2026-10-29T22:00:00Z"),
  endTimeUtc: new Date("2026-10-30T02:00:00Z"),
  timezone: TZ,
  venue: {
    name: "Mission Community Market",
    address: "Bartlett Street between 21st & 22nd, San Francisco, CA",
    neighborhood: "Mission",
    lat: 37.7558,
    lng: -122.4192,
    timezone: TZ,
  },
  primaryCategory: "food",
  pricing: { isFree: true },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: {
    slug: "dia-de-los-muertos-and-halloween-at-mission-community-market",
  },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:missionmarket",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T17:00:00Z"),
};

describe("Mission Community Market adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:missionmarket");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:missionmarket");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("food");
    expect(norm.timezone).toBe(TZ);
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Mission Community Market");
    expect(norm.venue.neighborhood).toBe("Mission");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure — same input + same provenance → identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant) and never points at the parked domain", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.identity.sourceUrl).toMatch(/^https:\/\/foodwise\.org\//);
    expect(norm.identity.sourceUrl).not.toMatch(/missioncommunitymarket\.org/);
  });

  it("emits structured pricing for free public events (D13)", () => {
    const norm = adapter.normalize(sample, provenance);
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.isFree).toBe(true);
  });
});

describe("parseFoodwiseDateLine", () => {
  it("parses a same-day PDT range with shorthand end (3:00 pm - 7:00 pm)", () => {
    const r = parseFoodwiseDateLine(
      "Thursday, October 29, 2026, 3:00 pm - 7:00 pm",
    );
    expect(r).not.toBeNull();
    // October is still PDT (DST ends ~Nov 1).
    expect(r!.startUtc.toISOString()).toBe("2026-10-29T22:00:00.000Z");
    expect(r!.endUtc!.toISOString()).toBe("2026-10-30T02:00:00.000Z");
  });

  it("parses a PST date (after DST ends in November)", () => {
    // Thursday Nov 12, 2026 3:00 pm PST (UTC-8) -> 23:00 UTC.
    const r = parseFoodwiseDateLine(
      "Thursday, November 12, 2026, 3:00 pm - 7:00 pm",
    );
    expect(r).not.toBeNull();
    expect(r!.startUtc.toISOString()).toBe("2026-11-12T23:00:00.000Z");
    expect(r!.endUtc!.toISOString()).toBe("2026-11-13T03:00:00.000Z");
  });

  it("parses a multi-day range with two full date tokens", () => {
    const r = parseFoodwiseDateLine(
      "Saturday, July 4, 2026, 12:00 pm - Saturday, August 8, 2026, 12:00 pm",
    );
    expect(r).not.toBeNull();
    expect(r!.startUtc.toISOString()).toBe("2026-07-04T19:00:00.000Z");
    expect(r!.endUtc!.toISOString()).toBe("2026-08-08T19:00:00.000Z");
  });

  it("treats a 12:00 am close as next-day midnight", () => {
    const r = parseFoodwiseDateLine(
      "Saturday, July 4, 2026, 8:00 am - 12:00 am",
    );
    expect(r).not.toBeNull();
    // 8am PDT July 4 -> 15:00 UTC; 12am wraps to 07:00 UTC July 5.
    expect(r!.startUtc.toISOString()).toBe("2026-07-04T15:00:00.000Z");
    expect(r!.endUtc!.toISOString()).toBe("2026-07-05T07:00:00.000Z");
  });

  it("returns null on malformed input", () => {
    expect(parseFoodwiseDateLine("")).toBeNull();
    expect(parseFoodwiseDateLine("not a date")).toBeNull();
    expect(parseFoodwiseDateLine("Mars 99, 2026, 25:99 pm")).toBeNull();
  });
});

describe("isMissionCard", () => {
  it("matches the Mission location tag exactly", () => {
    expect(isMissionCard("Market Happening, Mission")).toBe(true);
    expect(isMissionCard("Mission")).toBe(true);
  });

  it("does not match non-Mission cards", () => {
    expect(isMissionCard("Market Happening, Ferry Plaza")).toBe(false);
    expect(isMissionCard("Foodwise Demo, Ferry Plaza")).toBe(false);
    expect(isMissionCard("")).toBe(false);
  });

  it("does not falsely match other 'Mission ___' tokens", () => {
    expect(isMissionCard("Market Happening, Mission Bay")).toBe(false);
    expect(isMissionCard("Mission District Tour")).toBe(false);
  });
});

describe("buildRawEvent", () => {
  it("emits a RawEvent with venue locked to MCM and free pricing", () => {
    const item = {
      slug: "mission-community-market-last-day-of-the-season",
      title: "Mission Community Market Last Day of the Season",
      url: "https://foodwise.org/events/mission-community-market-last-day-of-the-season/",
      typeTags: "Market Happening, Mission",
      dateText: "Thursday, November 12, 2026, 3:00 pm - 7:00 pm",
    };
    const raw = buildRawEvent(item, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.identity.source).toBe("scrape:missionmarket");
    expect(raw!.identity.externalId).toBe(item.slug);
    expect(raw!.identity.sourceUrl).toBe(item.url);
    expect(raw!.title).toBe(item.title);
    expect(raw!.timezone).toBe(TZ);
    expect(raw!.primaryCategory).toBe("food");
    expect(raw!.verificationLevel).toBe("official");
    expect(raw!.pricing).toEqual({ isFree: true });
    expect(raw!.venue.name).toBe("Mission Community Market");
    expect(raw!.venue.neighborhood).toBe("Mission");
    expect(raw!.startTimeUtc.toISOString()).toBe("2026-11-12T23:00:00.000Z");
  });

  it("returns null when the date line can't be parsed", () => {
    const item = {
      slug: "bad-event",
      title: "Bad Event",
      url: "https://foodwise.org/events/bad-event/",
      typeTags: "Market Happening, Mission",
      dateText: "TBD",
    };
    expect(buildRawEvent(item, fetchedAt)).toBeNull();
  });
});

describe("Mission Community Market fixture parsing (regression)", () => {
  it("extracts every event card from the saved Foodwise listing", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/missionmarket.html"),
      "utf-8",
    );
    const items = parseListingHtml(html);
    // The Foodwise events listing renders ~10-14 cards on page 1.
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const it of items) {
      expect(it.url.startsWith("https://foodwise.org/events/")).toBe(true);
      expect(it.title.length).toBeGreaterThan(0);
      expect(it.dateText.length).toBeGreaterThan(0);
    }
  });

  it("isolates >= 1 Mission-tagged card from the fixture (this is why this adapter exists)", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/missionmarket.html"),
      "utf-8",
    );
    const items = parseListingHtml(html);
    const mission = items.filter((it) => isMissionCard(it.typeTags));
    expect(mission.length).toBeGreaterThanOrEqual(1);

    // Every Mission-tagged card should be liftable into a RawEvent.
    const fingerprints = new Set<string>();
    for (const it of mission) {
      const raw = buildRawEvent(it, fetchedAt);
      expect(raw).not.toBeNull();
      // D1: source_url is set
      expect(raw!.identity.sourceUrl.length).toBeGreaterThan(0);
      // Source URL points at the live foodwise.org page, NOT the parked
      // missioncommunitymarket.org domain (the bug we're fixing).
      expect(raw!.identity.sourceUrl).toMatch(/^https:\/\/foodwise\.org\//);
      // D2: structured pricing (isFree=true)
      expect(raw!.pricing?.isFree).toBe(true);
      const norm = adapter.normalize(raw!, provenance);
      fingerprints.add(norm.canonicalFingerprint);
    }
    // Distinct events → distinct fingerprints.
    expect(fingerprints.size).toBe(mission.length);
  });
});
