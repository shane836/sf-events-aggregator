"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { ApiEvent } from "@/lib/api/events";
import { CATEGORY_STYLES } from "@/lib/ui/categories";
import { formatLocalFullDate, formatLocalTime } from "@/lib/ui/dates";
import { CategoryChip } from "./category-chip";

/**
 * Event detail modal. Mounted whenever `?event=<id>` is in the URL and the
 * page passes a matching event. Focus trap + Esc-to-close + click-outside.
 *
 * "View source" button uses `target="_blank" rel="noopener noreferrer"`.
 */
export function EventModal({ event }: { event: ApiEvent }) {
  const router = useRouter();
  const params = useSearchParams();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("event");
    const s = next.toString();
    router.replace(s ? `/?${s}` : "/", { scroll: false });
  }, [params, router]);

  // Esc closes; focus trap inside dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Initial focus
    closeBtnRef.current?.focus();
    // Body scroll lock
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close]);

  const style = CATEGORY_STYLES[event.category];
  const dateLabel = formatLocalFullDate(event.startTimeUtc, event.timezone);
  const timeLabel = formatLocalTime(event.startTimeUtc, event.timezone);
  const endLabel = event.endTimeUtc
    ? formatLocalTime(event.endTimeUtc, event.timezone)
    : null;

  return (
    <div
      data-testid="event-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 overflow-auto rounded-t-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${style.dot}`}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                {dateLabel}
              </span>
            </div>
            <h2
              id="event-modal-title"
              className="text-xl font-semibold leading-tight text-zinc-100 sm:text-2xl"
            >
              {event.title}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            data-testid="modal-close"
            onClick={close}
            aria-label="Close event details"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            <span aria-hidden="true" className="text-lg">
              ✕
            </span>
          </button>
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            Time
          </dt>
          <dd className="font-mono text-zinc-200">
            {timeLabel}
            {endLabel ? ` – ${endLabel}` : ""}
          </dd>

          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            Venue
          </dt>
          <dd className="text-zinc-200">
            {event.venue.name}
            {event.venue.neighborhood ? (
              <span className="text-zinc-400"> · {event.venue.neighborhood}</span>
            ) : null}
            {event.venue.address ? (
              <div className="text-xs text-zinc-400">{event.venue.address}</div>
            ) : null}
          </dd>

          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            Category
          </dt>
          <dd>
            <CategoryChip category={event.category} />
          </dd>

          <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            Price
          </dt>
          <dd data-price className="font-mono text-zinc-200">
            {event.priceDisplay}
          </dd>
        </dl>

        {event.description ? (
          <p className="text-sm leading-relaxed text-zinc-300">
            {event.description}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between border-t border-zinc-800 pt-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            From {sourceLabel(event.source)}
          </span>
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="modal-source-link"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-zinc-100 px-4 font-medium text-zinc-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            View source <span aria-hidden>↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

/** Friendly attribution: "ical:sfjazz" -> "sfjazz.org-style ical", "scrape:chapel" -> "Chapel" */
function sourceLabel(source: string): string {
  if (source.startsWith("scrape:")) return cap(source.slice("scrape:".length));
  if (source.startsWith("ical:")) return cap(source.slice("ical:".length));
  return cap(source);
}

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
