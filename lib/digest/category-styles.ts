/**
 * Category color styles, scoped to the digest surface.
 *
 * Local copy on purpose: Stream F (digest) must not import from `app/`
 * (Stream E's UI). Post-merge with M2, we'll consolidate into
 * `lib/ui/categories.ts`. Until then, keep these in sync with M2's chip
 * colors documented in the M4 plan.
 */
import type { Category } from "@/lib/sources/types";

/** Tailwind text-color classes used by the modal chip selector. */
export const CATEGORY_TEXT_CLASS: Record<Category, string> = {
  music: "text-sky-400",
  comedy: "text-orange-400",
  lectures: "text-violet-400",
  dancing: "text-red-500",
  food: "text-emerald-400",
};

/**
 * Hex colors for the email template (inline styles — most email clients
 * ignore <style> blocks and stripped/unsupported tailwind, so we inline).
 * Values chosen to match the Tailwind classes above at sensible WCAG-AA
 * contrast on a light background.
 */
export const CATEGORY_EMAIL_HEX: Record<Category, string> = {
  music: "#0284c7", // sky-600 (darker than sky-400 for AA on white)
  comedy: "#ea580c", // orange-600
  lectures: "#7c3aed", // violet-600
  dancing: "#dc2626", // red-600
  food: "#059669", // emerald-600
};

/** Human-readable labels for the modal + email. */
export const CATEGORY_LABEL: Record<Category, string> = {
  music: "Music",
  comedy: "Comedy",
  lectures: "Lectures",
  dancing: "Dancing",
  food: "Food",
};
