"use client";

/**
 * The "📧 Email me this week's events" entry point.
 *
 * Mounts in the layout header. Owns nothing but the button + the
 * lazy-rendered modal. Client component (button click toggles state),
 * but no SSR cost — the button itself is a single <button>.
 *
 * Composition decision: button + modal are separate components so M2 can
 * slot just the button into its header without dragging modal markup
 * into the layout tree.
 */
import * as React from "react";
import { DigestModal } from "./digest-modal";

export function DigestButton(): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        data-testid="digest-button"
      >
        <span aria-hidden="true">📧</span>
        <span>Email me this week&apos;s events</span>
      </button>
      {open ? <DigestModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default DigestButton;
