import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  classifyCategory,
  parseShowDateTime,
  parseShowsHtml,
} from "@/lib/sources/freight";
import type { Provenance } from "@/lib/sources/types";

const provenance: Provenance = {
  adapterId: "scrape:freight",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-06-15T00:00:00Z"),
};

describe("Freight adapter — identity", () => {
  it("advertises an official Berkeley scrape source", () => {
    expect(adapter.id).toBe("scrape:freight");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });
});

describe("parseShowDateTime", () => {
  it("combines Freight's date string + time into a PT-correct UTC Date", () => {
    // 7:00 PM PT on 2026-06-18 (PDT = UTC-7) -> 02:00Z next day.
    const d = parseShowDateTime("Thursday, Jun 18th 2026", "7:00 PM");
    expect(d?.toISOString()).toBe("2026-06-19T02:00:00.000Z");
  });

  it("defaults to 8pm PT when no time is given", () => {
    const d = parseShowDateTime("Monday, Jun 15th 2026", null);
    expect(d?.toISOString()).toBe("2026-06-16T03:00:00.000Z");
  });

  it("returns null for an unparseable date", () => {
    expect(parseShowDateTime("coming soon", "7:00 PM")).toBeNull();
  });
});

describe("classifyCategory", () => {
  it("defaults to music, with workshops/comedy nudged aside", () => {
    expect(classifyCategory("Iris DeMent")).toBe("music");
    expect(classifyCategory("Fiddle Workshop with Alasdair")).toBe("lectures");
    expect(classifyCategory("An Evening of Comedy")).toBe("comedy");
  });
});

describe("Freight fixture parsing (regression)", () => {
  it("parses real show cards from the saved /shows/ fixture", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/freight-shows.html"),
      "utf-8",
    );
    const shows = parseShowsHtml(html);
    expect(shows.length).toBeGreaterThanOrEqual(5);

    const fingerprints = new Set<string>();
    for (const show of shows) {
      expect(show.title.length).toBeGreaterThan(0);
      expect(show.url).toMatch(/thefreight\.org/);
      expect(show.startTimeUtc.getTime()).toBeGreaterThan(
        new Date("2026-01-01").getTime(),
      );
      // The full pipeline: every parsed show normalizes cleanly to Berkeley.
      const raw = {
        identity: { source: "scrape:freight", externalId: show.url, sourceUrl: show.url },
        title: show.title,
        description: null,
        startTimeUtc: show.startTimeUtc,
        endTimeUtc: null,
        timezone: "America/Los_Angeles",
        venue: { name: "Freight & Salvage", city: "Berkeley", timezone: "America/Los_Angeles" },
        primaryCategory: classifyCategory(show.title),
        pricing: { priceMin: null, priceMax: null, isFree: false },
        recurrence: null,
        verificationLevel: "official" as const,
        rawPayload: {},
        fetchedAt: new Date(),
      };
      const norm = adapter.normalize(raw, provenance);
      expect(norm.venue.city).toBe("Berkeley");
      expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
      fingerprints.add(norm.canonicalFingerprint);
    }
    expect(fingerprints.size).toBeGreaterThanOrEqual(5);
  });
});
