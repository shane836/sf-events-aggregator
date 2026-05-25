import { describe, expect, it } from "vitest";
import adapter, {
  csvRowToUtc,
  parseCsv,
} from "@/lib/sources/thesetup";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:thesetup",
    externalId: "tickets-3/palace-theater-friday-may-29th-9pm",
    sourceUrl:
      "https://setupcomedy.com/tickets-3/palace-theater-friday-may-29th-9pm",
  },
  title: "The Setup at The Palace Theater",
  description: "Fast Selling",
  // 9pm PT on 2026-05-29 (PDT, UTC-7) → 04:00 UTC on 2026-05-30
  startTimeUtc: new Date("2026-05-30T04:00:00Z"),
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "The Palace Theater",
    address: "644 Broadway, San Francisco, CA 94133",
    neighborhood: "North Beach",
    lat: 37.7975,
    lng: -122.4078,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "comedy",
  pricing: { priceMin: 35, priceMax: 35, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { listingUrl: "https://setupcomedy.com/comedyshow-sanfrancisco" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:thesetup",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("The Setup adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:thesetup");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:thesetup");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.isFree).toBe(false);
    expect(norm.pricing.priceMin).toBe(35);
    expect(norm.pricing.priceMax).toBe(35);
    expect(norm.startTimeUtc).toEqual(sample.startTimeUtc);
    expect(norm.endTimeUtc).toBeNull();
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("The Palace Theater");
    expect(norm.venue.neighborhood).toBe("North Beach");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure: same input + same provenance → byte-identical output.
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D1 / D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing (D2 / D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    // D2: scraped rows must have either priceMin/priceMax or isFree=true.
    const hasStructuredPrice =
      norm.pricing.priceMin !== null ||
      norm.pricing.priceMax !== null ||
      norm.pricing.isFree === true;
    expect(hasStructuredPrice).toBe(true);
  });

  it("produces distinct fingerprints for same-night shows at different times (regression for IDENTITY.md minute-granularity rule)", () => {
    const earlier = adapter.normalize(sample, provenance);
    const laterRaw: RawEvent = {
      ...sample,
      identity: {
        ...sample.identity,
        externalId: "tickets-3/lost-church-saturday-may-2nd-930pm",
        sourceUrl:
          "https://setupcomedy.com/tickets-3/lost-church-saturday-may-2nd-930pm",
      },
      // Same venue+title, 30 min later → must be a different fingerprint.
      startTimeUtc: new Date(sample.startTimeUtc.getTime() + 30 * 60 * 1000),
    };
    const later = adapter.normalize(laterRaw, provenance);
    expect(later.canonicalFingerprint).not.toBe(earlier.canonicalFingerprint);
  });
});

describe("The Setup CSV parser", () => {
  // Inline fixture mirrors the live published Google Sheet shape captured
  // 2026-05-24. Keep this small + hand-curated; if the live schema drifts,
  // this test fails fast (intentional — schema change = adapter change).
  const CSV = [
    "date,day,time,title,venue,city,ticket_url,urgency_tag,sold_out",
    "2026-05-29,Fri,9:00 PM,The Setup at The Palace Theater,The Palace Theater,San Francisco,https://setupcomedy.com/tickets-3/palace-theater-friday-may-29th-9pm,Fast Selling ,",
    "2026-05-02,Sat,9:30 PM,The Setup at The Lost Church,The Lost Church,North Beach SF,https://setupcomedy.com/tickets-3/lost-church-saturday-may-2nd-930pm,,",
    "2026-06-05,Fri,9:00 PM,The Setup at The Palace Theater,The Palace Theater,San Francisco,https://setupcomedy.com/tickets-3/palace-theater-friday-june-5th-9pm,,",
  ].join("\n");

  it("parses a header + three rows", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0].venue).toBe("The Palace Theater");
    expect(rows[0].city).toBe("San Francisco");
    expect(rows[0].time).toBe("9:00 PM");
    expect(rows[1].venue).toBe("The Lost Church");
    expect(rows[1].time).toBe("9:30 PM");
  });

  it("trims the trailing spaces in urgency_tag", () => {
    const rows = parseCsv(CSV);
    expect(rows[0].urgency_tag).toBe("Fast Selling");
    expect(rows[1].urgency_tag).toBe("");
  });

  it("returns empty array on empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("The Setup PT → UTC conversion", () => {
  it("converts a 9:00 PM PDT show to the right UTC instant", () => {
    // PDT is UTC-7. 9pm local on May 29 → 04:00 UTC May 30.
    const utc = csvRowToUtc("2026-05-29", "9:00 PM");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-05-30T04:00:00.000Z");
  });

  it("converts a 9:30 PM PDT show to the right UTC instant", () => {
    // PDT is UTC-7. 9:30pm local on May 2 → 04:30 UTC May 3.
    const utc = csvRowToUtc("2026-05-02", "9:30 PM");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-05-03T04:30:00.000Z");
  });

  it("handles PST (winter) when DST is not in effect", () => {
    // PST is UTC-8. 9pm local on Dec 5 → 05:00 UTC Dec 6.
    const utc = csvRowToUtc("2026-12-05", "9:00 PM");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-12-06T05:00:00.000Z");
  });

  it("returns null on malformed input", () => {
    expect(csvRowToUtc("not-a-date", "9:00 PM")).toBeNull();
    expect(csvRowToUtc("2026-05-29", "9pm")).toBeNull();
  });
});
