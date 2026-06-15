/**
 * Metros for the city selector. The app covers San Francisco and the East Bay.
 *
 * A *selection* is what the dropdown shows and what rides in the `?city=` URL
 * param. Most selections map 1:1 to a `venues.city` value, but "East Bay" is an
 * umbrella that fans out to several city names. `citiesForSelection()` resolves
 * a selection token to the concrete `venues.city` values the API filters on.
 *
 * Adding a city is a new entry here plus sources that tag their venues with the
 * matching name.
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

/** Real `venues.city` values in the East Bay. */
export const EAST_BAY_CITY_NAMES = [
  "Oakland",
  "Berkeley",
  "Emeryville",
  "Alameda",
] as const;

/**
 * Catch-all `venues.city` value for East Bay sources that don't expose a
 * per-event city (e.g. Funcheap groups its whole East Bay feed together). It's
 * part of the "All East Bay" umbrella but has no standalone selector entry.
 */
export const GENERIC_EAST_BAY = "East Bay";

/** Every concrete city name we ingest/query (used by source adapters). */
export const INGEST_CITY_NAMES: ReadonlyArray<string> = [
  "San Francisco",
  ...EAST_BAY_CITY_NAMES,
];

export const CITY_SELECTIONS: ReadonlyArray<CitySelection> = [
  { value: "San Francisco", label: "SF", cities: ["San Francisco"] },
  {
    value: "East Bay",
    label: "All East Bay",
    cities: [...EAST_BAY_CITY_NAMES, GENERIC_EAST_BAY],
    group: "East Bay",
  },
  { value: "Oakland", label: "Oakland", cities: ["Oakland"], group: "East Bay" },
  {
    value: "Berkeley",
    label: "Berkeley",
    cities: ["Berkeley"],
    group: "East Bay",
  },
  {
    value: "Emeryville",
    label: "Emeryville",
    cities: ["Emeryville"],
    group: "East Bay",
  },
  { value: "Alameda", label: "Alameda", cities: ["Alameda"], group: "East Bay" },
];

/** Default selection when no `?city=` param is present. */
export const DEFAULT_CITY = "San Francisco";

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
