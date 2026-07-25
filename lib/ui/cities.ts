/**
 * Metros for the city selector. The app covers the Bay Area (SF + East Bay)
 * and Los Angeles (5 zones: West, Central, East, Valley, South Bay).
 *
 * A *selection* is what the dropdown shows and what rides in the `?city=` URL
 * param. Most selections map 1:1 to a `venues.city` value, but "East Bay" is an
 * umbrella that fans out to every East Bay city. `citiesForSelection()`
 * resolves a selection token to the concrete `venues.city` values the API
 * filters on.
 */

export type CitySelection = {
  /** URL token (also a `venues.city` value, except umbrella selections). */
  value: string;
  /** Dropdown label. */
  label: string;
  /** Concrete `venues.city` values this selection matches. */
  cities: string[];
  /** Metro grouping label for the selector. */
  group?: string;
};

export type Metro = {
  value: string;
  label: string;
  zones: ReadonlyArray<CitySelection>;
};

// ---------------------------------------------------------------------------
// Bay Area
// ---------------------------------------------------------------------------

const ALAMEDA_COUNTY_CITIES = [
  "Oakland",
  "Berkeley",
  "Alameda",
  "Emeryville",
  "Albany",
  "Piedmont",
  "San Leandro",
  "Hayward",
  "Castro Valley",
  "Union City",
  "Fremont",
  "Newark",
  "Dublin",
  "Pleasanton",
  "Livermore",
] as const;

const CONTRA_COSTA_COUNTY_CITIES = [
  "Richmond",
  "El Cerrito",
  "San Pablo",
  "Pinole",
  "Hercules",
  "Martinez",
  "Concord",
  "Pleasant Hill",
  "Walnut Creek",
  "Lafayette",
  "Orinda",
  "Moraga",
  "Danville",
  "San Ramon",
  "Antioch",
] as const;

/** Every concrete East Bay `venues.city` value the selector recognizes. */
export const EAST_BAY_CITY_NAMES: ReadonlyArray<string> = [
  ...ALAMEDA_COUNTY_CITIES,
  ...CONTRA_COSTA_COUNTY_CITIES,
];

/**
 * Catch-all `venues.city` value for East Bay sources that don't expose a
 * per-event city (e.g. Funcheap groups its whole East Bay feed together). It's
 * part of the "All East Bay" umbrella but has no standalone selector entry.
 */
export const GENERIC_EAST_BAY = "East Bay";

// ---------------------------------------------------------------------------
// Los Angeles — independent cities grouped by zone
// ---------------------------------------------------------------------------

const LA_WEST_INDEPENDENT = [
  "Santa Monica",
  "Beverly Hills",
  "Culver City",
  "West Hollywood",
  "Marina del Rey",
  "Malibu",
  "Pacific Palisades",
] as const;

const LA_CENTRAL_INDEPENDENT = [
  "Inglewood",
  "Compton",
  "Hawthorne",
  "Gardena",
] as const;

const LA_EAST_INDEPENDENT = [
  "Pasadena",
  "South Pasadena",
  "Glendale",
  "Alhambra",
  "Arcadia",
  "El Monte",
  "Monterey Park",
  "San Gabriel",
  "Rosemead",
  "Temple City",
  "Monrovia",
  "Azusa",
  "Claremont",
  "Pomona",
  "West Covina",
  "Covina",
  "La Verne",
  "Duarte",
  "San Dimas",
] as const;

const LA_VALLEY_INDEPENDENT = [
  "Burbank",
  "Calabasas",
  "Agoura Hills",
] as const;

const LA_SOUTH_BAY_INDEPENDENT = [
  "Hermosa Beach",
  "Manhattan Beach",
  "El Segundo",
  "Redondo Beach",
  "Torrance",
  "Long Beach",
  "Carson",
  "San Pedro",
  "Palos Verdes",
  "Rancho Palos Verdes",
  "Lomita",
  "Signal Hill",
  "Lakewood",
  "Cerritos",
  "Bellflower",
  "Downey",
  "Norwalk",
] as const;

/**
 * Zone city names assigned to "Los Angeles" events after geofencing
 * reclassification. These appear as `venues.city` values in the database.
 */
const LA_ZONE_CITY_NAMES = [
  "LA West",
  "LA Central",
  "LA East",
  "Valley",
  "South Bay",
] as const;

/** All LA-area city names sources should recognize during ingestion. */
export const LA_CITY_NAMES: ReadonlyArray<string> = [
  "Los Angeles",
  ...LA_WEST_INDEPENDENT,
  ...LA_CENTRAL_INDEPENDENT,
  ...LA_EAST_INDEPENDENT,
  ...LA_VALLEY_INDEPENDENT,
  ...LA_SOUTH_BAY_INDEPENDENT,
  ...LA_ZONE_CITY_NAMES,
];

// ---------------------------------------------------------------------------
// New York — boroughs
// ---------------------------------------------------------------------------

const NYC_BOROUGH_NAMES = [
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Bronx",
  "Staten Island",
] as const;

export const NYC_CITY_NAMES: ReadonlyArray<string> = [
  "New York",
  ...NYC_BOROUGH_NAMES,
];

// ---------------------------------------------------------------------------
// Combined ingestion / query lists
// ---------------------------------------------------------------------------

/**
 * All concrete `venues.city` values we recognize (Bay Area + LA). Sources
 * match event addresses against this when tagging `venue.city`.
 */
export const INGEST_CITY_NAMES: ReadonlyArray<string> = [
  "San Francisco",
  ...EAST_BAY_CITY_NAMES,
  ...LA_CITY_NAMES,
  ...NYC_CITY_NAMES,
];

