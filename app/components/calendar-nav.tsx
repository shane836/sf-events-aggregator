"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { advanceDate, todayInPT, type ViewMode } from "@/lib/ui/filters";

/**
 * Prev / today / next navigation + keyboard arrow handlers. Lives just above
 * the calendar grid. The active view + date come from the URL — this only
 * mutates them.
 */
export function CalendarNav({
  view,
  date,
  label,
}: {
  view: ViewMode;
  date: string;
  /** Human label for the current period (e.g. "May 2026", "Week of May 25"). */
  label: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // Ref tracks the *just-set* date so chained rapid clicks/keypresses don't
  // race against React state updates or `router.replace` flushing through
  // `window.location`. Source of truth ordering: ref → window.location → prop.
  const dateRef = useRef<string>(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  const navigate = useCallback(
    (nextDate: string) => {
      const sp = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : params.toString(),
      );
      sp.delete("event");
      const today = todayInPT();
      if (nextDate === today) sp.delete("date");
      else sp.set("date", nextDate);
      dateRef.current = nextDate;
      const s = sp.toString();
      startTransition(() => {
        router.replace(s ? `/?${s}` : "/", { scroll: false });
      });
    },
    [params, router],
  );

  const goPrev = useCallback(
    () => navigate(advanceDate(view, dateRef.current, -1)),
    [navigate, view],
  );
  const goNext = useCallback(
    () => navigate(advanceDate(view, dateRef.current, 1)),
    [navigate, view],
  );
  const goToday = useCallback(() => navigate(todayInPT()), [navigate]);

  // Keyboard arrow nav (A10). Skip when focus is in an input/textarea/select
  // so users typing in filters or the digest modal aren't hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        goToday();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, goToday]);

  return (
    <div
      data-calendar-nav
      className="flex items-center justify-between gap-3"
    >
      <h2
        className="font-mono text-sm uppercase tracking-[0.2em] text-zinc-400"
        data-period-label
      >
        {label}
      </h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-nav="prev"
          aria-label="Previous"
          onClick={goPrev}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
        >
          ‹
        </button>
        <button
          type="button"
          data-nav="today"
          onClick={goToday}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md px-3 text-xs text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
        >
          Today
        </button>
        <button
          type="button"
          data-nav="next"
          aria-label="Next"
          onClick={goNext}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-zinc-300 ring-1 ring-inset ring-zinc-800 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
        >
          ›
        </button>
      </div>
    </div>
  );
}
