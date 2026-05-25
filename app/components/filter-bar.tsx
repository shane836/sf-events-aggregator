"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import type { Category } from "@/lib/sources/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "@/lib/ui/categories";
import {
  PRESET_LABELS,
  VALID_CATEGORIES,
  type DatePreset,
} from "@/lib/ui/filters";

const PRESET_ORDER: ReadonlyArray<Exclude<DatePreset, "custom">> = [
  "today",
  "weekend",
  "week",
  "next-week",
];

/**
 * Sticky top filter bar. Reads from / writes to URL search params via
 * `next/navigation`. Filters compose AND across fields; multi-select within
 * categories is OR. State lives in the URL so refresh/share preserves it.
 *
 * Renders below the global header (h-12) and stays put on scroll.
 */
export function FilterBar({
  neighborhoods,
}: {
  /** Distinct neighborhoods seen in the current event window. */
  neighborhoods: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selectedCategories = useMemo(() => {
    const values = params.getAll("category");
    return new Set(values.filter((v): v is Category =>
      VALID_CATEGORIES.includes(v as Category),
    ));
  }, [params]);

  const preset =
    (params.get("preset") as DatePreset | null) ?? "week";
  const neighborhood = params.get("neighborhood") ?? "";
  // When a real view-mode is selected (?view=) or a date is anchored
  // (?date=), the legacy preset row is redundant with the prev/next nav.
  // Hide it to remove the confusing dual-control state.
  const viewModeActive =
    params.get("view") != null || params.get("date") != null;

  const replace = useCallback(
    (next: URLSearchParams) => {
      // Always strip `event` modal param when filters change so the modal
      // doesn't reopen on filter clicks.
      next.delete("event");
      const s = next.toString();
      startTransition(() => {
        router.replace(s ? `/?${s}` : "/", { scroll: false });
      });
    },
    [router],
  );

  const toggleCategory = (c: Category) => {
    const next = new URLSearchParams(params.toString());
    const current = next.getAll("category");
    next.delete("category");
    if (current.includes(c)) {
      for (const v of current) if (v !== c) next.append("category", v);
    } else {
      for (const v of current) next.append("category", v);
      next.append("category", c);
    }
    replace(next);
  };

  const setPreset = (p: DatePreset) => {
    const next = new URLSearchParams(params.toString());
    if (p === "week") next.delete("preset");
    else next.set("preset", p);
    next.delete("from");
    next.delete("to");
    replace(next);
  };

  const setNeighborhood = (n: string) => {
    const next = new URLSearchParams(params.toString());
    if (!n) next.delete("neighborhood");
    else next.set("neighborhood", n);
    replace(next);
  };

  const reset = () => {
    startTransition(() => {
      router.replace("/", { scroll: false });
    });
  };

  const hasAnyFilter =
    selectedCategories.size > 0 ||
    (params.get("preset") != null && params.get("preset") !== "week") ||
    params.get("neighborhood") != null;

  return (
    <div
      data-testid="filter-bar"
      className="sticky top-12 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/70"
      aria-busy={isPending}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
        {/* Category chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            Category
          </span>
          {CATEGORY_ORDER.map((c) => {
            const style = CATEGORY_STYLES[c];
            const active = selectedCategories.has(c);
            return (
              <button
                key={c}
                type="button"
                data-category-filter={c}
                aria-pressed={active}
                onClick={() => toggleCategory(c)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-mono text-xs uppercase tracking-wide transition-colors ${
                  active
                    ? style.chip
                    : "text-zinc-400 ring-1 ring-inset ring-zinc-700 hover:text-zinc-200 hover:ring-zinc-500"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
                />
                {style.label}
              </button>
            );
          })}
        </div>

        {/* Date + Neighborhood + Reset */}
        <div className="flex flex-wrap items-center gap-2">
          {viewModeActive ? null : (
            <>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                When
              </span>
              {PRESET_ORDER.map((p) => {
                const active = preset === p;
                const label = PRESET_LABELS[p];
                return (
                  <button
                    key={p}
                    type="button"
                    data-preset={p}
                    aria-pressed={active}
                    onClick={() => setPreset(p)}
                    className={`inline-flex min-h-[44px] items-center rounded-md px-3 text-xs transition-colors ${
                      active
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-400 ring-1 ring-inset ring-zinc-800 hover:text-zinc-200 hover:ring-zinc-600"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="neighborhood" className="sr-only">
              Neighborhood
            </label>
            <select
              id="neighborhood"
              data-testid="neighborhood-select"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              className="min-h-[44px] rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <option value="">All neighborhoods</option>
              {neighborhoods.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="reset-filters"
              onClick={reset}
              disabled={!hasAnyFilter}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-xs text-zinc-400 ring-1 ring-inset ring-zinc-800 transition-colors hover:text-zinc-200 hover:ring-zinc-600 disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
