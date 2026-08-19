"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  DEFAULT_CITY,
  METROS,
  metroForSelection,
  resolveCity,
} from "@/lib/ui/cities";

const LOGO: Record<string, string> = {
  "bay-area": "SF",
  la: "LA",
  nyc: "NYC",
};

const SHORT_LABEL: Record<string, string> = {
  "bay-area": "SF",
  la: "LA",
  nyc: "NYC",
};

const ACCENT: Record<string, { text: string; border: string }> = {
  "bay-area": { text: "text-metro-sf", border: "border-b-metro-sf" },
  la: { text: "text-metro-la", border: "border-b-metro-la" },
  nyc: { text: "text-metro-nyc", border: "border-b-metro-nyc" },
};

export function MetroNav() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentCity = resolveCity(params.get("city"));
  const activeMetro = metroForSelection(currentCity);
  const activeValue = activeMetro?.value ?? METROS[0].value;
  const accent = ACCENT[activeValue] ?? ACCENT["bay-area"];

  const switchMetro = (metroValue: string) => {
    const metro = METROS.find((m) => m.value === metroValue);
    if (!metro) return;
    const defaultZone = metro.zones[0].value;
    const next = new URLSearchParams(params.toString());
    if (defaultZone === DEFAULT_CITY) next.delete("city");
    else next.set("city", defaultZone);
    next.delete("neighborhood");
    next.delete("event");
    const s = next.toString();
    startTransition(() => {
      router.replace(s ? `/?${s}` : "/", { scroll: false });
    });
  };

  return (
    <div className="flex items-center gap-4" aria-busy={isPending}>
      {/* Branded logo */}
      <span className="flex items-baseline gap-0.5 text-sm font-bold tracking-tight select-none">
        <span className={accent.text}>{LOGO[activeValue] ?? "SF"}</span>
        <span className="text-zinc-100">Events</span>
      </span>

      {/* Metro tabs */}
      <nav aria-label="Metro" className="flex items-center gap-1">
        {METROS.map((m) => {
          const isActive = m.value === activeValue;
          const mAccent = ACCENT[m.value];
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => switchMetro(m.value)}
              className={`border-b-2 px-2 py-1 text-xs font-mono uppercase tracking-wide transition-colors ${
                isActive
                  ? `${mAccent.border} ${mAccent.text} font-semibold`
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="sm:hidden">{SHORT_LABEL[m.value]}</span>
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default MetroNav;
