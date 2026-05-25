import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildRawEvent,
  parseSections,
  resolveYears,
  pacificWallTimeToUtc,
  type ParsedSection,
} from "@/lib/sources/bimbos";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const provenance: Provenance = {
  adapterId: "scrape:bimbos",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

const sample: RawEvent = {
  identity: {
    source: "scrape:bimbos",
    externalId: "2026-06-11-https://bimbos365club.com/tm-event/naomi-scott/",
    sourceUrl: "https://bimbos365club.com/tm-event/naomi-scott/",
  },
  title: "Naomi Scott",
  description: "Another Planet presents F.I.G Tour. Naomi Scott",
  startTimeUtc: new Date("2026-06-12T03:00:00Z"), // 8pm PDT = 03:00 UTC next day
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "Bimbo's 365 Club",
    neighborhood: "North Beach",
    address: "1025 Columbus Ave, San Francisco, CA 94133",
    lat: 37.804154,
    lng: -122.415291,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "music",
  pricing: { priceMin: 25, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { title: "Naomi Scott" },
  fetchedAt,
};

describe("Bimbo's adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:bimbos");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:bimbos");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("Naomi Scott");
    expect(norm.category).toBe("music");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Bimbo's 365 Club");
    expect(norm.venue.neighborhood).toBe("North Beach");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize is pure — same input + same provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing satisfying M3 D2 invariant", () => {
    const norm = adapter.normalize(sample, provenance);
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.priceMin).toBe(25);
    expect(norm.pricing.isFree).toBe(false);
  });

  it("produces distinct fingerprints for same-night 7pm vs 9:30pm shows", () => {
    const sevenPm = adapter.normalize(
      {
        ...sample,
        startTimeUtc: new Date("2026-06-12T02:00:00Z"), // 7pm PDT
        identity: { ...sample.identity, externalId: sample.identity.externalId + "#7" },
      },
      provenance,
    );
    const nineThirty = adapter.normalize(
      {
        ...sample,
        startTimeUtc: new Date("2026-06-12T04:30:00Z"), // 9:30pm PDT
        identity: { ...sample.identity, externalId: sample.identity.externalId + "#930" },
      },
      provenance,
    );
    expect(sevenPm.canonicalFingerprint).not.toBe(nineThirty.canonicalFingerprint);
  });
});

describe("pacificWallTimeToUtc", () => {
  it("converts an 8pm PDT show on June 11 2026 to the right UTC instant", () => {
    // June is PDT (UTC-7). 8:00pm PDT = 03:00 UTC next day.
    const utc = pacificWallTimeToUtc(2026, 5, 11, 20, 0);
    expect(utc.toISOString()).toBe("2026-06-12T03:00:00.000Z");
  });

  it("converts a January 15 8pm PST to the right UTC instant", () => {
    // January is PST (UTC-8). 8:00pm PST = 04:00 UTC next day.
    const utc = pacificWallTimeToUtc(2026, 0, 15, 20, 0);
    expect(utc.toISOString()).toBe("2026-01-16T04:00:00.000Z");
  });
});

describe("resolveYears", () => {
  const now = new Date("2026-05-25T00:00:00Z"); // May 2026

  it("assigns the current year when sections are within the same year", () => {
    const sections = [
      { monthIdx: 5, day: 11 }, // June
      { monthIdx: 7, day: 1 },  // August
      { monthIdx: 11, day: 31 }, // December
    ];
    expect(resolveYears(sections, now)).toEqual([2026, 2026, 2026]);
  });

  it("rolls year forward when the month sequence wraps from Dec to Jan", () => {
    const sections = [
      { monthIdx: 11, day: 15 }, // December 2026
      { monthIdx: 0, day: 5 },   // January 2027
      { monthIdx: 2, day: 20 },  // March 2027
    ];
    expect(resolveYears(sections, now)).toEqual([2026, 2027, 2027]);
  });

  it("starts at next year when the first section is before 'now' month", () => {
    const sections = [{ monthIdx: 1, day: 10 }]; // February (before May)
    expect(resolveYears(sections, now)).toEqual([2027]);
  });

  it("handles empty input", () => {
    expect(resolveYears([], now)).toEqual([]);
  });
});

