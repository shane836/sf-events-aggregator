import { describe, expect, it } from "vitest";
import {
  classifyLAZone,
  isLACity,
  reclassifyLACity,
  LA_ZONE_CITY_NAMES,
} from "@/lib/geo/la-zones";

describe("classifyLAZone", () => {
  it("classifies independent cities via lookup table", () => {
    expect(classifyLAZone({ city: "Santa Monica" })).toBe("la-west");
    expect(classifyLAZone({ city: "Beverly Hills" })).toBe("la-west");
    expect(classifyLAZone({ city: "Pasadena" })).toBe("la-east");
    expect(classifyLAZone({ city: "Glendale" })).toBe("la-east");
    expect(classifyLAZone({ city: "Burbank" })).toBe("la-valley");
    expect(classifyLAZone({ city: "Long Beach" })).toBe("la-south-bay");
    expect(classifyLAZone({ city: "Torrance" })).toBe("la-south-bay");
    expect(classifyLAZone({ city: "Inglewood" })).toBe("la-central");
    expect(classifyLAZone({ city: "Compton" })).toBe("la-central");
  });

  it("is case-insensitive", () => {
    expect(classifyLAZone({ city: "santa monica" })).toBe("la-west");
    expect(classifyLAZone({ city: "PASADENA" })).toBe("la-east");
  });

  it("overrides coordinate classification for edge-case cities", () => {
    // Pasadena lat 34.15 would be Valley by coordinates, but lookup says East
    expect(classifyLAZone({ city: "Pasadena", lat: 34.15, lng: -118.14 })).toBe(
      "la-east",
    );
    // Compton lat 33.90 would be South Bay by coordinates, but lookup says Central
    expect(classifyLAZone({ city: "Compton", lat: 33.9, lng: -118.22 })).toBe(
      "la-central",
    );
  });

  it("falls back to coordinates when city is not in lookup", () => {
    // Valley (high latitude)
    expect(classifyLAZone({ lat: 34.2, lng: -118.4 })).toBe("la-valley");
    // South Bay (low latitude)
    expect(classifyLAZone({ lat: 33.85, lng: -118.4 })).toBe("la-south-bay");
    // West (middle band, western longitude)
    expect(classifyLAZone({ lat: 34.05, lng: -118.45 })).toBe("la-west");
    // Central (middle band, central longitude)
    expect(classifyLAZone({ lat: 34.05, lng: -118.33 })).toBe("la-central");
    // East (middle band, eastern longitude)
    expect(classifyLAZone({ lat: 34.05, lng: -118.25 })).toBe("la-east");
  });

  it("defaults to la-central when no data is available", () => {
    expect(classifyLAZone({})).toBe("la-central");
    expect(classifyLAZone({ city: "Los Angeles" })).toBe("la-central");
  });

  it("prefers neighborhood over city in lookup", () => {
    expect(
      classifyLAZone({ neighborhood: "Pasadena", city: "Los Angeles" }),
    ).toBe("la-east");
  });
});

describe("isLACity", () => {
  it("recognizes Los Angeles itself", () => {
    expect(isLACity("Los Angeles")).toBe(true);
    expect(isLACity("los angeles")).toBe(true);
  });

  it("recognizes independent LA-area cities", () => {
    expect(isLACity("Santa Monica")).toBe(true);
    expect(isLACity("Burbank")).toBe(true);
    expect(isLACity("Long Beach")).toBe(true);
  });

  it("rejects non-LA cities", () => {
    expect(isLACity("San Francisco")).toBe(false);
    expect(isLACity("Oakland")).toBe(false);
    expect(isLACity("San Jose")).toBe(false);
  });
});

describe("reclassifyLACity", () => {
  it("reclassifies 'Los Angeles' to zone city name using coordinates", () => {
    // Hollywood area → Central
    expect(reclassifyLACity("Los Angeles", 34.1, -118.33)).toBe("LA Central");
    // Venice area → West
    expect(reclassifyLACity("Los Angeles", 33.99, -118.47)).toBe("LA West");
    // DTLA → East
    expect(reclassifyLACity("Los Angeles", 34.05, -118.25)).toBe("LA East");
    // North Hollywood → Valley
    expect(reclassifyLACity("Los Angeles", 34.17, -118.38)).toBe("Valley");
    // Wilmington area → South Bay
    expect(reclassifyLACity("Los Angeles", 33.79, -118.26)).toBe("South Bay");
  });

  it("passes through independent cities unchanged", () => {
    expect(reclassifyLACity("Santa Monica", 34.02, -118.49)).toBe(
      "Santa Monica",
    );
    expect(reclassifyLACity("Burbank", 34.18, -118.31)).toBe("Burbank");
    expect(reclassifyLACity("Oakland", 37.8, -122.27)).toBe("Oakland");
  });

  it("defaults to LA Central when Los Angeles has no coordinates", () => {
    expect(reclassifyLACity("Los Angeles", null, null)).toBe("LA Central");
  });
});

describe("LA_ZONE_CITY_NAMES", () => {
  it("maps all 5 zones to human-readable city names", () => {
    expect(Object.keys(LA_ZONE_CITY_NAMES)).toHaveLength(5);
    expect(LA_ZONE_CITY_NAMES["la-west"]).toBe("LA West");
    expect(LA_ZONE_CITY_NAMES["la-south-bay"]).toBe("South Bay");
  });
});
