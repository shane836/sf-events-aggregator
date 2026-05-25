import { describe, expect, it } from "vitest";
import adapter, { expandThursdays } from "@/lib/sources/missionmarket";
import { formatLocalDate, formatLocalMinute } from "@/lib/identity";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const TZ = "America/Los_Angeles";

const fetchedAt = new Date("2026-05-25T17:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:missionmarket",
    externalId: "mcm-thursday-2026-05-28",
    sourceUrl: "https://missioncommunitymarket.org",
  },
  title: "Mission Community Market — Thursday Farmers' Market",
  description: "Weekly outdoor farmers' market on Bartlett Street.",
  // 2026-05-28 15:00 PT (PDT, UTC-7) === 22:00 UTC
  startTimeUtc: new Date("2026-05-28T22:00:00Z"),
  endTimeUtc: new Date("2026-05-29T02:00:00Z"),
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
  recurrence: {
    seriesId: "scrape:missionmarket:thursday-market",
    occurrenceId: "2026-05-28",
  },
  verificationLevel: "official",
  rawPayload: { localDate: "2026-05-28", listingStatus: 200, listingBytes: 870 },
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
    expect(norm.recurrence?.seriesId).toBe(
      "scrape:missionmarket:thursday-market",
    );
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure — same input + same provenance → identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("never produces an empty source_url (D12) or unstructured pricing (D13)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    // Structured pricing: free events have isFree:true, no string price.
    expect(norm.pricing.isFree).toBe(true);
  });
});

describe("Mission Community Market schedule expansion", () => {
  it("emits only Thursdays within the horizon", () => {
    const from = new Date("2026-05-25T17:00:00Z"); // Mon 2026-05-25 10am PT
    const occurrences = expandThursdays(from, 60);

    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.length).toBeLessThanOrEqual(10); // ~8-9 Thursdays in 60d

    for (const occ of occurrences) {
      // localDate is a Thursday in PT
      const [y, m, d] = occ.localDate.split("-").map(Number);
      const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
      expect(noonUtc.getUTCDay()).toBe(4); // Thursday
      // start is 3pm local; end is 7pm local
      expect(formatLocalMinute(occ.startUtc, TZ)).toBe(`${occ.localDate}T15:00`);
      expect(formatLocalMinute(occ.endUtc, TZ)).toBe(`${occ.localDate}T19:00`);
      // formatLocalDate of the start matches the labelled local date
      expect(formatLocalDate(occ.startUtc, TZ)).toBe(occ.localDate);
    }
  });

  it("skips an in-progress Thursday whose 7pm window has already closed", () => {
    // Thursday 2026-05-28 at 11pm PT === 2026-05-29 06:00 UTC
    const lateThursday = new Date("2026-05-29T06:00:00Z");
    const occurrences = expandThursdays(lateThursday, 14);
    // The first occurrence should NOT be the already-closed 2026-05-28
    expect(occurrences[0].localDate).not.toBe("2026-05-28");
  });

  it("includes a Thursday whose market window is still open", () => {
    // Thursday 2026-05-28 at 4pm PT (during market hours) === 2026-05-28 23:00 UTC
    const duringMarket = new Date("2026-05-28T23:00:00Z");
    const occurrences = expandThursdays(duringMarket, 14);
    expect(occurrences[0].localDate).toBe("2026-05-28");
  });

  it("produces fingerprints that differ per occurrence", () => {
    const from = new Date("2026-05-25T17:00:00Z");
    const occurrences = expandThursdays(from, 30);
    const fps = new Set<string>();
    for (const occ of occurrences) {
      const raw: RawEvent = {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: `mcm-thursday-${occ.localDate}`,
        },
        startTimeUtc: occ.startUtc,
        endTimeUtc: occ.endUtc,
        recurrence: {
          seriesId: "scrape:missionmarket:thursday-market",
          occurrenceId: occ.localDate,
        },
      };
      const norm = adapter.normalize(raw, provenance);
      fps.add(norm.canonicalFingerprint);
    }
    expect(fps.size).toBe(occurrences.length);
  });
});
