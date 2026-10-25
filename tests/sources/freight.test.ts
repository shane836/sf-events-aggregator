import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import adapter, { classifyCategory } from "@/lib/sources/freight";

const fixture = JSON.parse(readFileSync("fixtures/raw/freight-ticketing.json", "utf8"));
const now = new Date("2026-10-24T00:00:00Z");
async function fetchBody(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  return adapter.fetch();
}

describe("Freight official ticketing calendar", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("uses the public ticketing calendar with bounded requests and stable performance identities", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const result = await fetchBody(fixture);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://secure.thefreight.org/api/products/productionseasons");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body)).productionSeasonIdFilter).toEqual([]);
    expect(result.events[0]).toMatchObject({
      identity: { source: "scrape:freight", externalId: "performance:16065" },
      title: "John Gorka", startTimeUtc: new Date("2026-10-25T03:00:00Z"),
      venue: { city: "Berkeley" }, pricing: { priceMin: null, priceMax: null, isFree: false },
    });
    expect(result.events[1].title).not.toMatch(/<|>/);
  });
  it("preserves identities across time changes and deduplicates repeated performance cards", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const data = structuredClone(fixture);
    data.productions.push(data.productions[0]);
    data.productions[0].performances[0].performanceDate = "2026-11-01T04:00:00Z";
    const result = await fetchBody(data);
    expect(result.events).toHaveLength(3);
    expect(result.events[0].identity.externalId).toBe("performance:16065");
    expect(result.events[0].startTimeUtc.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
  it("accepts a genuinely empty calendar and excludes past and hidden performances", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    expect((await fetchBody({ productions: [] })).errors).toEqual([]);
    const data = structuredClone(fixture);
    data.productions[0].performances[0].performanceDate = "2026-10-01T04:00:00Z";
    data.productions[1].performances[0].isPerformanceVisible = false;
    expect((await fetchBody(data)).events).toHaveLength(1);
  });
  it.each([{}, { productions: "unexpected" }, { productions: [{}] }])("surfaces response contract changes: %j", async body => {
    const result = await fetchBody(body);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].stage).toBe("parse");
  });
  it("reports malformed dates without discarding the valid performances", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const data = structuredClone(fixture);
    data.productions[0].performances[0].performanceDate = "2026-10-25T20:00:00";
    const result = await fetchBody(data);
    expect(result.events).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });
  it("keeps category classification", () => {
    expect(classifyCategory("Iris DeMent")).toBe("music");
    expect(classifyCategory("Fiddle Workshop")).toBe("lectures");
    expect(classifyCategory("An Evening of Comedy")).toBe("comedy");
  });

  it("expands multiple performances but excludes listings ticketed at other venues", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const data = structuredClone(fixture);
    data.productions[0].performances.push({ ...data.productions[0].performances[0], id: 99999, performanceDate: "2026-12-01T04:00:00Z" });
    data.productions[1].performances[0].actionUrl = "https://berkeleypubliclibrary.libnet.info/event/17282847";
    const result = await fetchBody(data);
    expect(result.events).toHaveLength(3);
    expect(result.events.some(e => e.identity.externalId === "performance:99999")).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
