"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Empty-state CTA. Clearing filters drops every URL param and returns
 * the calendar to its default month view. Lives in DayView and WeekGrid
 * (C8 rubric dim).
 */
export function ResetFiltersLink() {
  const router = useRouter();
  const reset = useCallback(() => {
    router.replace("/", { scroll: false });
  }, [router]);
  return (
    <button
      type="button"
      data-reset-filters
      onClick={reset}
      className="inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium text-zinc-100 ring-1 ring-inset ring-zinc-700 transition-colors hover:bg-zinc-900 hover:ring-zinc-500"
    >
      Reset filters
    </button>
  );
}