describe("parseSections", () => {
  it("extracts a section from a minimal HTML snippet", () => {
    const html = `
      <div id="tw-responsive">
        <div class="tw-section">
          <span class="tw-event-month">June</span>
          <span class="tw-event-date">11</span>
          <div class="tw-prefix">Another Planet presents</div>
          <div class="tw-name"><a href="https://bimbos365club.com/tm-event/naomi-scott/">Naomi Scott</a></div>
          <div class="tw-date-time">
            <span class="tw-event-door-time">7:00 pm</span>
            <span class="tw-event-time">8:00 pm</span>
          </div>
          <div class="tw-info-price-buy-tix">
            <a href="https://www.ticketweb.com/event/naomi-scott-bimbos-365-club-tickets/14800813" class="tw-buy-tix-btn">Buy</a>
          </div>
        </div>
      </div>
    `;
    const sections = parseSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].monthIdx).toBe(5);
    expect(sections[0].day).toBe(11);
    expect(sections[0].hour24).toBe(20);
    expect(sections[0].minute).toBe(0);
    expect(sections[0].title).toBe("Naomi Scott");
    expect(sections[0].prefix).toBe("Another Planet presents");
    expect(sections[0].detailUrl).toBe("https://bimbos365club.com/tm-event/naomi-scott/");
    expect(sections[0].buyUrl).toContain("ticketweb.com");
  });

  it("skips sections with missing required fields", () => {
    const html = `
      <div id="tw-responsive">
        <div class="tw-section">
          <span class="tw-event-month">June</span>
          <span class="tw-event-date">11</span>
        </div>
      </div>
    `;
    expect(parseSections(html)).toHaveLength(0);
  });
});

describe("buildRawEvent", () => {
  it("constructs a RawEvent with the right venue and identity", () => {
    const section: ParsedSection = {
      monthIdx: 5,
      day: 11,
      hour24: 20,
      minute: 0,
      title: "Naomi Scott",
      prefix: "Another Planet presents",
      detailUrl: "https://bimbos365club.com/tm-event/naomi-scott/",
      buyUrl: "https://www.ticketweb.com/event/x/1",
    };
    const ev = buildRawEvent(section, 2026, fetchedAt);
    expect(ev.identity.source).toBe("scrape:bimbos");
    expect(ev.identity.sourceUrl).toBe(section.detailUrl);
    expect(ev.identity.externalId).toContain("2026-06-11");
    expect(ev.title).toBe("Naomi Scott");
    expect(ev.primaryCategory).toBe("music");
    expect(ev.venue.name).toBe("Bimbo's 365 Club");
    expect(ev.venue.neighborhood).toBe("North Beach");
    expect(ev.pricing?.priceMin).toBe(25);
    expect(ev.pricing?.isFree).toBe(false);
    expect(ev.timezone).toBe("America/Los_Angeles");
    expect(ev.startTimeUtc.toISOString()).toBe("2026-06-12T03:00:00.000Z");
  });
});

describe("Bimbo's fixture parsing (regression)", () => {
  it("extracts >= 10 events from the saved HTML fixture", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/bimbos.html"),
      "utf-8",
    );
    const sections = parseSections(html);
    expect(sections.length).toBeGreaterThanOrEqual(10);

    const now = new Date("2026-05-25T00:00:00Z");
    const years = resolveYears(sections, now);
    const fingerprints = new Set<string>();
    for (let i = 0; i < sections.length; i++) {
      const ev = buildRawEvent(sections[i], years[i], fetchedAt);
      const norm = adapter.normalize(ev, provenance);
      expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(norm.category).toBe("music");
      expect(norm.timezone).toBe("America/Los_Angeles");
      expect(norm.pricing.priceMin).toBe(25);
      fingerprints.add(norm.canonicalFingerprint);
    }
    // Each event should have a distinct fingerprint.
    expect(fingerprints.size).toBe(sections.length);
  });
});
