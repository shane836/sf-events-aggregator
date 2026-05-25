import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import adapter, {
  detailNodeToRawEvent,
  extractPricing,
  parseListingEntries,
} from "@/lib/sources/sparksocial";
import { parseJsonLd } from "@/lib/scrape";

// Local mirror of the adapter's event-type filter so tests don't import a
// non-exported helper. Adapter uses an internal `isEventNode`; we just call
// parseJsonLd and slice the SocialEvent / Festival / SportsEvent block.
const EVENT_TYPES = new Set([
  "Event",
  "SocialEvent",
  "SportsEvent",
  "Festival",
  "FoodEvent",
  "MusicEvent",
]);
function isEventNode(n: unknown): n is Record<string, unknown> {
  if (!n || typeof n !== "object") return false;
  const t = (n as Record<string, unknown>)["@type"];
  return typeof t === "string" && EVENT_TYPES.has(t);
}
import type { Provenance, RawEvent } from "@/lib/sources/types";

const TZ = "America/Los_Angeles";
const fetchedAt = new Date("2026-05-25T00:00:00Z");

function loadFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "fixtures/raw", name),
    "utf-8",
  );
}

const sample: RawEvent = {
  identity: {
    source: "scrape:sparksocial",
    externalId: "eb:1677626549169",
    sourceUrl:
      "https://www.eventbrite.com/e/trivia-night-at-spark-social-sf-tickets-1677626549169",
  },
  title: "Trivia Night at SPARK Social SF",
  description: "Your Weekly Trivia Challenge!",
  startTimeUtc: new Date("2026-05-28T01:30:00Z"), // 6:30pm PDT on 2026-05-27
  endTimeUtc: new Date("2026-05-28T03:30:00Z"), // 8:30pm PDT
  timezone: TZ,
  venue: {
    name: "Spark Social SF",
    neighborhood: "Mission Bay",
    address: "601 Mission Bay Boulevard North, San Francisco, CA 94158",
    lat: 37.7707793,
    lng: -122.3914307,
    timezone: TZ,
  },
  primaryCategory: "food",
  pricing: { priceMin: null, priceMax: null, isFree: true },
  recurrence: null,
  verificationLevel: "community",
  rawPayload: { name: "Trivia Night at SPARK Social SF" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:sparksocial",
  adapterVersion: "2.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Spark Social SF adapter", () => {
  it("advertises the right identity (verification downgraded to community for Eventbrite mining)", () => {
    expect(adapter.id).toBe("scrape:sparksocial");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("community");
  });

  it("normalizes a raw event into a NormalizedEvent with a stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:sparksocial");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toContain("Trivia");
    expect(norm.category).toBe("food");
    expect(norm.timezone).toBe(TZ);
    expect(norm.verificationLevel).toBe("community");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Spark Social SF");
    expect(norm.venue.neighborhood).toBe("Mission Bay");
    expect(norm.venue.lat).toBeCloseTo(37.7707793, 5);
    expect(norm.venue.lng).toBeCloseTo(-122.3914307, 5);
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize is pure — same input + provenance → byte-identical output.
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    // Must NOT point at the dead visitsparksocial.com calendar widget.
    expect(norm.identity.sourceUrl).not.toMatch(/visitsparksocial\.com/);
    expect(norm.identity.sourceUrl).toMatch(/eventbrite\.com\/e\//);
  });

  it("emits structured pricing satisfying D2 (priceMin || priceMax || isFree)", () => {
    const norm = adapter.normalize(sample, provenance);
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
  });
});

