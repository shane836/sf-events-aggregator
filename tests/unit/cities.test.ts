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

  it("recognizes the two selections case-insensitively", () => {
    expect(resolveCity("san francisco")).toBe("San Francisco");
    expect(resolveCity("east bay")).toBe("East Bay");
    expect(resolveCity("EAST BAY")).toBe("East Bay");
  });

  it("treats individual cities as non-selections (folded into East Bay)", () => {
    // The selector is SF / East Bay only — a specific-city token isn't a
    // selection, so it falls back to the default.
    expect(resolveCity("Oakland")).toBe(DEFAULT_CITY);
    expect(resolveCity("Berkeley")).toBe(DEFAULT_CITY);
  });

  it("isKnownCity gates on the canonical selection token", () => {
    expect(isKnownCity("East Bay")).toBe(true);
    expect(isKnownCity("San Francisco")).toBe(true);
    expect(isKnownCity("Oakland")).toBe(false);
    expect(isKnownCity("east bay")).toBe(false); // canonical only
  });
});

describe("citiesForSelection", () => {
  it("maps SF to one venue city", () => {
    expect(citiesForSelection("San Francisco")).toEqual(["San Francisco"]);
  });

  it("fans the East Bay umbrella out to every East Bay city + generic bucket", () => {
    expect(citiesForSelection("East Bay")).toEqual([
      ...EAST_BAY_CITY_NAMES,
      GENERIC_EAST_BAY,
    ]);
  });

  it("includes Alameda + Contra Costa cities in the umbrella", () => {
    const cities = citiesForSelection("East Bay");
    expect(cities).toContain("Oakland"); // Alameda County
    expect(cities).toContain("Berkeley");
    expect(cities).toContain("Walnut Creek"); // Contra Costa County
    expect(cities).toContain("Richmond");
  });

  it("falls back to the default city for unknown input", () => {
    expect(citiesForSelection("nope")).toEqual(["San Francisco"]);
  });
});

describe("filters — city round-trip", () => {
  it("parses ?city= into a resolved selection, defaulting to SF", () => {
    expect(parseFilters({}).city).toBe(DEFAULT_CITY);
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
