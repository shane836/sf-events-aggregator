import { describe, expect, it } from "vitest";
import adapter, {
  extractTimeArray,
  parseSimpleTixTime,
} from "@/lib/sources/secretimprov";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:secretimprov",
    externalId: "secret-improv-society-tickets-250887#1427317",
    sourceUrl:
      "https://www.simpletix.com/e/secret-improv-society-tickets-250887",
  },
  title: "Secret Improv Society",
  description: "Long-running short-form improv comedy show.",
  // Fri, May 29, 2026 8:00 PM PT == 03:00 UTC the next day (PDT, UTC-7).
  startTimeUtc: new Date("2026-05-30T03:00:00Z"),
  endTimeUtc: new Date("2026-05-30T04:30:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "Shelton Theater",
    neighborhood: "Union Square",
    address: "533 Sutter Street, San Francisco, California, 94102",
    lat: 37.78895568847656,
    lng: -122.40911865234375,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "comedy",
  pricing: { priceMin: 27.38, priceMax: 27.38, isFree: false },
  recurrence: {
    seriesId: "secret-improv-society-tickets-250887",
    occurrenceId: "1427317",
  },
  verificationLevel: "official",
  rawPayload: {
    seriesId: "secret-improv-society-tickets-250887",
    occurrenceId: "1427317",
  },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:secretimprov",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Secret Improv Society adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:secretimprov");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:secretimprov");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("Secret Improv Society");
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.priceMin).toBe(27.38);
    expect(norm.pricing.priceMax).toBe(27.38);
    expect(norm.pricing.isFree).toBe(false);
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toEqual(sample.endTimeUtc);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Shelton Theater");
    expect(norm.venue.neighborhood).toBe("Union Square");
    expect(norm.recurrence?.seriesId).toBe(
      "secret-improv-society-tickets-250887",
    );
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure — same input + same provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("produces structured pricing (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    const { priceMin, priceMax, isFree } = norm.pricing;
    const hasStructuredPrice =
      isFree === true || priceMin !== null || priceMax !== null;
    expect(hasStructuredPrice).toBe(true);
  });

  it("emits distinct fingerprints for distinct occurrences of the same series", () => {
    const earlyShow: RawEvent = {
      ...sample,
      identity: {
        ...sample.identity,
        externalId: "secret-improv-society-tickets-250887#1427319",
      },
      // Fri, Jun 5, 2026 8:00 PM PT == 03:00 UTC the next day
      startTimeUtc: new Date("2026-06-06T03:00:00Z"),
      endTimeUtc: new Date("2026-06-06T04:30:00Z"),
      recurrence: {
        seriesId: "secret-improv-society-tickets-250887",
        occurrenceId: "1427319",
      },
    };
    const a = adapter.normalize(sample, provenance);
    const b = adapter.normalize(earlyShow, provenance);
    expect(a.canonicalFingerprint).not.toBe(b.canonicalFingerprint);
  });
});

describe("parseSimpleTixTime", () => {
  it("parses a ranged PT show into UTC start/end", () => {
    // Fri, May 29, 2026 8:00 PM PDT == 2026-05-30 03:00 UTC
    const parsed = parseSimpleTixTime("Fri, May 29, 2026 8:00 PM - 9:30 PM");
    expect(parsed).not.toBeNull();
    expect(parsed!.start.toISOString()).toBe("2026-05-30T03:00:00.000Z");
    expect(parsed!.end?.toISOString()).toBe("2026-05-30T04:30:00.000Z");
  });

  it("parses a single-time show (no end)", () => {
    const parsed = parseSimpleTixTime("Sat, Jan 3, 2026 8:00 PM");
    expect(parsed).not.toBeNull();
    // Sat Jan 3 2026 8:00 PM PST (UTC-8) == 2026-01-04 04:00 UTC
    expect(parsed!.start.toISOString()).toBe("2026-01-04T04:00:00.000Z");
    expect(parsed!.end).toBeNull();
  });

  it("returns null on malformed input", () => {
    expect(parseSimpleTixTime("definitely not a time")).toBeNull();
    expect(parseSimpleTixTime("")).toBeNull();
  });
});

describe("extractTimeArray", () => {
  it("extracts all occurrences from an inline timeArray", () => {
    const html = `
      <html><body>
        <script>
          var timeArray = [
            {"Id":1337005,"Time":"Sat, Dec 20, 2025 8:00 PM - 9:30 PM"},
            {"Id":1337007,"Time":"Fri, Dec 26, 2025 8:00 PM - 9:30 PM"}
          ];
        </script>
      </body></html>
    `;
    const occ = extractTimeArray(html);
    expect(occ).toHaveLength(2);
    expect(occ[0].id).toBe("1337005");
    expect(occ[1].id).toBe("1337007");
    expect(occ[0].start.toISOString()).toBe("2025-12-21T04:00:00.000Z");
  });

  it("returns empty array when no timeArray is present", () => {
    expect(extractTimeArray("<html></html>")).toEqual([]);
  });

  it("silently drops malformed entries instead of throwing", () => {
    const html = `
      <script>
        var timeArray = [
          {"Id":1,"Time":"Sat, Dec 20, 2025 8:00 PM"},
          {"Id":2,"Time":"not a date"},
          {"Id":3}
        ];
      </script>
    `;
    const occ = extractTimeArray(html);
    expect(occ).toHaveLength(1);
    expect(occ[0].id).toBe("1");
  });
});