describe("parseListingEntries (Eventbrite ItemList JSON-LD)", () => {
  it("extracts only events whose location.name is 'Spark Social SF'", () => {
    const html = loadFixture("sparksocial.html");
    const entries = parseListingEntries(html);
    // The fixture's ItemList has 20 events; at least one is at Spark Social SF.
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.length).toBeLessThanOrEqual(20);
    for (const e of entries) {
      expect(e.url).toMatch(/eventbrite\.com\/e\//);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("returns the Trivia Night entry from the fixture", () => {
    const html = loadFixture("sparksocial.html");
    const entries = parseListingEntries(html);
    const trivia = entries.find((e) => /trivia/i.test(e.name));
    expect(trivia).toBeDefined();
    expect(trivia?.url).toContain("trivia-night-at-spark-social-sf");
  });

  it("returns an empty array on HTML with no JSON-LD", () => {
    expect(parseListingEntries("<html><body>nothing</body></html>")).toEqual([]);
  });

  it("returns an empty array on HTML whose ItemList has no Spark Social matches", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      itemListElement: [
        {
          position: 1,
          "@type": "ListItem",
          item: {
            "@type": "Event",
            name: "Some other event",
            url: "https://www.eventbrite.com/e/other-tickets-99999",
            startDate: "2026-06-01",
            location: { "@type": "Place", name: "Some Other Place" },
          },
        },
      ],
    })}</script>`;
    expect(parseListingEntries(html)).toEqual([]);
  });
});

describe("detailNodeToRawEvent (Eventbrite event-detail JSON-LD)", () => {
  it("builds a RawEvent from the Trivia Night detail fixture", () => {
    const html = loadFixture("sparksocial-detail-trivia.html");
    const $ = cheerio.load(html);
    const nodes = parseJsonLd($).filter(isEventNode);
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const raw = detailNodeToRawEvent(
      nodes[0],
      "https://www.eventbrite.com/e/trivia-night-at-spark-social-sf-tickets-1677626549169",
      fetchedAt,
    )!;
    expect(raw).not.toBeNull();
    expect(raw.title).toMatch(/Trivia/i);
    expect(raw.identity.externalId).toMatch(/^eb:\d+$/);
    expect(raw.identity.sourceUrl).toMatch(/eventbrite\.com\/e\//);
    expect(raw.startTimeUtc.toISOString()).toBe("2026-05-28T01:30:00.000Z");
    expect(raw.endTimeUtc?.toISOString()).toBe("2026-05-28T03:30:00.000Z");
    expect(raw.timezone).toBe(TZ);
    expect(raw.pricing).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
    expect(raw.venue.name).toBe("Spark Social SF");
    expect(raw.venue.address).toContain("601 Mission Bay");
    expect(raw.primaryCategory).toBe("food");
    expect(raw.verificationLevel).toBe("community");
  });

  it("builds a RawEvent from the Mission Bay Cleanup fixture (SportsEvent JSON-LD type)", () => {
    const html = loadFixture("sparksocial-detail-cleanup.html");
    const $ = cheerio.load(html);
    const nodes = parseJsonLd($).filter(isEventNode);
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const raw = detailNodeToRawEvent(
      nodes[0],
      "https://www.eventbrite.com/e/mission-bay-cleanup-tickets-1981068952566",
      fetchedAt,
    )!;
    expect(raw.title).toBe("Mission Bay Cleanup");
    expect(raw.startTimeUtc.toISOString()).toBe("2026-06-13T16:00:00.000Z");
    expect(raw.pricing?.isFree).toBe(true);
    expect(raw.venue.name).toBe("Spark Social SF");
  });

  it("returns null when name or startDate is missing", () => {
    expect(detailNodeToRawEvent({}, "https://x", fetchedAt)).toBeNull();
    expect(
      detailNodeToRawEvent(
        { name: "X" } as Record<string, unknown>,
        "https://x",
        fetchedAt,
      ),
    ).toBeNull();
    expect(
      detailNodeToRawEvent(
        { startDate: "2026-01-01T00:00:00Z" } as Record<string, unknown>,
        "https://x",
        fetchedAt,
      ),
    ).toBeNull();
  });

  it("returns null when startDate cannot be parsed as a Date", () => {
    expect(
      detailNodeToRawEvent(
        { name: "X", startDate: "not-a-date" } as Record<string, unknown>,
        "https://x",
        fetchedAt,
      ),
    ).toBeNull();
  });

  it("derives externalId from the -tickets-<n> URL suffix", () => {
    const raw = detailNodeToRawEvent(
      {
        name: "Test",
        startDate: "2026-06-01T19:00:00-07:00",
        url: "https://www.eventbrite.com/e/some-event-tickets-9876543210",
      } as Record<string, unknown>,
      "https://www.eventbrite.com/e/some-event-tickets-9876543210",
      fetchedAt,
    )!;
    expect(raw.identity.externalId).toBe("eb:9876543210");
  });
});

describe("extractPricing (Eventbrite offers JSON-LD)", () => {
  it("maps lowPrice=highPrice=0 to isFree", () => {
    expect(
      extractPricing({
        offers: [{ "@type": "AggregateOffer", lowPrice: "0.0", highPrice: "0.0" }],
      }),
    ).toEqual({ priceMin: null, priceMax: null, isFree: true });
  });

  it("maps a paid offer to priceMin and priceMax", () => {
    expect(
      extractPricing({
        offers: [
          { "@type": "AggregateOffer", lowPrice: "10.0", highPrice: "25.0" },
        ],
      }),
    ).toEqual({ priceMin: 10, priceMax: 25, isFree: false });
  });

  it("handles a single (non-array) offer object", () => {
    expect(
      extractPricing({
        offers: { "@type": "Offer", price: "15.0" },
      }),
    ).toEqual({ priceMin: 15, priceMax: 15, isFree: false });
  });

  it("falls back to priceMin=0 (not-null) when offers are missing — satisfies D2", () => {
    const p = extractPricing({});
    expect(p.priceMin).toBe(0);
    expect(p.priceMax).toBeNull();
    expect(p.isFree).toBe(false);
  });
});
