import { describe, expect, it } from "vitest";
import adapter, {
  buildRawEvent,
  extractFirstTime,
  extractPricing,
  parseTitleDate,
  resolveEventYear,
} from "@/lib/sources/dancemission";
import type { Provenance, RawEvent } from "@/lib/sources/types";

const fetchedAt = new Date("2026-05-25T00:00:00Z");

// Shape mirrors what dancemissiontheater.org WP REST returns: title prefix
// carries the date, body carries time + price hints.
const samplePost = {
  id: 12345,
  date: "2026-04-22T18:39:48",
  link: "https://dancemissiontheater.org/2026/04/22/june-13-it-takes-a-village-benefit-performance-for-families-of-gaza/",
  title: {
    rendered:
      "June 13: It Takes a Village: Benefit Performance for Families of Gaza",
  },
  excerpt: { rendered: "<p>Benefit performance...</p>" },
  content: {
    rendered:
      "<p>Watermelon Connections presents It Takes a Village: Benefit Performance for Families of Gaza</p>" +
      "<p>Saturday, June 13 at 7pm</p>" +
      "<p>Dance Mission Theater</p>" +
      "<p>$30-300 suggested donation. All donations go directly to families in Gaza.</p>" +
      "<p>Tickets: Buy now</p>",
  },
};

const provenance: Provenance = {
  adapterId: "scrape:dancemission",
  adapterVersion: "1.0",
  pipelineVersion: "m1-v2-test",
  normalizedAt: new Date("2026-05-25T00:00:00Z"),
};

describe("Dance Mission adapter — identity", () => {
  it("advertises the right identity", () => {
    expect(adapter.id).toBe("scrape:dancemission");
    expect(adapter.tier).toBe("scrape");
    expect(adapter.verificationLevel).toBe("official");
  });
});

describe("Dance Mission adapter — title date parsing", () => {
  it("parses single-day prefix: 'June 13:'", () => {
    const t = parseTitleDate("June 13: It Takes a Village");
    expect(t).not.toBeNull();
    expect(t?.startMonth).toBe(5);
    expect(t?.startDay).toBe(13);
    expect(t?.endMonth).toBe(5);
    expect(t?.endDay).toBe(13);
    expect(t?.explicitYear).toBeNull();
    expect(t?.displayTitle).toBe("It Takes a Village");
  });

  it("parses same-month range prefix: 'May 22-24:'", () => {
    const t = parseTitleDate("May 22-24: HomeGrown");
    expect(t?.startMonth).toBe(4);
    expect(t?.startDay).toBe(22);
    expect(t?.endMonth).toBe(4);
    expect(t?.endDay).toBe(24);
  });

  it("parses cross-month range prefix: 'May 1-May 3:'", () => {
    const t = parseTitleDate(
      "May 1-May 3: San Francisco International Arts Festival",
    );
    expect(t?.startMonth).toBe(4);
    expect(t?.startDay).toBe(1);
    expect(t?.endMonth).toBe(4);
    expect(t?.endDay).toBe(3);
  });

  it("parses prefix with explicit year: 'March 21-22, 2026:'", () => {
    const t = parseTitleDate(
      "March 21-22, 2026: The Spring Choreographers Showcase",
    );
    expect(t?.startMonth).toBe(2);
    expect(t?.startDay).toBe(21);
    expect(t?.endDay).toBe(22);
    expect(t?.explicitYear).toBe(2026);
  });

  it("decodes HTML entities in display title (smart quotes, ampersand)", () => {
    const t = parseTitleDate(
      "May 22-24: &#8220;HomeGrown&#8221; &#038; &#8220;The Ground Works&#8221;",
    );
    expect(t?.displayTitle).toBe('"HomeGrown" & "The Ground Works"');
  });

  it("returns null for a title with no date prefix", () => {
    expect(parseTitleDate("Some random post about classes")).toBeNull();
  });
});

describe("Dance Mission adapter — year resolution", () => {
  it("uses the explicit year when the title provides one", () => {
    const t = parseTitleDate("March 21-22, 2026: Showcase")!;
    expect(resolveEventYear(t, new Date("2025-11-01T00:00:00Z"))).toBe(2026);
  });

  it("uses publication year when event month >= publication month", () => {
    const t = parseTitleDate("June 13: Event")!;
    expect(resolveEventYear(t, new Date("2026-04-22T00:00:00Z"))).toBe(2026);
  });

  it("rolls to next year when event month is well before publication month", () => {
    const t = parseTitleDate("January 5: Event")!;
    expect(resolveEventYear(t, new Date("2026-11-01T00:00:00Z"))).toBe(2027);
  });
});

