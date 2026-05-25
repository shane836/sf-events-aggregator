import type { Category } from "@/lib/sources/types";

/**
 * Single source of truth for category visual styling.
 *
 * Locked palette (user-approved, all WCAG AA on `bg-zinc-950`):
 *   music     - sky-400
 *   comedy    - orange-400
 *   lectures  - violet-400
 *   dancing   - red-500
 *   food      - emerald-400
 *
 * Returns Tailwind class strings — keep them static so the JIT compiler can
 * extract them. Do NOT build class names dynamically anywhere else.
 */
export type CategoryStyle = {
  /** Human-readable label for chips/legend ("Music"). */
  label: string;
  /** Color dot — small inline indicator (e.g., calendar cell, agenda list). */
  dot: string;
  /** Chip background + foreground for filter bar and detail modal. */
  chip: string;
  /** Bare foreground color when only text is colored. */
  text: string;
};

export const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  music: {
    label: "Music",
    dot: "bg-sky-400",
    chip: "bg-sky-400/15 text-sky-400 ring-1 ring-inset ring-sky-400/30",
    text: "text-sky-400",
  },
  comedy: {
    label: "Comedy",
    dot: "bg-orange-400",
    chip: "bg-orange-400/15 text-orange-400 ring-1 ring-inset ring-orange-400/30",
    text: "text-orange-400",
  },
  lectures: {
    label: "Lectures",
    dot: "bg-violet-400",
    chip: "bg-violet-400/15 text-violet-400 ring-1 ring-inset ring-violet-400/30",
    text: "text-violet-400",
  },
  dancing: {
    label: "Dancing",
    dot: "bg-red-500",
    chip: "bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30",
    text: "text-red-400",
  },
  food: {
    label: "Food",
    dot: "bg-emerald-400",
    chip: "bg-emerald-400/15 text-emerald-400 ring-1 ring-inset ring-emerald-400/30",
    text: "text-emerald-400",
  },
};

export const CATEGORY_ORDER: ReadonlyArray<Category> = [
  "music",
  "comedy",
  "lectures",
  "dancing",
  "food",
];
