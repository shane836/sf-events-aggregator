import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, { parseNinkashiEvent } from "@/lib/sources/cheaperthantherapy";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");
// A frozen "now" earlier than every fixture event so the past-event filter
// (D6) lets fixture rows through deterministically.
const now = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:cheaperthantherapy",
    externalId: "2429",
    sourceUrl:
      "https://tickets.cttcomedy.com/events/2429/cheaper-than-therapy-stand-up-comedy-wed-may-27/",
  },
  title: "Cheaper Than Therapy, Stand-up Comedy: Wed, May 27",
  description: "A healthy dose of live stand-up comedy.",
  startTimeUtc: new Date("2026-05-28T02:45:00Z"), // 7:45pm PT Wed May 27
  endTimeUtc: new Date("2026-05-28T04:15:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "Cheaper Than Therapy",
    neighborhood: "Tenderloin",
    address: "533 Sutter St, San Francisco, CA 94102",
    lat: 37.7889145,
    lng: -122.4113228,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "comedy",
  pricing: { priceMin: 25, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { id: 2429 },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:cheaperthantherapy",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Cheaper Than Therapy adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:cheaperthantherapy");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:cheaperthantherapy");
    expect(norm.identity.externalId).toBe("2429");
    expect(norm.identity.sourceUrl).toContain(
      "tickets.cttcomedy.com/events/2429",
    );
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Cheaper Than Therapy");
    expect(norm.venue.neighborhood).toBe("Tenderloin");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize is pure — same input + provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    // M3 D2: not (priceMin null AND priceMax null AND isFree false)
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.priceMin).toBe(25);
    expect(norm.pricing.isFree).toBe(false);
  });

  it("produces distinct fingerprints for 7:45pm and 9:45pm shows on the same night (regression)", () => {
    const earlyShow = adapter.normalize(sample, provenance);
    const lateShow = adapter.normalize(
      {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: "2432",
          sourceUrl: sample.identity.sourceUrl.replace("2429", "2432"),
        },
        startTimeUtc: new Date("2026-05-30T04:45:00Z"), // 9:45pm PT
      },
      provenance,
    );
    expect(earlyShow.canonicalFingerprint).not.toBe(
      lateShow.canonicalFingerprint,
    );
  });
});

describe("parseNinkashiEvent", () => {
  it("returns null when the input is missing", () => {
    expect(parseNinkashiEvent(null as never, fetchedAt, now)).toBeNull();
    expect(parseNinkashiEvent({} as never, fetchedAt, now)).toBeNull();
  });

  it("returns null when required identity fields are missing", () => {
    expect(parseNinkashiEvent({ id: 1 }, fetchedAt, now)).toBeNull();
    expect(
      parseNinkashiEvent({ id: 1, title: "Show" }, fetchedAt, now),
    ).toBeNull();
    expect(
      parseNinkashiEvent(
        { id: 1, title: "Show", event_dates_attributes: [] },
        fetchedAt,
        now,
      ),
    ).toBeNull();
  });

  it("returns null when start time cannot be parsed", () => {
    expect(
      parseNinkashiEvent(
        {
          id: 1,
          title: "Show",
          event_dates_attributes: [{ starts_at: "not-a-date" }],
        },
        fetchedAt,
        now,
      ),
    ).toBeNull();
  });

  it("skips past-dated events (D6 invariant)", () => {
    const past = parseNinkashiEvent(
      {
        id: 1,
        title: "Old Show",
        event_dates_attributes: [
          { starts_at: "2024-01-01 19:45:00 -0800" },
        ],
      },
      fetchedAt,
      now,
    );
    expect(past).toBeNull();
  });

  it("parses a complete Ninkashi event into a RawEvent", () => {
    const ev = parseNinkashiEvent(
      {
        id: 9999,
        title: "Test Show",
        description: "A test description.",
        venue_name: "Shelton Theater",
        address_1: "533 Sutter St",
        city: "San Francisco",
        state: "CA",
        zip_code: "94102",
        time_zone: "America/Los_Angeles",
        event_dates_attributes: [
          {
            starts_at: "2026-06-10 19:45:00 -0700",
            ends_at: "2026-06-10 21:15:00 -0700",
          },
        ],
        tickets_attributes: [
          { price: 2500, ticket_type: "paid" },
          { price: 3500, ticket_type: "paid" },
        ],
      },
      fetchedAt,
      now,
    );
    expect(ev).not.toBeNull();
    expect(ev!.title).toBe("Test Show");
    expect(ev!.identity.source).toBe("scrape:cheaperthantherapy");
    expect(ev!.identity.externalId).toBe("9999");
    expect(ev!.identity.sourceUrl).toMatch(
      /^https:\/\/tickets\.cttcomedy\.com\/events\/9999\/test-show\/$/,
    );
    expect(ev!.timezone).toBe("America/Los_Angeles");
    expect(ev!.venue.name).toBe("Cheaper Than Therapy");
    expect(ev!.venue.neighborhood).toBe("Tenderloin");
    expect(ev!.venue.lat).toBe(37.7889145);
    expect(ev!.primaryCategory).toBe("comedy");
    expect(ev!.verificationLevel).toBe("official");
    expect(ev!.pricing?.priceMin).toBe(25);
    expect(ev!.pricing?.priceMax).toBe(35);
    expect(ev!.pricing?.isFree).toBe(false);
  });

  it("falls back to $25 floor when no tickets array is supplied", () => {
    const ev = parseNinkashiEvent(
      {
        id: 42,
        title: "Pricing-Sparse Show",
        event_dates_attributes: [
          { starts_at: "2026-07-04 19:45:00 -0700" },
        ],
      },
      fetchedAt,
      now,
    );
    expect(ev?.pricing).toEqual({
      priceMin: 25,
      priceMax: null,
      isFree: false,
    });
  });

  it("marks an event as free when every paid ticket type is $0", () => {
    const ev = parseNinkashiEvent(
      {
        id: 43,
        title: "Free Show",
        event_dates_attributes: [
          { starts_at: "2026-07-05 19:45:00 -0700" },
        ],
        tickets_attributes: [{ price: 0, ticket_type: "paid" }],
      },
      fetchedAt,
      now,
    );
    expect(ev?.pricing).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
  });
});

describe("Cheaper Than Therapy fixture parsing (regression)", () => {
  it("extracts >= 50 future events from the saved Ninkashi JSON fixture", () => {
    const payload = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "fixtures/raw/cheaperthantherapy.json"),
        "utf-8",
      ),
    ) as unknown[];
    expect(payload.length).toBeGreaterThanOrEqual(50);

    let parsed = 0;
    const fingerprints = new Set<string>();
    const sourceUrls = new Set<string>();
    for (const node of payload) {
      const ev = parseNinkashiEvent(
        node as Parameters<typeof parseNinkashiEvent>[0],
        fetchedAt,
        now,
      );
      if (!ev) continue;
      parsed++;
      const norm = adapter.normalize(ev, provenance);
      expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(norm.category).toBe("comedy");
      expect(norm.timezone).toBe("America/Los_Angeles");
      expect(norm.pricing.priceMin).not.toBeNull();
      sourceUrls.add(norm.identity.sourceUrl);
      fingerprints.add(norm.canonicalFingerprint);
    }
    expect(parsed).toBeGreaterThanOrEqual(50);
    // Every event should have a unique fingerprint (distinct title+time pairs).
    expect(fingerprints.size).toBe(parsed);
    expect(sourceUrls.size).toBe(parsed);
  });
});
