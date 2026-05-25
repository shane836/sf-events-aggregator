"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { ViewMode } from "@/lib/ui/filters";

const VIEWS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

export function ViewToggle({ view }: { view: ViewMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const setView = (next: ViewMode) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("event");
    if (next === "month") sp.delete("view");
    else sp.set("view", next);
    const s = sp.toString();
    startTransition(() => {
      router.replace(s ? `/?${s}` : "/", { scroll: false });
    });
  };

  return (
    <div
      data-view-toggle
      role="group"
      aria-label="Calendar view mode"
      className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-zinc-800"
    >
      {VIEWS.map((v) => {
        const active = view === v.id;
        return (
          <button
            key={v.id}
            type="button"
            data-view-toggle-button={v.id}
            aria-pressed={active}
            onClick={() => setView(v.id)}
            className={`inline-flex min-h-[44px] min-w-[60px] items-center justify-center px-3 text-xs transition-colors ${
              active
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
