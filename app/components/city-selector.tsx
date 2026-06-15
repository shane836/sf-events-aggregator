"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CITIES, DEFAULT_CITY, resolveCity } from "@/lib/ui/cities";

/**
 * "Choose city" dropdown — the top-left header control. Reads/writes the
 * `?city=` URL param (the single source of truth, like the rest of the
 * filters) so the selection survives refresh and is shareable.
 *
 * Switching city clears `neighborhood` (neighborhood lists are city-specific)
 * and the `event` modal param, but preserves category/date/view state.
 */
export function CitySelector() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = resolveCity(params.get("city"));

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === DEFAULT_CITY) next.delete("city");
    else next.set("city", value);
    // Neighborhoods don't carry across metros; drop any stale selection.
    next.delete("neighborhood");
    next.delete("event");
    const s = next.toString();
    startTransition(() => {
      router.replace(s ? `/?${s}` : "/", { scroll: false });
    });
  };

  return (
    <div className="flex items-center gap-2" aria-busy={isPending}>
      <label
        htmlFor="city-selector"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400"
      >
        Choose city
      </label>
      <select
        id="city-selector"
        data-testid="city-selector"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[36px] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs uppercase tracking-wide text-zinc-100 hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        {CITIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default CitySelector;
