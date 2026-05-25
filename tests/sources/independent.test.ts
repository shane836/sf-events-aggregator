import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { describe, expect, it } from "vitest";
import adapter, {
  buildUtcFromLocal,
  extractSlug,
  parseEventItem,
  parseShowtime,
  resolveStartTime,
} from "@/lib/sources/independent";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const provenance: Provenance = {
  adapterId: "scrape:independent",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

const sample: RawEvent = {
  identity: {
    source: "scrape:independent",
    externalId: "rose-gray",
    sourceUrl: "https://www.theindependentsf.com/tm-event/rose-gray/",
  },
  title: "Rose Gray",
  description: "with Sergi(ooh)",
  startTimeUtc: new Date("2026-05-25T03:00:00Z"), // 8:00 PM PDT on 5/24
  endTimeUtc: null,
  timezone: "America/Los_Angeles",
  venue: {
    name: "The Independent",
    address: "628 Divisadero St, San Francisco, CA 94117",
    neighborhood: "Western Addition / NoPa",
    lat: 37.7762,
    lng: -122.4377,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "music",
  pricing: { priceMin: null, priceMax: null, isFree: false },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { slug: "rose-gray" },
  fetchedAt,
};

describe("The Independent adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:independent");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:independent");
    expect(norm.identity.externalId).toBe("rose-gray");
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toBe("Rose Gray");
    expect(norm.category).toBe("music");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("The Independent");
    expect(norm.venue.neighborhood).toBe("Western Addition / NoPa");
    expect(norm.venue.lat).toBeCloseTo(37.7762, 3);
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize() is pure — byte-identical on repeat
    expect(adapter.normalize(sample, provenance)).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12) and pricing shape (D13)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.pricing).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
  });

  it("normalize() makes no IO and is synchronous", () => {
    const a = adapter.normalize(sample, provenance);
    const b = adapter.normalize(sample, provenance);
    expect(a).toEqual(b);
  });
});

describe("Independent CSS parser", () => {
  const fixturePath = resolve(__dirname, "../../fixtures/raw/independent.html");
  const html = readFileSync(fixturePath, "utf8");

  it("finds at least 10 event items in the fixture", () => {
    const $ = cheerio.load(html);
    const items = $(".tw-event-item");
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("parses a representative event row (Rose Gray, 5.24, 8 PM)", () => {
    const $ = cheerio.load(html);
    const $row = $(".tw-event-item")
      .filter((_, el) => $(el).find(".tw-name a").text().trim() === "Rose Gray")
      .first();
    expect($row.length).toBe(1);

    const now = new Date("2026-05-20T12:00:00Z");
    const raw = parseEventItem(
      $,
      $row.get(0) as AnyNode,
      now,
      "https://www.theindependentsf.com/",
    );
    expect(raw).not.toBeNull();
    if (!raw) return;

    expect(raw.title).toBe("Rose Gray");
    expect(raw.identity.externalId).toBe("rose-gray");
    expect(raw.identity.sourceUrl).toBe(
      "https://www.theindependentsf.com/tm-event/rose-gray/",
    );
    expect(raw.primaryCategory).toBe("music");
    expect(raw.timezone).toBe("America/Los_Angeles");
    expect(raw.venue.name).toBe("The Independent");
    expect(raw.pricing).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });

    // 8:00 PM PDT on 2026-05-24 = 03:00 UTC on 2026-05-25
    expect(raw.startTimeUtc.toISOString()).toBe("2026-05-25T03:00:00.000Z");
  });

  it("never emits a row with empty sourceUrl or externalId", () => {
    const $ = cheerio.load(html);
    const now = new Date("2026-05-20T12:00:00Z");
    let parsed = 0;
    $(".tw-event-item").each((_, el) => {
      const raw = parseEventItem(
        $,
        el as AnyNode,
        now,
        "https://www.theindependentsf.com/",
      );
      if (!raw) return;
      parsed++;
      expect(raw.identity.sourceUrl.length).toBeGreaterThan(0);
      expect(raw.identity.externalId.length).toBeGreaterThan(0);
      expect(raw.title.length).toBeGreaterThan(0);
      expect(raw.venue.name).toBe("The Independent");
      expect(raw.timezone).toBe("America/Los_Angeles");
    });
    expect(parsed).toBeGreaterThanOrEqual(10);
  });
});