describe("Dance Mission adapter — time extraction", () => {
  it("extracts '7pm'", () => {
    expect(extractFirstTime("Saturday, June 13 at 7pm")).toEqual({
      hour: 19,
      minute: 0,
    });
  });
  it("extracts '5:30pm'", () => {
    expect(extractFirstTime("doors at 5:30pm")).toEqual({
      hour: 17,
      minute: 30,
    });
  });
  it("extracts '10am'", () => {
    expect(extractFirstTime("Sunday at 10am parade")).toEqual({
      hour: 10,
      minute: 0,
    });
  });
  it("handles 12pm noon correctly", () => {
    expect(extractFirstTime("noon kickoff at 12pm")).toEqual({
      hour: 12,
      minute: 0,
    });
  });
  it("handles 12am midnight correctly", () => {
    expect(extractFirstTime("after-hours at 12am")).toEqual({
      hour: 0,
      minute: 0,
    });
  });
  it("returns null when no time is present", () => {
    expect(extractFirstTime("no time mentioned here")).toBeNull();
  });
});

describe("Dance Mission adapter — price extraction", () => {
  it("flags free events", () => {
    expect(extractPricing("Free admission, all ages")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: true,
    });
  });
  it("extracts a price range", () => {
    expect(extractPricing("$30-300 suggested donation")).toEqual({
      priceMin: 30,
      priceMax: 300,
      isFree: false,
    });
  });
  it("extracts a single price", () => {
    expect(extractPricing("Only 50 tickets at $200/person")).toEqual({
      priceMin: 200,
      priceMax: 200,
      isFree: false,
    });
  });
  it("returns unknown-but-not-free when no price mentioned", () => {
    expect(extractPricing("Tickets: Buy now. Great event.")).toEqual({
      priceMin: null,
      priceMax: null,
      isFree: false,
    });
  });
});

describe("Dance Mission adapter — buildRawEvent integration", () => {
  it("builds a complete RawEvent from a WP post payload", () => {
    const raw = buildRawEvent(samplePost, fetchedAt);
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(raw.identity.source).toBe("scrape:dancemission");
    expect(raw.identity.externalId).toBe("dmt-12345");
    expect(raw.identity.sourceUrl).toBe(samplePost.link);
    expect(raw.identity.sourceUrl.length).toBeGreaterThan(0);
    expect(raw.title).toBe(
      "It Takes a Village: Benefit Performance for Families of Gaza",
    );
    expect(raw.timezone).toBe("America/Los_Angeles");
    expect(raw.primaryCategory).toBe("dancing");
    expect(raw.verificationLevel).toBe("official");
    expect(raw.venue.name).toBe("Dance Mission Theater");
    expect(raw.venue.neighborhood).toBe("Mission");
    expect(raw.pricing).toEqual({ priceMin: 30, priceMax: 300, isFree: false });
    // June 13, 2026 at 7pm PT == 2026-06-14T02:00:00Z (PDT, UTC-7)
    expect(raw.startTimeUtc.toISOString()).toBe("2026-06-14T02:00:00.000Z");
  });

  it("returns null for posts that don't have a parseable date prefix", () => {
    const bogus = {
      ...samplePost,
      id: 999,
      title: { rendered: "Welcome to our 2026 season" },
    };
    expect(buildRawEvent(bogus, fetchedAt)).toBeNull();
  });
});

describe("Dance Mission adapter — normalize", () => {
  const raw = buildRawEvent(samplePost, fetchedAt) as RawEvent;

  it("produces a stable canonical fingerprint", () => {
    const a = adapter.normalize(raw, provenance);
    const b = adapter.normalize(raw, provenance);
    expect(a).toEqual(b);
    expect(a.canonicalFingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it("preserves identity.sourceUrl (D12 invariant)", () => {
    const n = adapter.normalize(raw, provenance);
    expect(n.identity.sourceUrl.length).toBeGreaterThan(0);
  });

  it("emits structured pricing (D13 invariant — never null when known)", () => {
    const n = adapter.normalize(raw, provenance);
    // Sample has $30-300 — both bounds must populate.
    expect(n.pricing.priceMin).toBe(30);
    expect(n.pricing.priceMax).toBe(300);
    expect(n.pricing.isFree).toBe(false);
  });

  it("carries timezone through normalize", () => {
    const n = adapter.normalize(raw, provenance);
    expect(n.timezone).toBe("America/Los_Angeles");
  });
});
