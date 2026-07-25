/**
 * LA 5-zone geofencing. Classifies events into West, Central, East, Valley,
 * or South Bay using a neighborhood lookup table with coordinate fallback.
 *
 * Lookup table handles edge cases near zone boundaries:
 *   - Pasadena / Glendale → East (despite latitude > Valley threshold)
 *   - Compton / Inglewood → Central (despite latitude < South Bay threshold)
 *   - South Bay = coastal cities (Torrance, Long Beach, etc.)
 */

export type LAZone =
  | "la-west"
  | "la-central"
  | "la-east"
  | "la-valley"
  | "la-south-bay";

export const LA_ZONE_CITY_NAMES: Readonly<Record<LAZone, string>> = {
  "la-west": "LA West",
  "la-central": "LA Central",
  "la-east": "LA East",
  "la-valley": "Valley",
  "la-south-bay": "South Bay",
};

const LOOKUP: Record<string, LAZone> = {
  // West — independent cities west of the W|C boundary
  "santa monica": "la-west",
  "beverly hills": "la-west",
  "culver city": "la-west",
  "west hollywood": "la-west",
  "marina del rey": "la-west",
  "malibu": "la-west",
  "pacific palisades": "la-west",

  // Central — core LA neighborhoods + inland south cities
  "inglewood": "la-central",
  "compton": "la-central",
  "hawthorne": "la-central",
  "gardena": "la-central",

  // East — SGV + east side (boundary overrides)
  "pasadena": "la-east",
  "south pasadena": "la-east",
  "glendale": "la-east",
  "alhambra": "la-east",
  "arcadia": "la-east",
  "el monte": "la-east",
  "monterey park": "la-east",
  "san gabriel": "la-east",
  "rosemead": "la-east",
  "temple city": "la-east",
  "monrovia": "la-east",
  "azusa": "la-east",
  "claremont": "la-east",
  "pomona": "la-east",
  "west covina": "la-east",
  "covina": "la-east",
  "la verne": "la-east",
  "duarte": "la-east",
  "san dimas": "la-east",

  // Valley — independent cities north of the Valley boundary
  "burbank": "la-valley",
  "calabasas": "la-valley",
  "agoura hills": "la-valley",

  // South Bay — coastal cities
  "hermosa beach": "la-south-bay",
  "manhattan beach": "la-south-bay",
  "el segundo": "la-south-bay",
  "redondo beach": "la-south-bay",
  "torrance": "la-south-bay",
  "long beach": "la-south-bay",
  "carson": "la-south-bay",
  "san pedro": "la-south-bay",
  "palos verdes": "la-south-bay",
  "rancho palos verdes": "la-south-bay",
  "lomita": "la-south-bay",
  "signal hill": "la-south-bay",
  "lakewood": "la-south-bay",
  "cerritos": "la-south-bay",
  "bellflower": "la-south-bay",
  "downey": "la-south-bay",
  "norwalk": "la-south-bay",
};

// Coordinate boundaries (fallback for events without a lookup match)
const VALLEY_LAT = 34.13;
const SOUTH_BAY_LAT = 33.97;
const WEST_CENTRAL_LNG = -118.37;
const CENTRAL_EAST_LNG = -118.29;

/**
 * Classify a location into an LA zone. Checks the lookup table first
 * (handles edge cases near boundaries), then falls back to coordinates.
 * Returns "la-central" when neither lookup nor coordinates are available.
 */
export function classifyLAZone(opts: {
  city?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
}): LAZone {
  for (const name of [opts.neighborhood, opts.city]) {
    if (name) {
      const z = LOOKUP[name.toLowerCase()];
      if (z) return z;
    }
  }

  if (opts.lat != null && opts.lng != null) {
    if (opts.lat > VALLEY_LAT) return "la-valley";
    if (opts.lat < SOUTH_BAY_LAT) return "la-south-bay";
    if (opts.lng < WEST_CENTRAL_LNG) return "la-west";
    if (opts.lng < CENTRAL_EAST_LNG) return "la-central";
    return "la-east";
  }

  return "la-central";
}

/**
 * True when an addressLocality is somewhere in the LA metro area — either
 * "Los Angeles" itself or an independent city in the lookup table.
 */
export function isLACity(city: string): boolean {
  if (city.toLowerCase() === "los angeles") return true;
  return city.toLowerCase() in LOOKUP;
}

/**
 * For events with addressLocality "Los Angeles" (which spans all 5 zones),
 * reclassify to a zone-specific city name using lat/lng. Independent cities
 * (Santa Monica, Burbank, etc.) pass through unchanged — the zone is
 * resolved at query time via `citiesForSelection()`.
 */
export function reclassifyLACity(
  addressLocality: string,
  lat: number | null,
  lng: number | null,
): string {
  const lower = addressLocality.toLowerCase();
  if (lower !== "los angeles") return addressLocality;
  const zone = classifyLAZone({ lat, lng });
  return LA_ZONE_CITY_NAMES[zone];
}
