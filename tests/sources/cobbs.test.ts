import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import adapter, { parseEventNode } from "@/lib/sources/cobbs";
import { filterEventNodes, parseJsonLd } from "@/lib/scrape";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:cobbs",
    externalId:
      "https://www.ticketmaster.com/sammy-obeid-san-francisco-california-05-24-2026/event/1C00643ABD1EEA5D",
    sourceUrl:
      "https://www.ticketmaster.com/sammy-obeid-san-francisco-california-05-24-2026/event/1C00643ABD1EEA5D",
  },
  title: "Sammy Obeid",
  description: null,
  startTimeUtc: new Date("2026-05-24T23:00:00Z"), // 4pm PT
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "Cobb's Comedy Club",
    neighborhood: "North Beach",
    address: "915 Columbus Avenue, San Francisco, CA, 94133",
    lat: 37.802909,
    lng: -122.414217,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "comedy",
  pricing: { priceMin: 25, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { name: "Sammy Obeid" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:cobbs",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Cobb's Comedy adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:cobbs");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:cobbs");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("Sammy Obeid");
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Cobb's Comedy Club");
    expect(norm.venue.neighborhood).toBe("North Beach");
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

  it("parses Sammy Obeid 4pm and 7pm as distinct fingerprints (same-night same-act regression)", () => {
    const fourPm = adapter.normalize(sample, provenance);
    const sevenPm = adapter.normalize(
      {
        ...sample,
        identity: {
          ...sample.identity,
          externalId: sample.identity.externalId + "#19",
          sourceUrl: sample.identity.sourceUrl + "#19",
        },
        startTimeUtc: new Date("2026-05-25T02:00:00Z"), // 7pm PT
      },
      provenance,
    );
    expect(fourPm.canonicalFingerprint).not.toBe(sevenPm.canonicalFingerprint);
  });
});

describe("parseEventNode", () => {
  it("returns null when required fields missing", () => {
    expect(parseEventNode({}, fetchedAt)).toBeNull();
    expect(parseEventNode({ name: "X" }, fetchedAt)).toBeNull();
    expect(
      parseEventNode({ name: "X", startDate: "2026-01-01T00:00:00Z" }, fetchedAt),
    ).toBeNull();
  });

  it("returns null when startDate cannot be parsed", () => {
    expect(
      parseEventNode(
        {
          name: "X",
          startDate: "not-a-date",
          url: "https://example.com/x",
        },
        fetchedAt,
      ),
    ).toBeNull();
  });

  it("parses a complete schema.org MusicEvent into a RawEvent", () => {
    const node = {
      "@type": "MusicEvent",
      name: "Test Show",
      startDate: "2026-06-10T19:30:00-07:00",
      url: "https://www.ticketmaster.com/test/event/ABC",
      location: {
        "@type": "Place",
        name: "Cobb's Comedy Club",
        address: {
          "@type": "PostalAddress",
          streetAddress: "915 Columbus Avenue",
          addressLocality: "San Francisco",
          addressRegion: "CA",
          postalCode: "94133",
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: 37.802909,
          longitude: -122.414217,
        },
      },
    };
    const raw = parseEventNode(node, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe("Test Show");
    expect(raw!.identity.source).toBe("scrape:cobbs");
    expect(raw!.identity.sourceUrl).toBe(node.url);
    expect(raw!.timezone).toBe("America/Los_Angeles");
    expect(raw!.venue.name).toBe("Cobb's Comedy Club");
    expect(raw!.venue.neighborhood).toBe("North Beach");
    expect(raw!.venue.lat).toBe(37.802909);
    expect(raw!.primaryCategory).toBe("comedy");
    expect(raw!.verificationLevel).toBe("official");
    expect(raw!.pricing?.priceMin).toBe(25);
  });
});

describe("Cobb's fixture parsing (regression)", () => {
  it("extracts >= 10 events from the saved HTML fixture", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/cobbs.html"),
      "utf-8",
    );
    const $ = cheerio.load(html);
    const eventNodes = filterEventNodes(parseJsonLd($));
    expect(eventNodes.length).toBeGreaterThanOrEqual(10);

    let parsed = 0;
    const fingerprints = new Set<string>();
    for (const node of eventNodes) {
      const ev = parseEventNode(node, fetchedAt);
      if (!ev) continue;
      parsed++;
      const norm = adapter.normalize(ev, provenance);
      expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(norm.category).toBe("comedy");
      expect(norm.timezone).toBe("America/Los_Angeles");
      expect(norm.pricing.priceMin).toBe(25);
      fingerprints.add(norm.canonicalFingerprint);
    }
    expect(parsed).toBeGreaterThanOrEqual(10);
    // Most events should have distinct fingerprints (allowing for some
    // same-show repeats if the page double-renders).
    expect(fingerprints.size).toBeGreaterThanOrEqual(
      Math.floor(parsed * 0.5),
    );
  });
});
