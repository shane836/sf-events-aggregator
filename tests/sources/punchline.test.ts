import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { filterEventNodes, parseJsonLd } from "@/lib/scrape";
import adapter, { jsonLdToRawEvent } from "@/lib/sources/punchline";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const fixtureHtml = readFileSync(
  resolve(__dirname, "../../fixtures/raw/punchline.html"),
  "utf8",
);

const provenance: Provenance = {
  adapterId: "scrape:punchline",
  adapterVersion: "1.0",
  pipelineVersion: "m3-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

// A realistic JSON-LD payload, matching what the live /shows page emits.
const sampleNode: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "MusicEvent",
  name: "Helen Hong",
  startDate: "2026-06-10T20:00:00-07:00",
  url: "https://www.ticketmaster.com/helen-hong-san-francisco-california-06-10-2026/event/1C00644FCC73C05A",
  location: {
    "@type": "Place",
    name: "Punch Line Comedy Club - San Francisco",
    address: {
      "@type": "PostalAddress",
      streetAddress: "444 Battery Street",
    },
  },
};

describe("Punch Line SF adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:punchline");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("parses every JSON-LD Event node in the fixture", () => {
    const $ = cheerio.load(fixtureHtml);
    const nodes = filterEventNodes(parseJsonLd($));
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    const raws = nodes
      .map((n) => jsonLdToRawEvent(n, fetchedAt))
      .filter((r): r is RawEvent => r !== null);
    expect(raws.length).toBe(nodes.length);

    for (const raw of raws) {
      expect(raw.identity.source).toBe("scrape:punchline");
      expect(raw.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(raw.identity.externalId.length).toBeGreaterThan(0);
      expect(raw.title.length).toBeGreaterThan(0);
      expect(raw.venue.name).toBe("Punch Line SF");
      expect(raw.venue.neighborhood).toBe("Financial District");
      expect(raw.timezone).toBe("America/Los_Angeles");
      expect(raw.primaryCategory).toBe("comedy");
      expect(raw.verificationLevel).toBe("official");
      expect(raw.pricing?.isFree).toBe(false);
      expect(raw.pricing?.priceMin).toBe(25);
    }
  });

  it("extracts the Ticketmaster event id as externalId (tm:<id>)", () => {
    const raw = jsonLdToRawEvent(sampleNode, fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw?.identity.externalId).toBe("tm:1C00644FCC73C05A");
  });

  it("converts the local-tz startDate string to a UTC Date", () => {
    const raw = jsonLdToRawEvent(sampleNode, fetchedAt);
    // 2026-06-10T20:00:00-07:00 == 2026-06-11T03:00:00Z
    expect(raw?.startTimeUtc.toISOString()).toBe("2026-06-11T03:00:00.000Z");
  });

  it("normalizes raw → NormalizedEvent with a stable canonical fingerprint", () => {
    const raw = jsonLdToRawEvent(sampleNode, fetchedAt);
    if (!raw) throw new Error("expected raw event from sample node");

    const norm = adapter.normalize(raw, provenance);
    expect(norm.identity.source).toBe("scrape:punchline");
    expect(norm.title).toBe("Helen Hong");
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Punch Line SF");
    expect(norm.pricing.priceMin).toBe(25);
    expect(norm.pricing.priceMax).toBeNull();
    expect(norm.pricing.isFree).toBe(false);
    expect(norm.provenance.pipelineVersion).toBe("m3-test");

    // normalize() is pure: same input → byte-identical output.
    const second = adapter.normalize(raw, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const raw = jsonLdToRawEvent(sampleNode, fetchedAt);
    if (!raw) throw new Error("expected raw event from sample node");
    const norm = adapter.normalize(raw, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("guarantees structured pricing (D13 invariant)", () => {
    const raw = jsonLdToRawEvent(sampleNode, fetchedAt);
    if (!raw) throw new Error("expected raw event from sample node");
    const norm = adapter.normalize(raw, provenance);
    // D13: at least one of priceMin / priceMax / isFree must be populated.
    const populated =
      norm.pricing.priceMin !== null ||
      norm.pricing.priceMax !== null ||
      norm.pricing.isFree === true;
    expect(populated).toBe(true);
  });

  it("returns null for malformed JSON-LD nodes (missing required fields)", () => {
    expect(jsonLdToRawEvent({ "@type": "Event" }, fetchedAt)).toBeNull();
    expect(
      jsonLdToRawEvent(
        { "@type": "Event", name: "Only a title" },
        fetchedAt,
      ),
    ).toBeNull();
  });
});
