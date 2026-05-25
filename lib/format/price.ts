import type { PriceInfo } from "@/lib/sources/types";

/**
 * Presentation formatter — pure, synchronous, USD only for MVP.
 *
 * Used by both the UI (calendar cards, detail modal) and the email digest
 * server renderer. Keep this the only place that turns structured price
 * data into display text so the two surfaces never drift.
 *
 * Multi-currency is explicitly out of scope; revisit if/when we expand
 * beyond SF.
 */
export function formatPriceDisplay(pricing?: PriceInfo | null): string {
  if (!pricing) return "Price varies";
  if (pricing.isFree) return "Free";

  const { priceMin, priceMax } = pricing;
  if (priceMin == null && priceMax == null) return "Price varies";

  if (priceMin != null && priceMax != null && priceMin !== priceMax) {
    return `$${fmt(priceMin)}–$${fmt(priceMax)}`;
  }
  const single = (priceMin ?? priceMax) as number;
  return single === 0 ? "Free" : `$${fmt(single)}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
