import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import adapter, {
  decodeHtmlEntities,
  deriveExternalId,
  parsePricing,
  toRawEvent,
} from "@/lib/sources/verdiclub";
import { filterEventNodes, parseJsonLd } from "@/lib/scrape";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const provenance: Provenance = {
  adapterId: "scrape:verdiclub",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

const sample: RawEvent = {
  identity: {
    source: "scrape:verdiclub",
    externalId: "iheartmambo-3-3/2026-05-24",
    sourceUrl: "https://www.verdiclub.net/events/iheartmambo-3-3/2026-05-24/",
  },
  title: "iHeartMambo",
  description: "Weekly salsa social with classes and DJs.",
  startTimeUtc: new Date("2026-05-25T02:00:00Z"),
  endTimeUtc: new Date("2026-05-25T06:30:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "Verdi Club",
    address: "2424 Mariposa St",
    neighborhood: "Mission",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "dancing",
  pricing: { priceMin: 0, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { url: "https://www.verdiclub.net/events/iheartmambo-3-3/2026-05-24/" },
  fetchedAt,
};

describe("Verdi Club adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:verdiclub");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalize() is deterministic and produces a stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.source).toBe("scrape:verdiclub");
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("iHeartMambo");
    expect(norm.category).toBe("dancing");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Verdi Club");
    expect(norm.venue.neighborhood).toBe("Mission");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // Pure: same input → byte-identical output.
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing satisfying D2 invariant", () => {
    // When the adapter has no offer info, the default `{0, null, false}` row
    // still satisfies D2 (priceMin is not null).
    const norm = adapter.normalize(
      { ...sample, pricing: null },
      provenance,
    );
    expect(
      norm.pricing.priceMin !== null ||
        norm.pricing.priceMax !== null ||
        norm.pricing.isFree === true,
    ).toBe(true);
  });

  describe("parsePricing", () => {
    it("parses an en-dashed range", () => {
      expect(parsePricing({ "@type": "Offer", price: "23 – 35" })).toEqual({
        priceMin: 23,
        priceMax: 35,
        isFree: false,
      });
    });

    it("parses a decimal range", () => {
      expect(
        parsePricing({ "@type": "Offer", price: "55.20 – 81.88" }),
      ).toEqual({ priceMin: 55.2, priceMax: 81.88, isFree: false });
    });

    it("parses a single price", () => {
      expect(parsePricing({ "@type": "Offer", price: "15" })).toEqual({
        priceMin: 15,
        priceMax: 15,
        isFree: false,
      });
    });

    it("treats free / 0 as isFree", () => {
      expect(parsePricing({ "@type": "Offer", price: "Free" })).toEqual({
        priceMin: 0,
        priceMax: 0,
        isFree: true,
      });
      expect(parsePricing({ "@type": "Offer", price: "0" })).toEqual({
        priceMin: 0,
        priceMax: 0,
        isFree: true,
      });
    });

    it("returns null when no offers are present", () => {
      expect(parsePricing(undefined)).toBeNull();
      expect(parsePricing(null)).toBeNull();
      expect(parsePricing({})).toBeNull();
      expect(parsePricing({ "@type": "Offer", price: "" })).toBeNull();
    });

    it("handles an array of offers (uses first)", () => {
      expect(
        parsePricing([
          { "@type": "Offer", price: "10" },
          { "@type": "Offer", price: "20" },
        ]),
      ).toEqual({ priceMin: 10, priceMax: 10, isFree: false });
    });
  });

  describe("deriveExternalId", () => {
    it("uses the last two URL path segments (slug/date)", () => {
      expect(
        deriveExternalId(
          "https://www.verdiclub.net/events/iheartmambo-3-3/2026-05-24/",
        ),
      ).toBe("iheartmambo-3-3/2026-05-24");
    });

    it("falls back to the URL when path is unusual", () => {
      expect(deriveExternalId("https://example.com/")).toBe(
        "https://example.com/",
      );
    });
  });

  describe("decodeHtmlEntities", () => {
    it("decodes numeric and named entities", () => {
      expect(decodeHtmlEntities("Woodchopper&#8217;s Ball")).toBe(
        "Woodchopper’s Ball",
      );
      expect(decodeHtmlEntities("Salsa &amp; Bachata")).toBe(
        "Salsa & Bachata",
      );
    });

    it("returns the input unchanged when it has no entities", () => {
      expect(decodeHtmlEntities("plain")).toBe("plain");
    });
  });

  describe("fixture parsing (regression on real markup)", () => {
    const fixturePath = resolve(
      process.cwd(),
      "fixtures/raw/verdiclub.html",
    );
    const html = readFileSync(fixturePath, "utf8");
    const $ = cheerio.load(html);
    const nodes = filterEventNodes(parseJsonLd($));

    it("finds Event nodes in the saved listing page", () => {
      expect(nodes.length).toBeGreaterThan(0);
    });

    it("converts every fixture node into a RawEvent or returns null safely", () => {
      const raws: RawEvent[] = [];
      for (const node of nodes) {
        const raw = toRawEvent(node, fetchedAt);
        if (raw) raws.push(raw);
      }
      expect(raws.length).toBeGreaterThan(0);
      for (const r of raws) {
        expect(r.identity.source).toBe("scrape:verdiclub");
        expect(r.identity.sourceUrl.length).toBeGreaterThan(0);
        expect(r.identity.externalId.length).toBeGreaterThan(0);
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.title.includes("&#")).toBe(false); // entities decoded
        expect(r.venue.name).toBe("Verdi Club");
        expect(r.timezone).toBe("America/Los_Angeles");
        expect(r.primaryCategory).toBe("dancing");
        expect(r.startTimeUtc).toBeInstanceOf(Date);
      }
    });

    it("normalizes fixture-derived events with stable fingerprints", () => {
      const node = nodes[0];
      const raw = toRawEvent(node, fetchedAt);
      expect(raw).not.toBeNull();
      if (!raw) return;
      const norm = adapter.normalize(raw, provenance);
      expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
      // structured pricing invariant (D2)
      expect(
        norm.pricing.priceMin !== null ||
          norm.pricing.priceMax !== null ||
          norm.pricing.isFree === true,
      ).toBe(true);
    });
  });
});
