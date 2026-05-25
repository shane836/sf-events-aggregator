import { createHash } from "node:crypto";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cross-source dedup key. Uses *normalized venue name* (not venueId) so two
 * sources publishing the same event under slightly different venue rows
 * still collapse to one fingerprint. If sources drift badly on venue
 * spelling, we can add a venue-resolution step and re-key on venueId — but
 * that requires re-ingest (every fingerprint changes).
 */
export function fingerprint(input: {
  title: string;
  venueName: string;
  startTime: Date;
}): string {
  const day = input.startTime.toISOString().slice(0, 10);
  const key = `${normalizeTitle(input.title)}|${normalizeTitle(input.venueName)}|${day}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export type PriceInput = {
  priceMin?: number | null;
  priceMax?: number | null;
  isFree?: boolean;
};

export function priceDisplay(p: PriceInput): string {
  if (p.isFree) return "Free";
  const { priceMin, priceMax } = p;
  if (priceMin == null && priceMax == null) return "Price varies";
  if (priceMin != null && priceMax != null && priceMin !== priceMax) {
    return `$${fmt(priceMin)}–$${fmt(priceMax)}`;
  }
  const single = priceMin ?? priceMax!;
  return single === 0 ? "Free" : `$${fmt(single)}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
