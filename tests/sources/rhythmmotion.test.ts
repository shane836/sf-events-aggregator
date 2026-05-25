import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter, {
  buildUtcFromLocal,
  expandWeekly,
  parseClassLine,
  parseSchedule,
} from "@/lib/sources/rhythmmotion";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fixture = readFileSync(
  resolve(__dirname, "../../fixtures/raw/rhythmmotion.html"),
  "utf8",
);

const fetchedAt = new Date("2026-05-25T07:00:00Z");

const sample: RawEvent = {
  identity: {
    source: "scrape:rhythmmotion",
    externalId: "fusion-sundays-katie-clay-2026-05-31",
    sourceUrl:
      "https://www.rhythmandmotion.com/sf-odc#fusion-sundays-katie-clay",
  },
  title: "Rhythm & Motion: Fusion with Katie Clay",
  description: "Drop-in in-person dance class at ODC Dance Commons.",
  startTimeUtc: new Date("2026-05-31T15:30:00Z"), // 8:30am PT on a Sunday
  endTimeUtc: new Date("2026-05-31T16:30:00Z"),
  timezone: "America/Los_Angeles",
  venue: {
    name: "ODC Dance Commons",
    address: "351 Shotwell St, San Francisco, CA 94110",
    neighborhood: "Mission",
    lat: 37.7651,
    lng: -122.4156,
    timezone: "America/Los_Angeles",
  },
  primaryCategory: "dancing",
  pricing: { priceMin: 21, priceMax: 21, isFree: false },
  recurrence: {
    seriesId: "rhythmmotion:fusion-sundays-katie-clay",
    occurrenceId: "2026-05-31",
  },
  verificationLevel: "official",
  rawPayload: { rawText: "8:30am Fusion Sundays in-person with Katie Clay" },
  fetchedAt,
};

const provenance: Provenance = {
  adapterId: "scrape:rhythmmotion",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T07:00:00Z"),
};

describe("Rhythm & Motion adapter", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:rhythmmotion");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });

  it("normalize() is pure: same input + provenance → byte-identical output", () => {
    const a = adapter.normalize(sample, provenance);
    const b = adapter.normalize(sample, provenance);
    expect(a).toEqual(b);
  });

  it("normalizes raw → DB-ready row with stable fingerprint and D12/D13 fields", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.source).toBe("scrape:rhythmmotion");
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(norm.title).toBe(sample.title);
    expect(norm.category).toBe("dancing");
    expect(norm.timezone).toBe("America/Los_Angeles");
    expect(norm.pricing.priceMin).toBe(21);
    expect(norm.pricing.priceMax).toBe(21);
    expect(norm.pricing.isFree).toBe(false);
    expect(norm.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(norm.venue.name).toBe("ODC Dance Commons");
    expect(norm.venue.neighborhood).toBe("Mission");
    expect(norm.recurrence?.seriesId).toBe(
      "rhythmmotion:fusion-sundays-katie-clay",
    );
  });

  it("preserves non-empty identity.sourceUrl (D12 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(norm.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("structured pricing is non-null (D13 invariant)", () => {
    const norm = adapter.normalize(sample, provenance);
    expect(
      norm.pricing.priceMin !== null ||
        norm.pricing.priceMax !== null ||
        norm.pricing.isFree,
    ).toBe(true);
  });
});

describe("Rhythm & Motion fixture parsing", () => {
  it("extracts all 28 weekly classes from the /sf-odc fixture", () => {
    const classes = parseSchedule(fixture);
    expect(classes.length).toBe(28);
  });

  it("parses a fully-specified line correctly", () => {
    const c = parseClassLine(
      "8:30am Fusion Sundays in-person with Katie Clay",
      null,
    );
    expect(c).not.toBeNull();
    expect(c!.hour).toBe(8);
    expect(c!.minute).toBe(30);
    expect(c!.className).toBe("Fusion");
    expect(c!.dayIndex).toBe(0);
    expect(c!.modality).toBe("in-person");
    expect(c!.instructor).toBe("Katie Clay");
  });

  it("inherits the previous day when a line omits a day name", () => {
    // Real fixture quirk: "10am Fusion in-person with Dudley Flores" appears
    // between Wednesday entries. With Wednesday inherited (3), should resolve.
    const c = parseClassLine(
      "10am Fusion in-person with Dudley Flores",
      3,
    );
    expect(c).not.toBeNull();
    expect(c!.dayIndex).toBe(3);
    expect(c!.hour).toBe(10);
  });

  it("defaults missing am/pm to pm (evening classes in the fixture)", () => {
    const c = parseClassLine(
      "5:45 Modern Thursdays in-person with Katie Clay",
      null,
    );
    expect(c).not.toBeNull();
    expect(c!.hour).toBe(17);
    expect(c!.minute).toBe(45);
    expect(c!.dayIndex).toBe(4);
  });

  it("recognizes hybrid modality and strips the parenthetical", () => {
    const c = parseClassLine(
      "5:45pm Fusion Mondays hybrid (in-person and livestream) with Aimee Zawitz",
      null,
    );
    expect(c).not.toBeNull();
    expect(c!.modality).toBe("hybrid");
    expect(c!.className).toBe("Fusion");
  });

  it("12pm parses to noon, not midnight", () => {
    const c = parseClassLine(
      "12pm Modern Tuesdays in-person with Jessica Lutes",
      null,
    );
    expect(c).not.toBeNull();
    expect(c!.hour).toBe(12);
  });
});

describe("Rhythm & Motion recurrence expansion", () => {
  it("expandWeekly returns one date per week within the horizon", () => {
    // 2026-05-25 is a Monday. Asking for Sundays (0) with 60 days should
    // return Sun 5/31, 6/7, 6/14, 6/21, 6/28, 7/5, 7/12, 7/19. = 8 occurrences.
    const dates = expandWeekly(
      { year: 2026, month: 5, day: 25 },
      0,
      60,
    );
    expect(dates.length).toBeGreaterThanOrEqual(8);
    expect(dates.length).toBeLessThanOrEqual(9);
    expect(dates[0]).toEqual({ year: 2026, month: 5, day: 31 });
  });

  it("buildUtcFromLocal handles PT (DST-active in summer)", () => {
    // 8:30am PT on 2026-05-31 (PDT, UTC-7) → 15:30Z
    const utc = buildUtcFromLocal(
      { year: 2026, month: 5, day: 31 },
      8,
      30,
      "America/Los_Angeles",
    );
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-05-31T15:30:00.000Z");
  });

  it("buildUtcFromLocal handles PT in winter (PST, UTC-8)", () => {
    // 8:30am PT on 2026-12-06 (PST, UTC-8) → 16:30Z
    const utc = buildUtcFromLocal(
      { year: 2026, month: 12, day: 6 },
      8,
      30,
      "America/Los_Angeles",
    );
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-12-06T16:30:00.000Z");
  });
});
