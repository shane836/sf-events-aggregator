import type { Category, PriceInfo, VerificationLevel } from "@/lib/sources/types";

/**
 * Shape returned by `/api/events`. This file is the seam between the UI
 * (Stream E, `app/**`) and the route handler — UI never imports `db/`.
 *
 * Keep in sync with `app/api/events/route.ts::toResponseEvent`.
 */
export type ApiVenue = {
  id: string;
  name: string;
  city: string;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export type ApiEvent = {
  id: string;
  title: string;
  category: Category;
  startTimeUtc: string;
  endTimeUtc: string | null;
  timezone: string;
  venue: ApiVenue;
  source: string;
  sourceUrl: string;
  verificationLevel: VerificationLevel;
  pricing: PriceInfo;
  priceDisplay: string;
  description: string | null;
  seriesId: string | null;
};

export type ApiResponse = {
  events: ApiEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type EventsQuery = {
  categories?: Category[];
  from?: string;
  to?: string;
  /** Concrete `venues.city` values; OR-matched. */
  cities?: string[];
  neighborhood?: string;
  limit?: number;
};

async function originForServer(): Promise<string> {
  // Prefer the incoming request's own host — survives Vercel preview URLs,
  // production aliases, and local dev without env-var configuration.
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request scope — fall through to env.
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

/**
 * Server-side fetcher. Hits the route handler over HTTP so the rendering
 * layer never imports `db/*` (rubric A3).
 */
export async function fetchEvents(q: EventsQuery = {}): Promise<ApiResponse> {
  const sp = new URLSearchParams();
  for (const c of q.categories ?? []) sp.append("category", c);
  if (q.from) sp.set("from", q.from);
  if (q.to) sp.set("to", q.to);
  for (const c of q.cities ?? []) sp.append("city", c);
  if (q.neighborhood) sp.set("neighborhood", q.neighborhood);
  if (q.limit) sp.set("limit", String(q.limit));

  const origin = await originForServer();
  const url = `${origin}/api/events?${sp.toString()}`;
  const res = await fetch(url, {
    next: { revalidate: 900 },
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `fetchEvents: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as ApiResponse;
}
