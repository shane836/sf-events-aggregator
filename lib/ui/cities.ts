/**
 * Metros for the city selector. The app covers San Francisco and the East Bay
 * (Alameda + Contra Costa counties).
 *
 * A *selection* is what the dropdown shows and what rides in the `?city=` URL
 * param. Most selections map 1:1 to a `venues.city` value, but "East Bay" is an
 * umbrella that fans out to every East Bay city. `citiesForSelection()`
 * resolves a selection token to the concrete `venues.city` values the API
 * filters on.
 */

export type CitySelection = {
  /** URL token (also a `venues.city` value, except the "East Bay" umbrella). */
  value: string;
  /** Dropdown label. */
  label: string;
  /** Concrete `venues.city` values this selection matches. */
  cities: string[];
  /** Optional <optgroup> label. */
  group?: string;
};

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

/**
 * All concrete `venues.city` values we recognize (SF + East Bay). Sources match
 * event addresses against this when tagging `venue.city`.
 */
export const INGEST_CITY_NAMES: ReadonlyArray<string> = [
  "San Francisco",
  ...EAST_BAY_CITY_NAMES,
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
];

export const DEFAULT_CITY = "San Francisco";

const EAST_BAY_UMBRELLA: CitySelection = {
  value: "East Bay",
  label: "All East Bay",
  cities: [...EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY],
};

export const CITY_SELECTIONS: ReadonlyArray<CitySelection> = [
  { value: "San Francisco", label: "SF", cities: ["San Francisco"] },
  EAST_BAY_UMBRELLA,
  ...ALAMEDA_COUNTY_CITIES.map(
    (c): CitySelection => ({
      value: c,
      label: c,
      cities: [c],
      group: "Alameda County",
    }),
  ),
  ...CONTRA_COSTA_COUNTY_CITIES.map(
    (c): CitySelection => ({
      value: c,
      label: c,
      cities: [c],
      group: "Contra Costa County",
    }),
  ),
];

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
  return (findSelection(value) ?? CITY_SELECTIONS[0]).cities;
}

/** True when `value` is a canonical selection token (case-sensitive). */
export function isKnownCity(value: string): boolean {
  return CITY_SELECTIONS.some((c) => c.value === value);
}