describe("extractSlug", () => {
  it("pulls the tm-event slug", () => {
    expect(
      extractSlug("https://www.theindependentsf.com/tm-event/rose-gray/"),
    ).toBe("rose-gray");
    expect(extractSlug("/tm-event/old-mervs/")).toBe("old-mervs");
  });

  it("lowercases the slug", () => {
    expect(extractSlug("/tm-event/Rose-Gray/")).toBe("rose-gray");
  });

  it("falls back to last path segment", () => {
    expect(extractSlug("https://example.com/some/other/path/")).toBe("path");
  });

  it("returns null for empty / invalid input", () => {
    expect(extractSlug("")).toBeNull();
  });
});

describe("parseShowtime", () => {
  it("parses 12-hour times", () => {
    expect(parseShowtime("8:00 PM")).toEqual({ hour: 20, minute: 0 });
    expect(parseShowtime("10:30 pm")).toEqual({ hour: 22, minute: 30 });
    expect(parseShowtime("8 pm")).toEqual({ hour: 20, minute: 0 });
    expect(parseShowtime("12:15 am")).toEqual({ hour: 0, minute: 15 });
    expect(parseShowtime("12:00 PM")).toEqual({ hour: 12, minute: 0 });
  });

  it("returns null on garbage", () => {
    expect(parseShowtime("")).toBeNull();
    expect(parseShowtime(null)).toBeNull();
    expect(parseShowtime("tba")).toBeNull();
  });
});

describe("buildUtcFromLocal", () => {
  it("converts LA wall time to UTC across DST (PDT = UTC-7)", () => {
    // 2026-05-24 20:00 PDT → 2026-05-25 03:00 UTC
    const utc = buildUtcFromLocal(2026, 5, 24, 20, 0);
    expect(utc?.toISOString()).toBe("2026-05-25T03:00:00.000Z");
  });

  it("converts LA wall time to UTC outside DST (PST = UTC-8)", () => {
    // 2026-01-15 20:00 PST → 2026-01-16 04:00 UTC
    const utc = buildUtcFromLocal(2026, 1, 15, 20, 0);
    expect(utc?.toISOString()).toBe("2026-01-16T04:00:00.000Z");
  });

  it("returns null for an impossible local date (Feb 30)", () => {
    expect(buildUtcFromLocal(2026, 2, 30, 20, 0)).toBeNull();
  });
});

describe("resolveStartTime", () => {
  const now = new Date("2026-05-20T12:00:00Z");

  it("picks the upcoming year for a date this month", () => {
    const t = resolveStartTime("5.24", "Sun", "8:00 PM", now);
    expect(t?.toISOString()).toBe("2026-05-25T03:00:00.000Z");
  });

  it("uses the day-of-week label to disambiguate the year near wrap", () => {
    // 1.15 in 2027 is a Friday; in 2028 it's a Saturday.
    const december = new Date("2026-12-20T12:00:00Z");
    const t = resolveStartTime("1.15", "Fri", "8:00 PM", december);
    expect(t).not.toBeNull();
    const isoYear = t!.toISOString().slice(0, 4);
    expect(isoYear).toBe("2027");
  });

  it("defaults to 8 PM if no showtime is given", () => {
    const t = resolveStartTime("5.24", "Sun", null, now);
    expect(t?.toISOString()).toBe("2026-05-25T03:00:00.000Z");
  });

  it("returns null for an unparseable date string", () => {
    expect(resolveStartTime("not-a-date", "Sun", "8 pm", now)).toBeNull();
  });
});
