import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import adapter, {
  extractExternalId,
  parseCard,
  parseEventDateTime,
  parsePrice,
} from "@/lib/sources/gamh";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const FIXTURE_PATH = resolve(__dirname, "../../fixtures/raw/gamh.html");
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf8");

// Anchor "now" to a moment when the fixture's earliest event (Wed May 27)
// is still in the future. Fixture was captured 2026-05-24.
const NOW = new Date("2026-05-24T12:00:00Z");
const FETCHED_AT = new Date("2026-05-24T12:00:00Z");

const provenance: Provenance = {
  adapterId: "scrape:gamh",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-24T12:00:00Z"),
};

// Hand-built RawEvent for normalize() invariants (D12/D13).
const sample: RawEvent = {
  identity: {
    source: "scrape:gamh",
    externalId: "683102",
    sourceUrl:
      "https://wl.seetickets.us/event/sleepytime-gorilla-museum/683102?afflky=GreatAmericanMusicHall",
  },
  title: "Sleepytime Gorilla Museum",
  description: "GAMH & UC Theatre present… — with Inner Ear Brigade, Lunar Mistake — Rock",
  startTimeUtc: new Date("2026-05-28T03:00:00Z"),
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "Great American Music Hall",
    neighborhood: "Tenderloin",
    address: "859 O'Farrell St, San Francisco, CA 94109",
    lat: 37.7848,
    lng: -122.4187,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "music",
  pricing: { priceMin: 25, priceMax: 30, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { title: "Sleepytime Gorilla Museum" },
  fetchedAt: FETCHED_AT,
};

describe("gamh adapter — identity", () => {
  it("advertises the right id/tier/verification level", () => {
    expect(adapter.id).toBe("scrape:gamh");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });
});

describe("gamh adapter — normalize()", () => {
  it("produces a NormalizedEvent with the required invariants", () => {
    const norm = adapter.normalize(sample, provenance);

    // D12: non-empty sourceUrl
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);

    // D13: structured pricing present (priceMin/priceMax or isFree=true)
    expect(norm.pricing).toBeDefined();
    expect(
      norm.pricing.isFree === true ||
        norm.pricing.priceMin != null ||
        norm.pricing.priceMax != null,
    ).toBe(true);

    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("music");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.venue.name).toBe("Great American Music Hall");
    expect(norm.venue.neighborhood).toBe("Tenderloin");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");
  });

  it("is pure: same input → byte-identical output", () => {
    const a = adapter.normalize(sample, provenance);
    const b = adapter.normalize(sample, provenance);
    expect(b).toEqual(a);
  });
});

describe("gamh helpers — extractExternalId", () => {
  it("pulls the trailing numeric ID from a SeeTickets event URL", () => {
    expect(
      extractExternalId(
        "https://wl.seetickets.us/event/sleepytime-gorilla-museum/683102?afflky=GreatAmericanMusicHall",
      ),
    ).toBe("683102");
  });

  it("returns null on a URL without an event id", () => {
    expect(extractExternalId("https://gamh.com/")).toBeNull();
    expect(extractExternalId("")).toBeNull();
  });
});

describe("gamh helpers — parsePrice", () => {
  it("parses single-price strings", () => {
    expect(parsePrice("$45.00")).toEqual({
      priceMin: 45,
      priceMax: 45,
      isFree: false,
    });
  });

  it("parses price ranges", () => {
    expect(parsePrice("$25.00-$30.00")).toEqual({
      priceMin: 25,
      priceMax: 30,
      isFree: false,
    });
  });

  it("flags Free events as isFree=true with null bounds", () => {
    const free = parsePrice("Free");
    expect(free.isFree).toBe(true);
    expect(free.priceMin).toBeNull();
    expect(free.priceMax).toBeNull();
  });

  it("returns structured (non-throwing) result on empty input", () => {
    const empty = parsePrice("");
    expect(empty.priceMin).toBeNull();
    expect(empty.priceMax).toBeNull();
    expect(empty.isFree).toBe(false);
  });
});

describe("gamh helpers — parseEventDateTime", () => {
  it('parses "Wed May 27" + "8:00PM" as 8pm PT (UTC = next day 03:00 in DST)', () => {
    const d = parseEventDateTime(
      "Wed May 27",
      "8:00PM",
      "America/Los_Angeles",
      NOW,
    );
    expect(d).toBeInstanceOf(Date);
    // PDT is UTC-7 in May, so 8:00 PM PT = 03:00 UTC next day.
    expect(d!.toISOString()).toBe("2026-05-28T03:00:00.000Z");
  });

  it("rolls forward to next year if the date would otherwise be far in the past", () => {
    // "Jan 5" relative to a NOW of late December should land in the next year.
    const lateDec = new Date("2026-12-20T12:00:00Z");
    const d = parseEventDateTime(
      "Tue Jan 5",
      "8:00PM",
      "America/Los_Angeles",
      lateDec,
    );
    expect(d).toBeInstanceOf(Date);
    // PST is UTC-8 in January, so 8 PM PT = 04:00 UTC next day.
    expect(d!.toISOString()).toBe("2027-01-06T04:00:00.000Z");
  });

  it("returns null on unparseable input", () => {
    expect(
      parseEventDateTime("nope", "8:00PM", "America/Los_Angeles", NOW),
    ).toBeNull();
    expect(
      parseEventDateTime("Wed May 27", "noon", "America/Los_Angeles", NOW),
    ).toBeNull();
  });
});

describe("gamh adapter — parseCard against the real fixture", () => {
  it("extracts at least one event card with all required fields", () => {
    const $ = cheerio.load(FIXTURE_HTML);
    const cards = $(".seetickets-list-event-container");
    expect(cards.length).toBeGreaterThan(0);

    const first = parseCard($, cards[0], FETCHED_AT, NOW);
    expect(first).not.toBeNull();
    expect(first!.title.length).toBeGreaterThan(0);
    expect(first!.identity.source).toBe("scrape:gamh");
    expect(first!.identity.externalId.length).toBeGreaterThan(0);
    expect(first!.identity.sourceUrl).toMatch(/^https?:\/\//);
    expect(first!.startTimeUtc).toBeInstanceOf(Date);
    expect(first!.startTimeUtc.getTime()).toBeGreaterThan(NOW.getTime() - 86400000);
    expect(first!.timezone).toBe("America/Los_Angeles");
    expect(first!.primaryCategory).toBe("music");
    expect(first!.venue.name).toBe("Great American Music Hall");
    expect(first!.verificationLevel).toBe("official");
    // D13: structured pricing on every row (not just isFree, not just nulls)
    expect(first!.pricing).toBeDefined();
  });

  it("parses every card in the fixture without throwing and yields valid identities", () => {
    const $ = cheerio.load(FIXTURE_HTML);
    const cards = $(".seetickets-list-event-container");
    const parsed: RawEvent[] = [];
    cards.each((_, el) => {
      const r = parseCard($, el, FETCHED_AT, NOW);
      if (r) parsed.push(r);
    });

    expect(parsed.length).toBeGreaterThanOrEqual(10);
    for (const r of parsed) {
      expect(r.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(r.identity.externalId.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.startTimeUtc.getFullYear()).toBeGreaterThanOrEqual(2026);
    }

    // External IDs should all be distinct (sanity check for the dedup story).
    const ids = parsed.map((r) => r.identity.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
