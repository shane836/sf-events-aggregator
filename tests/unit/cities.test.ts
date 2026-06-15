import { describe, expect, it } from "vitest";
import {
  citiesForSelection,
  DEFAULT_CITY,
  EAST_BAY_CITY_NAMES,
  GENERIC_EAST_BAY,
  isKnownCity,
  resolveCity,
} from "@/lib/ui/cities";
import { buildSearchString, parseFilters } from "@/lib/ui/filters";

describe("resolveCity", () => {
  it("defaults to San Francisco for missing/unknown input", () => {
    expect(resolveCity(null)).toBe(DEFAULT_CITY);
    expect(resolveCity(undefined)).toBe(DEFAULT_CITY);
    expect(resolveCity("")).toBe(DEFAULT_CITY);
    expect(resolveCity("Atlantis")).toBe(DEFAULT_CITY);
  });

  it("matches known selections case-insensitively and canonicalizes", () => {
    expect(resolveCity("oakland")).toBe("Oakland");
    expect(resolveCity("BERKELEY")).toBe("Berkeley");
    expect(resolveCity("east bay")).toBe("East Bay");
    expect(resolveCity("san francisco")).toBe("San Francisco");
    // Contra Costa County cities are covered too.
    expect(resolveCity("walnut creek")).toBe("Walnut Creek");
    expect(resolveCity("Richmond")).toBe("Richmond");
  });

  it("isKnownCity gates on the canonical token", () => {
    expect(isKnownCity("East Bay")).toBe(true);
    expect(isKnownCity("Emeryville")).toBe(true);
    expect(isKnownCity("oakland")).toBe(false); // canonical only
    expect(isKnownCity("San Jose")).toBe(false); // out of region
  });
});

describe("citiesForSelection", () => {
  it("maps a single-city token to one venue city", () => {
    expect(citiesForSelection("Oakland")).toEqual(["Oakland"]);
    expect(citiesForSelection("San Francisco")).toEqual(["San Francisco"]);
  });

  it("fans the East Bay umbrella out to every East Bay city + generic bucket", () => {
    expect(citiesForSelection("East Bay")).toEqual([
      ...EAST_BAY_CITY_NAMES,
      GENERIC_EAST_BAY,
    ]);
  });

  it("falls back to the default city for unknown input", () => {
    expect(citiesForSelection("nope")).toEqual(["San Francisco"]);
  });
});

describe("filters — city round-trip", () => {
  it("parses ?city= into a resolved token, defaulting to SF", () => {
    expect(parseFilters({}).city).toBe(DEFAULT_CITY);
    expect(parseFilters({ city: "Berkeley" }).city).toBe("Berkeley");
    expect(parseFilters({ city: "East Bay" }).city).toBe("East Bay");
    expect(parseFilters({ city: "nope" }).city).toBe(DEFAULT_CITY);
  });

  it("omits city from the URL when default, includes it otherwise", () => {
    const base = parseFilters({});
    expect(buildSearchString(base)).not.toContain("city=");

    const eastBay = parseFilters({ city: "East Bay" });
    expect(buildSearchString(eastBay)).toContain("city=East");
  });
});
