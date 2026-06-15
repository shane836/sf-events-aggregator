import { describe, expect, it } from "vitest";
import { DEFAULT_CITY, isKnownCity, resolveCity } from "@/lib/ui/cities";
import { buildSearchString, parseFilters } from "@/lib/ui/filters";

describe("resolveCity", () => {
  it("defaults to San Francisco for missing/unknown input", () => {
    expect(resolveCity(null)).toBe(DEFAULT_CITY);
    expect(resolveCity(undefined)).toBe(DEFAULT_CITY);
    expect(resolveCity("")).toBe(DEFAULT_CITY);
    expect(resolveCity("Atlantis")).toBe(DEFAULT_CITY);
  });

  it("matches known cities case-insensitively and canonicalizes", () => {
    expect(resolveCity("oakland")).toBe("Oakland");
    expect(resolveCity("OAKLAND")).toBe("Oakland");
    expect(resolveCity("san francisco")).toBe("San Francisco");
  });

  it("isKnownCity gates on the canonical value", () => {
    expect(isKnownCity("Oakland")).toBe(true);
    expect(isKnownCity("oakland")).toBe(false); // canonical only
    expect(isKnownCity("Berkeley")).toBe(false);
  });
});

describe("filters — city round-trip", () => {
  it("parses ?city= into a resolved city, defaulting to SF", () => {
    expect(parseFilters({}).city).toBe(DEFAULT_CITY);
    expect(parseFilters({ city: "Oakland" }).city).toBe("Oakland");
    expect(parseFilters({ city: "nope" }).city).toBe(DEFAULT_CITY);
  });

  it("omits city from the URL when default, includes it otherwise", () => {
    const base = parseFilters({});
    expect(buildSearchString(base)).not.toContain("city=");

    const oakland = parseFilters({ city: "Oakland" });
    expect(buildSearchString(oakland)).toContain("city=Oakland");
  });
});
