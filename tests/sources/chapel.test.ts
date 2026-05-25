import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import adapter, {
  combineDateAndTime,
  extractSeeTicketsId,
  localWallClockToUtc,
  parseCard,
  parsePrice,
} from "@/lib/sources/chapel";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const FIXTURE = readFileSync(
  resolve(__dirname, "../../fixtures/raw/chapel.html"),
  "utf8",
);

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:chapel",
    externalId: "seetickets-692844-the-crosseyed",
    sourceUrl:
      "https://wl.seetickets.us/event/the-crosseyed/692844?afflky=TheChapel",
  },
  title: "The Crosseyed",
  description: "Alternative",
  startTimeUtc: new Date("2026-08-01T04:00:00Z"), // Fri Jul 31 9:00 PM PT
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "The Chapel",
    neighborhood: "Mission",
    address: "777 Valencia St, San Francisco, CA 94110",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "music",
  pricing: { priceMin: 20, priceMax: 25, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { externalId: "seetickets-692844-the-crosseyed" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:chapel",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("The Chapel adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:chapel");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.source).toBe("scrape:chapel");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("The Crosseyed");
    expect(norm.category).toBe("music");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.priceMin).toBe(20);
    expect(norm.pricing.priceMax).toBe(25);
    expect(norm.pricing.isFree).toBe(false);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("The Chapel");
    expect(norm.venue.neighborhood).toBe("Mission");

    // A10/B7: normalize is pure — same input → byte-identical output.
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing, never just a price string (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    // priceMin XOR priceMax XOR isFree must carry signal
    const hasSignal =
      norm.pricing.priceMin != null ||
      norm.pricing.priceMax != null ||
      norm.pricing.isFree === true;
    expect(hasSignal).toBe(true);
  });
});

describe("extractSeeTicketsId", () => {
  it("pulls the trailing numeric id + slug", () => {
    expect(
      extractSeeTicketsId(
        "https://wl.seetickets.us/event/the-crosseyed/692844?afflky=TheChapel",
      ),
    ).toBe("seetickets-692844-the-crosseyed");
  });

  it("returns null when the trailing segment is not numeric", () => {
    expect(
      extractSeeTicketsId("https://wl.seetickets.us/event/the-crosseyed/"),
    ).toBeNull();
  });

  it("returns null on a malformed URL", () => {
    expect(extractSeeTicketsId("not a url")).toBeNull();
  });
});

describe("parsePrice", () => {
  it("parses a range", () => {
    expect(parsePrice("$20.00-$25.00")).toEqual({
      priceMin: 20,
      priceMax: 25,
      isFree: false,
    });
  });
  it("parses a single price", () => {
    expect(parsePrice("$30.00")).toEqual({
      priceMin: 30,
      priceMax: 30,
      isFree: false,
    });
  });
  it("flags Free", () => {
    expect(parsePrice("Free")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
  });
  it("handles null/empty gracefully", () => {
    expect(parsePrice(null)).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
    expect(parsePrice("   ")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
  });
});

describe("combineDateAndTime", () => {
  const now = new Date("2026-05-25T07:00:00Z"); // ~midnight PT May 25, 2026

  it("infers current year for upcoming month", () => {
    const d = combineDateAndTime("Fri Jul 31", "9:00PM", now);
    expect(d).not.toBeNull();
    // 9:00 PM PT on Jul 31, 2026 = PDT (UTC-7) = 2026-08-01T04:00:00Z
    expect(d!.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("rolls to next year when month is well behind current", () => {
    const d = combineDateAndTime("Fri Jan 15", "8:00PM", now);
    expect(d).not.toBeNull();
    // 8:00 PM PT on Jan 15, 2027 = PST (UTC-8) = 2027-01-16T04:00:00Z
    expect(d!.toISOString()).toBe("2027-01-16T04:00:00.000Z");
  });

  it("defaults to 8 PM local when showtime missing", () => {
    const d = combineDateAndTime("Wed Jun 3", null, now);
    expect(d).not.toBeNull();
    // 8 PM PT on Jun 3, 2026 = PDT (UTC-7) = 2026-06-04T03:00:00Z
    expect(d!.toISOString()).toBe("2026-06-04T03:00:00.000Z");
  });

  it("returns null on unparseable date", () => {
    expect(combineDateAndTime("???", "9:00PM", now)).toBeNull();
  });
});

describe("localWallClockToUtc", () => {
  it("handles PDT (summer)", () => {
    // Jul 31 2026 21:00 PT = 04:00 UTC Aug 1
    const d = localWallClockToUtc(2026, 7, 31, 21, 0, "America/Los_Angeles");
    expect(d.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });
  it("handles PST (winter)", () => {
    // Jan 15 2027 20:00 PT = 04:00 UTC Jan 16
    const d = localWallClockToUtc(2027, 1, 15, 20, 0, "America/Los_Angeles");
    expect(d.toISOString()).toBe("2027-01-16T04:00:00.000Z");
  });
});

describe("parseCard on the real fixture", () => {
  const $ = cheerio.load(FIXTURE);
  const cards = $(".seetickets-list-event-container").toArray();

  it("finds at least 5 event cards in the fixture", () => {
    expect(cards.length).toBeGreaterThanOrEqual(5);
  });

  it("parses the first card cleanly", () => {
    const parsed = parseCard($, cards[0]);
    expect(parsed).not.toBeNull();
    expect(parsed!.title.length).toBeGreaterThan(0);
    expect(parsed!.sourceUrl).toMatch(/^https?:\/\//);
    expect(parsed!.externalId).toMatch(/^seetickets-\d+-/);
    expect(parsed!.dateText.length).toBeGreaterThan(0);
  });

  it("every parsed card yields a non-empty title, source URL, and external ID", () => {
    for (const el of cards) {
      const parsed = parseCard($, el);
      // Some cards in the wild may be malformed; we skip those by returning
      // null. But the bulk should parse.
      if (!parsed) continue;
      expect(parsed.title.length).toBeGreaterThan(0);
      expect(parsed.sourceUrl.length).toBeGreaterThan(0);
      expect(parsed.externalId.length).toBeGreaterThan(0);
    }
    // and we expect the parse success rate to be ≥ 90%
    const parsedCount = cards
      .map((el) => parseCard($, el))
      .filter((p) => p !== null).length;
    expect(parsedCount / cards.length).toBeGreaterThanOrEqual(0.9);
  });

  it("end-to-end: normalize a real fixture card and check invariants", () => {
    const parsed = parseCard($, cards[0])!;
    const start = combineDateAndTime(
      parsed.dateText,
      parsed.showtimeText,
      fetchedAt,
    )!;
    const raw: RawEvent = {
      identity: {
        source: "scrape:chapel",
        externalId: parsed.externalId,
        sourceUrl: parsed.sourceUrl,
      },
      title: parsed.title,
      description: parsed.genre,
      startTimeUtc: start,
      endTimeUtc: null,
      timezone: "America/Los_Angeles",
      venue: {
        name: "The Chapel",
        neighborhood: "Mission",
        address: "777 Valencia St, San Francisco, CA 94110",
        lat: null,
        lng: null,
        timezone: "America/Los_Angeles",
      },
      primaryCategory: "music",
      pricing: parsePrice(parsed.priceText),
      recurrence: null,
      verificationLevel: "official",
      rawPayload: parsed,
      fetchedAt,
    };
    const norm = adapter.normalize(raw, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.category).toBe("music");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
  });
});
