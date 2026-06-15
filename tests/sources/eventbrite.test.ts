import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import adapter, {
  classifyCategory,
  eventIdFromUrl,
  extractEventNodes,
  parseEventbriteNode,
  parseOffers,
  resolveCity,
} from "@/lib/sources/eventbrite";
import { parseJsonLd } from "@/lib/scrape";
import { INGEST_CITY_NAMES } from "@/lib/ui/cities";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-06-15T00:00:00Z");

const provenance: Provenance = {
  adapterId: "scrape:eventbrite",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-06-15T00:00:00Z"),
};

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@type": "Event",
    name: "Comedy Oakland Live",
    startDate: "2026-06-20T19:00:00-07:00",
    url: "https://www.eventbrite.com/e/comedy-oakland-live-tickets-1988692806719",
    description: "An evening of stand-up comedy.",
    location: {
      "@type": "Place",
      name: "Elbo Room",
      address: {
        "@type": "PostalAddress",
        streetAddress: "311 Broadway",
        addressLocality: "Oakland",
        addressRegion: "CA",
        postalCode: "94607",
      },
      geo: { "@type": "GeoCoordinates", latitude: "37.795", longitude: "-122.276" },
    },
    offers: { "@type": "Offer", price: "20", priceCurrency: "USD" },
    ...overrides,
  };
}

describe("Eventbrite adapter — identity", () => {
  it("advertises a trusted_partner scrape source", () => {
    expect(adapter.id).toBe("scrape:eventbrite");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("trusted_partner");
  });
});

describe("extractEventNodes", () => {
  it("unwraps Event items from an ItemList", () => {
    const nodes = [
      {
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", item: node() },
          { "@type": "ListItem", item: { "@type": "Place", name: "not an event" } },
        ],
      },
    ];
    const events = extractEventNodes(nodes);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("Comedy Oakland Live");
  });

  it("also accepts top-level Event nodes", () => {
    expect(extractEventNodes([node()])).toHaveLength(1);
  });
});

describe("eventIdFromUrl", () => {
  it("extracts the trailing numeric id", () => {
    expect(
      eventIdFromUrl("https://www.eventbrite.com/e/x-tickets-1988692806719"),
    ).toBe("1988692806719");
    expect(eventIdFromUrl("https://www.eventbrite.com/help")).toBeNull();
  });
});

describe("resolveCity", () => {
  it("matches covered cities case-insensitively, else null", () => {
    expect(resolveCity("Oakland")).toBe("Oakland");
    expect(resolveCity("berkeley")).toBe("Berkeley");
    expect(resolveCity("San Francisco")).toBe("San Francisco");
    expect(resolveCity("San Jose")).toBeNull(); // South Bay — out of scope
    expect(resolveCity(null)).toBeNull();
  });
});

describe("classifyCategory", () => {
  it("maps to our taxonomy and skips the rest", () => {
    expect(classifyCategory("Stand-Up Comedy Night", null)).toBe("comedy");
    expect(classifyCategory("Salsa & Bachata Social", null)).toBe("dancing");
    expect(classifyCategory("Natural Wine Tasting", null)).toBe("food");
    expect(classifyCategory("Live Jazz Quartet", null)).toBe("music");
    expect(classifyCategory("Author Reading & Q&A", null)).toBe("lectures");
    expect(classifyCategory("Longevity Venture Summit", null)).toBeNull();
    expect(classifyCategory("Presidio Half Marathon", null)).toBeNull();
  });
});

describe("parseOffers", () => {
  it("handles single offer, array, free, and missing", () => {
    expect(parseOffers({ price: "20" })).toEqual({
      priceMin: 20,
      priceMax: 20,
      isFree: false,
    });
    expect(parseOffers([{ lowPrice: 15 }, { highPrice: 45 }])).toEqual({
      priceMin: 15,
      priceMax: 45,
      isFree: false,
    });
    expect(parseOffers({ price: 0 })).toEqual({
      priceMin: 0,
      priceMax: 0,
      isFree: true,
    });
    expect(parseOffers(undefined)).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
  });
});

describe("parseEventbriteNode", () => {
  it("parses a complete node, tagging city + geo from the address", () => {
    const raw = parseEventbriteNode(node(), fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.identity.source).toBe("scrape:eventbrite");
    expect(raw!.identity.externalId).toBe("1988692806719");
    expect(raw!.venue.city).toBe("Oakland");
    expect(raw!.venue.name).toBe("Elbo Room");
    expect(raw!.venue.lat).toBe(37.795);
    expect(raw!.venue.lng).toBe(-122.276);
    expect(raw!.primaryCategory).toBe("comedy");
    expect(raw!.pricing?.priceMin).toBe(20);
    expect(raw!.verificationLevel).toBe("trusted_partner");
  });

  it("skips events outside our cities", () => {
    const raw = parseEventbriteNode(
      node({
        location: {
          "@type": "Place",
          name: "Some Club",
          address: { addressLocality: "San Jose", addressRegion: "CA" },
        },
      }),
      fetchedAt,
    );
    expect(raw).toBeNull();
  });

  it("skips events outside our taxonomy", () => {
    const raw = parseEventbriteNode(
      node({ name: "Tech Expo 2026", description: "A technology exhibition." }),
      fetchedAt,
    );
    expect(raw).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseEventbriteNode({}, fetchedAt)).toBeNull();
    expect(parseEventbriteNode({ name: "X" }, fetchedAt)).toBeNull();
  });

  it("round-trips through a stable, pure normalize()", () => {
    const raw = parseEventbriteNode(node(), fetchedAt) as RawEvent;
    const norm = adapter.normalize(raw, provenance);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.city).toBe("Oakland");
    expect(adapter.normalize(raw, provenance)).toEqual(norm);
  });
});

describe("Eventbrite fixture parsing (regression)", () => {
  // Real captured discovery-page JSON-LD (Oakland, June 2026). Exercises the
  // exact fetch() pipeline: parseJsonLd -> extractEventNodes -> parse/normalize.
  it("extracts the ItemList and parses real events from the saved fixture", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/eventbrite-discovery.html"),
      "utf-8",
    );
    const $ = cheerio.load(html);
    const nodes = extractEventNodes(parseJsonLd($));
    // Eventbrite renders ~20 events per discovery page.
    expect(nodes.length).toBeGreaterThanOrEqual(15);

    let parsed = 0;
    const fingerprints = new Set<string>();
    for (const n of nodes) {
      const raw = parseEventbriteNode(n, fetchedAt);
      if (!raw) continue; // skipped by city/taxonomy filters — expected
      parsed++;
      expect(INGEST_CITY_NAMES).toContain(raw.venue.city);
      expect(raw.identity.sourceUrl).toMatch(/eventbrite\.com\/e\//);
      const norm = adapter.normalize(raw, provenance);
      expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
      fingerprints.add(norm.canonicalFingerprint);
    }
    // At least some real listings survive the city + taxonomy filters.
    expect(parsed).toBeGreaterThanOrEqual(1);
    expect(fingerprints.size).toBe(parsed);
  });
});
