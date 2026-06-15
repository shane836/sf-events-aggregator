import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildRawEvent,
  classifyCategory,
  detectCity,
} from "@/lib/sources/funcheapeastbay";
import { parseListingHtml } from "@/lib/funcheap";
import {
  EAST_BAY_CITY_NAMES,
  GENERIC_EAST_BAY,
} from "@/lib/ui/cities";
import type { ParsedListingItem } from "@/lib/funcheap";
import type { Provenance } from "@/lib/sources/types";

const fetchedAt = new Date("2026-06-15T00:00:00Z");
const EAST_BAY_CITIES = [...EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY];

const provenance: Provenance = {
  adapterId: "scrape:funcheapeastbay",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-06-15T00:00:00Z"),
};

function item(overrides: Partial<ParsedListingItem> = {}): ParsedListingItem {
  return {
    postId: "1234567",
    title: "Free Comedy Night in Oakland",
    url: "https://sf.funcheap.com/free-comedy-night/",
    startLocal: "2026-06-20 20:00",
    endLocal: null,
    costText: "FREE",
    venueName: "The New Parish",
    ...overrides,
  };
}

describe("Funcheap East Bay adapter — identity", () => {
  it("advertises a community scrape source", () => {
    expect(adapter.id).toBe("scrape:funcheapeastbay");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("community");
  });
});

describe("classifyCategory", () => {
  it("maps to our taxonomy and skips the rest", () => {
    expect(classifyCategory("Stand-Up Comedy Night", null)).toBe("comedy");
    expect(classifyCategory("Salsa Dancing Social", null)).toBe("dancing");
    expect(classifyCategory("Oakland Wine Tasting", null)).toBe("food");
    expect(classifyCategory("Live Jazz Trio", "The Sound Room")).toBe("music");
    expect(classifyCategory("Author Reading & Q&A", null)).toBe("lectures");
    expect(classifyCategory("5K Fun Run", null)).toBeNull();
  });
});

describe("detectCity", () => {
  it("picks a named East Bay city, else the generic bucket", () => {
    expect(detectCity("Concert in Berkeley", null)).toBe("Berkeley");
    expect(detectCity("Show tonight", "Yoshi's, Oakland")).toBe("Oakland");
    expect(detectCity("A night out", "Some Bar")).toBe(GENERIC_EAST_BAY);
  });
});

describe("buildRawEvent", () => {
  it("builds a normalized-ready event with an East Bay city", () => {
    const raw = buildRawEvent(item(), fetchedAt);
    expect(raw).not.toBeNull();
    expect(raw!.identity.source).toBe("scrape:funcheapeastbay");
    expect(raw!.primaryCategory).toBe("comedy");
    expect(raw!.venue.city).toBe("Oakland"); // title names Oakland
    expect(raw!.pricing?.isFree).toBe(true);

    const norm = adapter.normalize(raw!, provenance);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(adapter.normalize(raw!, provenance)).toEqual(norm);
  });

  it("returns null for items outside the taxonomy or missing a start time", () => {
    expect(buildRawEvent(item({ title: "Community 5K Fun Run", venueName: null }), fetchedAt)).toBeNull();
    expect(buildRawEvent(item({ startLocal: "not-a-date" }), fetchedAt)).toBeNull();
  });
});

describe("Funcheap East Bay fixture parsing (regression)", () => {
  it("parses real East Bay listings from the saved feed", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/funcheap-eastbay.html"),
      "utf-8",
    );
    const items = parseListingHtml(html);
    expect(items.length).toBeGreaterThanOrEqual(10);

    let parsed = 0;
    for (const it of items) {
      const raw = buildRawEvent(it, fetchedAt);
      if (!raw) continue; // skipped by taxonomy — expected for a mixed feed
      parsed++;
      expect(EAST_BAY_CITIES).toContain(raw.venue.city);
      expect(raw.identity.sourceUrl.length).toBeGreaterThan(0);
      const norm = adapter.normalize(raw, provenance);
      expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    }
    expect(parsed).toBeGreaterThanOrEqual(1);
  });
});
