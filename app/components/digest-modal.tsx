"use client";

/**
 * Digest modal — email input + 5 category checkboxes + Send.
 *
 * E-series invariants from `rubrics/milestone-m4-digest.md`:
 *   E1: opens when DigestButton triggers it
 *   E2: client-side email validation (regex) before submit
 *   E3: all 5 categories rendered as checkboxes
 *   E4: submit disabled while in-flight
 *   E5: success state visible after 200
 *   E6: error state visible after non-200 / network error
 *   E7: dismissable via Esc, backdrop click, and X button
 *   E8 (soft): focus stays within modal while open
 *
 * Categories empty == "all categories" on the server (no filter). The user
 * doesn't have to tick anything to send.
 */
import * as React from "react";
import type { Category } from "@/lib/sources/types";
import { CATEGORY_LABEL, CATEGORY_TEXT_CLASS } from "@/lib/digest/category-styles";
import { EMAIL_REGEX, VALID_CATEGORIES } from "@/lib/digest/types";

type Props = { onClose: () => void };

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; eventsIncluded: number }
  | { kind: "error"; message: string };

export function DigestModal({ onClose }: Props): React.ReactElement {
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [categories, setCategories] = React.useState<Set<Category>>(new Set());
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const firstFieldRef = React.useRef<HTMLInputElement>(null);

  // Esc to close.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Initial focus.
  React.useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // E8 (soft): focus trap — Tab cycles within the dialog.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCategory(c: Category) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "sending") return;

    if (!EMAIL_REGEX.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError(null);
    setStatus({ kind: "sending" });

    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          categories: categories.size > 0 ? Array.from(categories) : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        eventsIncluded?: number;
        error?: string;
      };
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: body.error ?? `Request failed (${res.status})`,
        });
        return;
      }
      setStatus({
        kind: "success",
        eventsIncluded: body.eventsIncluded ?? 0,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  const isSending = status.kind === "sending";
  const isSuccess = status.kind === "success";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="digest-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="digest-modal"
    >
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        data-testid="digest-modal-backdrop"
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="digest-modal-title"
            className="text-lg font-semibold text-zinc-50"
          >
            Email me this week&apos;s events
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-400 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
            data-testid="digest-modal-close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {isSuccess ? (
          <div className="mt-4 space-y-3" data-testid="digest-success">
            <p className="text-sm text-emerald-400">
              Sent! Check your inbox.
            </p>
            <p className="text-sm text-zinc-400">
              {status.eventsIncluded === 1
                ? "1 event included."
                : `${status.eventsIncluded} events included.`}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium hover:border-zinc-500 hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            <div>
              <label
                htmlFor="digest-email"
                className="block text-sm font-medium text-zinc-300"
              >
                Email address
              </label>
              <input
                id="digest-email"
                ref={firstFieldRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                disabled={isSending}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-60"
                placeholder="you@example.com"
                aria-invalid={emailError != null}
                aria-describedby={emailError ? "digest-email-error" : undefined}
                data-testid="digest-email-input"
              />
              {emailError ? (
                <p
                  id="digest-email-error"
                  className="mt-1 text-xs text-red-400"
                  data-testid="digest-email-error"
                >
                  {emailError}
                </p>
              ) : null}
            </div>

            <fieldset disabled={isSending}>
              <legend className="text-sm font-medium text-zinc-300">
                Categories <span className="text-zinc-500">(optional)</span>
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {VALID_CATEGORIES.map((c) => (
                  <label
                    key={c}
                    className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm hover:border-zinc-600"
                  >
                    <input
                      type="checkbox"
                      checked={categories.has(c)}
                      onChange={() => toggleCategory(c)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-400 focus:ring-sky-400"
                      data-testid={`digest-category-${c}`}
                    />
                    <span
                      className={`font-mono text-xs uppercase tracking-widest ${CATEGORY_TEXT_CLASS[c]}`}
                    >
                      {CATEGORY_LABEL[c]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {status.kind === "error" ? (
              <p
                className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300"
                role="alert"
                data-testid="digest-error"
              >
                {status.message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSending}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-zinc-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSending}
                className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="digest-submit"
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default DigestModal;
