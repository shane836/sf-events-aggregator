import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildDailyEvent,
  localDateAtHour,
  nextLocalDates,
} from "@/lib/sources/sparksocial";
import { formatLocalDate, formatLocalMinute } from "@/lib/identity";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const TZ = "America/Los_Angeles";
const fetchedAt = new Date("2026-05-25T00:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:sparksocial",
    externalId: "sparksocial-2026-06-10",
    sourceUrl: "https://visitsparksocial.com/events/calendar/",
  },
  title: "Spark Social SF — Food Trucks, Bar & Mini Golf (Wednesday)",
  description:
    "Spark Social SF is an open-air community space in Mission Bay with rotating food trucks, a beer garden, mini golf, and event space. Free to attend; food and drink priced individually.",
  startTimeUtc: new Date("2026-06-10T18:00:00Z"), // 11am PDT
  endTimeUtc: new Date("2026-06-11T04:00:00Z"), // 9pm PDT
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
  recurrence: {
    seriesId: "sparksocial-daily",
    occurrenceId: "sparksocial-2026-06-10",
  },
  verificationLevel: "official",
  rawPayload: { localDate: "2026-06-10" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:sparksocial",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Spark Social SF adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:sparksocial");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalizes a raw event into a NormalizedEvent with stable fingerprint", () => {
    const norm = adapter.normalize(sample, provenance);

    expect(norm.identity.source).toBe("scrape:sparksocial");
    expect(norm.identity.externalId).toBe(sample.identity.externalId);
    expect(norm.identity.sourceUrl).toBe(sample.identity.sourceUrl);
    expect(norm.title).toContain("Spark Social SF");
    expect(norm.category).toBe("food");
    expect(norm.timezone).toBe(TZ);
    expect(norm.verificationLevel).toBe("official");
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("Spark Social SF");
    expect(norm.venue.neighborhood).toBe("Mission Bay");
    expect(norm.venue.lat).toBeCloseTo(37.7707793, 5);
    expect(norm.venue.lng).toBeCloseTo(-122.3914307, 5);
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.recurrence?.seriesId).toBe("sparksocial-daily");
    expect(norm.provenance.pipelineVersion).toBe("m1-v2-test");

    // normalize is pure — same input + provenance → byte-identical output
    const second = adapter.normalize(sample, provenance);
    expect(second).toEqual(norm);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing with isFree=true (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    // M3 D2: not (priceMin null AND priceMax null AND isFree false)
    const noPriceData =
      norm.pricing.priceMin == null &&
      norm.pricing.priceMax == null &&
      !norm.pricing.isFree;
    expect(noPriceData).toBe(false);
    expect(norm.pricing.isFree).toBe(true);
    expect(norm.pricing.priceMin).toBeNull();
    expect(norm.pricing.priceMax).toBeNull();
  });
});

describe("localDateAtHour", () => {
  it("returns the correct UTC instant for 11am PDT (UTC-7)", () => {
    // June is PDT (UTC-7): 11am local → 18:00 UTC
    const utc = localDateAtHour("2026-06-10", 11, TZ);
    expect(utc.toISOString()).toBe("2026-06-10T18:00:00.000Z");
  });

  it("returns the correct UTC instant for 11am PST (UTC-8)", () => {
    // January is PST (UTC-8): 11am local → 19:00 UTC
    const utc = localDateAtHour("2026-01-15", 11, TZ);
    expect(utc.toISOString()).toBe("2026-01-15T19:00:00.000Z");
  });

  it("returns the correct UTC instant for 9pm PDT", () => {
    // 21:00 PDT (UTC-7) → 04:00 next-day UTC
    const utc = localDateAtHour("2026-06-10", 21, TZ);
    expect(utc.toISOString()).toBe("2026-06-11T04:00:00.000Z");
  });

  it("round-trips: formatLocalMinute(localDateAtHour(d, h)) yields d at h:00", () => {
    for (const date of ["2026-01-15", "2026-06-10", "2026-11-02"]) {
      for (const hour of [11, 17, 21]) {
        const utc = localDateAtHour(date, hour, TZ);
        const local = formatLocalMinute(utc, TZ);
        const wantHour = hour < 10 ? `0${hour}` : `${hour}`;
        expect(local).toBe(`${date}T${wantHour}:00`);
      }
    }
  });
});

describe("nextLocalDates", () => {
  it("returns 60 distinct, monotonically-increasing local dates", () => {
    const dates = nextLocalDates(fetchedAt, 60);
    expect(dates).toHaveLength(60);
    expect(new Set(dates).size).toBe(60);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
    // First date is today (in PT). fetchedAt is 2026-05-25T00:00Z → that's
    // 2026-05-24 17:00 PDT, so the first local date is "2026-05-24".
    expect(dates[0]).toBe(formatLocalDate(fetchedAt, TZ));
  });
});

describe("buildDailyEvent", () => {
  it("builds a Wednesday event with Mon-Sat hours (11am-9pm PT)", () => {
    // 2026-06-10 is a Wednesday.
    const ev = buildDailyEvent("2026-06-10", fetchedAt)!;
    expect(ev).not.toBeNull();
    expect(ev.identity.externalId).toBe("sparksocial-2026-06-10");
    expect(ev.title).toContain("Wednesday");
    expect(formatLocalMinute(ev.startTimeUtc, TZ)).toBe("2026-06-10T11:00");
    expect(formatLocalMinute(ev.endTimeUtc!, TZ)).toBe("2026-06-10T21:00");
    expect(ev.pricing?.isFree).toBe(true);
    expect(ev.primaryCategory).toBe("food");
  });

  it("builds a Sunday event with abbreviated hours (11am-5pm PT)", () => {
    // 2026-06-14 is a Sunday.
    const ev = buildDailyEvent("2026-06-14", fetchedAt)!;
    expect(ev).not.toBeNull();
    expect(ev.title).toContain("Sunday");
    expect(formatLocalMinute(ev.startTimeUtc, TZ)).toBe("2026-06-14T11:00");
    expect(formatLocalMinute(ev.endTimeUtc!, TZ)).toBe("2026-06-14T17:00");
  });

  it("produces distinct canonical fingerprints across consecutive days", () => {
    const a = buildDailyEvent("2026-06-10", fetchedAt)!;
    const b = buildDailyEvent("2026-06-11", fetchedAt)!;
    const aNorm = adapter.normalize(a, provenance);
    const bNorm = adapter.normalize(b, provenance);
    expect(aNorm.canonicalFingerprint).not.toBe(bNorm.canonicalFingerprint);
  });

  it("uses the canonical events listing URL as sourceUrl", () => {
    const ev = buildDailyEvent("2026-06-10", fetchedAt)!;
    expect(ev.identity.sourceUrl).toBe(
      "https://visitsparksocial.com/events/calendar/",
    );
  });
});

describe("Spark Social fixture regression", () => {
  it("the saved HTML fixture loads and is non-empty", () => {
    const html = readFileSync(
      resolve(process.cwd(), "fixtures/raw/sparksocial.html"),
      "utf-8",
    );
    expect(html.length).toBeGreaterThan(10_000);
    // The page redirects to visitsparksocial.com and renders the Elfsight
    // widget tag — if either changes, the schedule-expansion approach may
    // need to be revisited (the widget tag is our only signal that the
    // calendar is still client-side rendered).
    expect(html.toLowerCase()).toContain("upcoming events");
    expect(html.toLowerCase()).toContain("elfsight");
  });
});
