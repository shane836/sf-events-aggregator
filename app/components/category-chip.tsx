import type { Category } from "@/lib/sources/types";
import { CATEGORY_STYLES } from "@/lib/ui/categories";

/**
 * Pure presentational chip. Used in:
 *   - filter bar (selectable variant via `selected` + `as="button"`)
 *   - event detail modal (read-only)
 *   - legend rows
 *
 * Server-renderable.
 */
export function CategoryChip({
  category,
  size = "md",
  withDot = true,
  className = "",
}: {
  category: Category;
  size?: "sm" | "md";
  withDot?: boolean;
  className?: string;
}) {
  const style = CATEGORY_STYLES[category];
  const sizeCls =
    size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono uppercase tracking-wide ${style.chip} ${sizeCls} ${className}`}
      data-category={category}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
        />
      ) : null}
      {style.label}
    </span>
  );
}
