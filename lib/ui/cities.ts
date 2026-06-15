/**
 * Supported metros for the city selector. The `value` is stored on
 * `venues.city` and round-trips through the `?city=` URL param + `/api/events`
 * filter; `label` is what the dropdown shows.
 *
 * Adding a city is just a new entry here plus sources that tag their venues
 * with the matching `value`.
 */

export type City = {
  value: string;
  label: string;
};

export const CITIES: ReadonlyArray<City> = [
  { value: "San Francisco", label: "SF" },
  { value: "Oakland", label: "Oakland" },
];

/** Default selection when no `?city=` param is present. */
export const DEFAULT_CITY = "San Francisco";

const CITY_VALUES: ReadonlySet<string> = new Set(CITIES.map((c) => c.value));

/**
 * Resolve an arbitrary `?city=` value to a known city, case-insensitively.
 * Falls back to {@link DEFAULT_CITY} for unknown/empty input so the calendar
 * always renders a valid metro.
 */
export function resolveCity(value: string | null | undefined): string {
  if (!value) return DEFAULT_CITY;
  const match = CITIES.find(
    (c) => c.value.toLowerCase() === value.toLowerCase(),
  );
  return match ? match.value : DEFAULT_CITY;
}

export function isKnownCity(value: string): boolean {
  return CITY_VALUES.has(value);
}