/**
 * Cities Ticketmaster actually queries. The Discovery API bills one query per
 * `city`, so we only hit the metros with ticketed venues rather than all ~30
 * East Bay cities — events still get tagged with their real city via
 * `INGEST_CITY_NAMES`, so smaller-city venues that surface are kept.
 */
export const TICKETMASTER_QUERY_CITIES: ReadonlyArray<string> = [
  "San Francisco",
  "Oakland",
  "Berkeley",
  "Emeryville",
  "Alameda",
  "Richmond",
  "San Leandro",
  "Hayward",
  "Walnut Creek",
  "Concord",
  "Fremont",
  "Livermore",
  "Los Angeles",
  "Santa Monica",
  "Pasadena",
  "Glendale",
  "Burbank",
  "Long Beach",
  "Torrance",
  "Inglewood",
];

export const DEFAULT_CITY = "San Francisco";

// ---------------------------------------------------------------------------
// Metros + zones — hierarchical structure for navigation
// ---------------------------------------------------------------------------

const BAY_AREA_ZONES: ReadonlyArray<CitySelection> = [
  {
    value: "San Francisco",
    label: "SF",
    cities: ["San Francisco"],
    group: "Bay Area",
  },
  {
    value: "East Bay",
    label: "East Bay",
    cities: [...EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY],
    group: "Bay Area",
  },
];

const ALL_BAY_AREA: CitySelection = {
  value: "Bay Area",
  label: "All Bay Area",
  cities: ["San Francisco", ...EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY],
  group: "Bay Area",
};

const LA_ZONES: ReadonlyArray<CitySelection> = [
  {
    value: "LA West",
    label: "West",
    cities: ["LA West", ...LA_WEST_INDEPENDENT],
    group: "Los Angeles",
  },
  {
    value: "LA Central",
    label: "Central",
    cities: ["LA Central", "Los Angeles", ...LA_CENTRAL_INDEPENDENT],
    group: "Los Angeles",
  },
  {
    value: "LA East",
    label: "East",
    cities: ["LA East", ...LA_EAST_INDEPENDENT],
    group: "Los Angeles",
  },
  {
    value: "Valley",
    label: "Valley",
    cities: ["Valley", ...LA_VALLEY_INDEPENDENT],
    group: "Los Angeles",
  },
  {
    value: "South Bay",
    label: "South Bay",
    cities: ["South Bay", ...LA_SOUTH_BAY_INDEPENDENT],
    group: "Los Angeles",
  },
];

const ALL_LA: CitySelection = {
  value: "All LA",
  label: "All LA",
  cities: [...LA_CITY_NAMES],
  group: "Los Angeles",
};

const NYC_ZONES: ReadonlyArray<CitySelection> = [
  {
    value: "Manhattan",
    label: "Manhattan",
    cities: ["Manhattan"],
    group: "New York",
  },
  {
    value: "Brooklyn",
    label: "Brooklyn",
    cities: ["Brooklyn"],
    group: "New York",
  },
  {
    value: "Queens",
    label: "Queens",
    cities: ["Queens"],
    group: "New York",
  },
  {
    value: "Bronx",
    label: "Bronx",
    cities: ["Bronx"],
    group: "New York",
  },
  {
    value: "Staten Island",
    label: "Staten Island",
    cities: ["Staten Island"],
    group: "New York",
  },
];

const ALL_NYC: CitySelection = {
  value: "All NYC",
  label: "All NYC",
  cities: ["New York", ...NYC_BOROUGH_NAMES],
  group: "New York",
};

export const METROS: ReadonlyArray<Metro> = [
  { value: "bay-area", label: "Bay Area", zones: [ALL_BAY_AREA, ...BAY_AREA_ZONES] },
  { value: "la", label: "Los Angeles", zones: [ALL_LA, ...LA_ZONES] },
  { value: "nyc", label: "New York", zones: [ALL_NYC, ...NYC_ZONES] },
];

/**
 * Flat list of all zone selections across all metros. The city selector
 * iterates this; `citiesForSelection()` resolves against it.
 */
export const CITY_SELECTIONS: ReadonlyArray<CitySelection> =
  METROS.flatMap((m) => m.zones);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function findSelection(value: string | null | undefined): CitySelection | null {
  if (!value) return null;
  return (
    CITY_SELECTIONS.find(
      (c) => c.value.toLowerCase() === value.toLowerCase(),
    ) ?? null
  );
}

/**
 * Resolve an arbitrary `?city=` value to a known selection token,
 * case-insensitively. Falls back to {@link DEFAULT_CITY} for unknown/empty
 * input so the calendar always renders a valid metro.
 */
export function resolveCity(value: string | null | undefined): string {
  return findSelection(value)?.value ?? DEFAULT_CITY;
}

/**
 * Concrete `venues.city` values to filter on for a selection token. Unknown
 * input resolves to the default city's set.
 */
export function citiesForSelection(value: string | null | undefined): string[] {
  const sel = findSelection(value) ?? findSelection(DEFAULT_CITY);
  return sel ? sel.cities : ["San Francisco"];
}

/** True when `value` is a canonical selection token (case-sensitive). */
export function isKnownCity(value: string): boolean {
  return CITY_SELECTIONS.some((c) => c.value === value);
}

/** Find which metro a selection belongs to, or null. */
export function metroForSelection(
  value: string | null | undefined,
): Metro | null {
  const sel = findSelection(value);
  if (!sel) return null;
  return METROS.find((m) => m.zones.some((z) => z.value === sel.value)) ?? null;
}
