import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  parseFreeIntros,
  pacificWallTimeToUtc,
  resolveYear,
} from "@/lib/sources/sfcomedycollege";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const FIXTURE = readFileSync(
  resolve(process.cwd(), "fixtures/raw/sfcomedycollege.html"),
  "utf-8",
);

const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:sfcomedycollege",
    externalId: "free-intro-2026-06-16",
    sourceUrl: "https://www.sfcomedycollege.com/2026-schedule.html",
  },
  title: "SFCC Free Intro to Stand-Up Comedy",
  description: "Free 1.5-hour introductory stand-up comedy workshop.",
  startTimeUtc: new Date("2026-06-17T01:00:00Z"), // 6pm PDT
  endTimeUtc: new Date("2026-06-17T02:30:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "SF Comedy College",
    neighborhood: "Chinatown",
    address: "868 Kearny St, San Francisco, CA 94108",
    lat: null,
    lng: null,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "comedy",
  pricing: { priceMin: null, priceMax: null, isFree: true },
  recurrence: null,
  verificationLevel: "official",
  rawPayload: { listingUrl: "https://www.sfcomedycollege.com/2026-schedule.html" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:sfcomedycollege",
  adapterVersion: "1.0",
  pipelineVersion: "m3-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("SF Comedy College adapter — identity", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:sfcomedycollege");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });
});

describe("SF Comedy College adapter — parseFreeIntros", () => {
  it("extracts all Free Intro lines from the live fixture", () => {
    const intros = parseFreeIntros(FIXTURE);
    // Snapshot of upstream as of 2026-05-24: 4 Tuesday + 4 Wednesday sessions.
    expect(intros.length).toBeGreaterThanOrEqual(6);
    expect(intros.length).toBeLessThanOrEqual(20);
  });

  it("parses month, day, and 24-hour time correctly", () => {
    const intros = parseFreeIntros(
      "Free Intro – Tuesday, April 21st, 6:00 PM",
    );
    expect(intros).toHaveLength(1);
    expect(intros[0]).toMatchObject({
      monthIdx: 3, // April = 3
      day: 21,
      hour24: 18,
      minute: 0,
    });
  });

  it("handles abbreviated months (Sept, Aug, Dec) and ordinal suffixes", () => {
    const samples = [
      "Free Intro – Wednesday, Sept 23rd, 6:00 PM",
      "Free Intro – Tuesday, Aug 18th, 6:00 PM",
      "Free Intro – Wednesday, Dec 3rd, 6:00 PM",
    ].join("\n");
    const intros = parseFreeIntros(samples);
    expect(intros).toHaveLength(3);
    expect(intros[0].monthIdx).toBe(8); // Sept
    expect(intros[1].monthIdx).toBe(7); // Aug
    expect(intros[2].monthIdx).toBe(11); // Dec
  });

  it("deduplicates identical date+time entries", () => {
    const dup =
      "Free Intro – Tuesday, April 21st, 6:00 PM\n" +
      "Free Intro – Tuesday, April 21st, 6:00 PM";
    expect(parseFreeIntros(dup)).toHaveLength(1);
  });

  it("decodes HTML entities (&nbsp;, &ndash;) as found in source", () => {
    const raw = "Free Intro &ndash;&nbsp;Tuesday, April 21st,&nbsp;6:00 PM";
    expect(parseFreeIntros(raw)).toHaveLength(1);
  });
});

describe("SF Comedy College adapter — date math", () => {
  it("resolveYear rolls past dates to next year", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    // April already happened in 2026 → 2027
    expect(resolveYear(3, 21, now)).toBe(2027);
    // August still upcoming → 2026
    expect(resolveYear(7, 18, now)).toBe(2026);
  });

  it("resolveYear keeps today's event in the current year (1-day grace)", () => {
    const now = new Date("2026-05-24T20:00:00Z");
    expect(resolveYear(4, 24, now)).toBe(2026);
  });

  it("pacificWallTimeToUtc handles PDT (summer)", () => {
    // June 16 2026 6:00 PM PT = June 17 01:00 UTC (PDT, UTC-7)
    const utc = pacificWallTimeToUtc(2026, 5, 16, 18, 0);
    expect(utc.toISOString()).toBe("2026-06-17T01:00:00.000Z");
  });

  it("pacificWallTimeToUtc handles PST (winter)", () => {
    // Dec 3 2026 6:00 PM PT = Dec 4 02:00 UTC (PST, UTC-8)
    const utc = pacificWallTimeToUtc(2026, 11, 3, 18, 0);
    expect(utc.toISOString()).toBe("2026-12-04T02:00:00.000Z");
  });
});

describe("SF Comedy College adapter — normalize", () => {
  it("produces a fingerprintable NormalizedEvent", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.identity.source).toBe("scrape:sfcomedycollege");
    expect(norm.category).toBe("comedy");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.venue.neighborhood).toBe("Chinatown");
  });

  it("is pure (D10): same input → byte-identical output", () => {
    const a = adapter.normalize(sample, provenance);
    const b = adapter.normalize(sample, provenance);
    expect(b).toEqual(a);
  });

  it("preserves non-empty sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("produces structured pricing (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(
      norm.pricing.isFree === true ||
        norm.pricing.priceMin !== null ||
        norm.pricing.priceMax !== null,
    ).toBe(true);
  });

  it("fingerprint changes when start time shifts by one minute", () => {
    const a = adapter.normalize(sample, provenance);
    const shifted: RawEvent = {
      ...sample,
      startTimeUtc: new Date(sample.startTimeUtc.getTime() + 60_000),
    };
    const b = adapter.normalize(shifted, provenance);
    expect(b.canonicalFingerprint).not.toBe(a.canonicalFingerprint);
  });
});
