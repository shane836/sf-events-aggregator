import * as cheerio from "cheerio";

/**
 * Shared HTML-fetch helper for Tier-3 scrapers.
 *
 * Mirrors lib/ical.ts in spirit: one IO entrypoint, no per-adapter
 * boilerplate, identifies the project in its User-Agent so site operators
 * can correlate traffic. Scraper adapters should call this rather than
 * `fetch()` directly.
 *
 * Returns a cheerio loader pre-applied to the response body, plus the raw
 * HTML (for fixture capture + JSON-LD parsing) and the final URL after
 * redirects (useful for resolving relative links).
 */

const DEFAULT_UA =
  "sf-events-aggregator/0.1 (+https://github.com/shane836/sf-events-aggregator)";

export type FetchHtmlResult = {
  $: cheerio.CheerioAPI;
  html: string;
  finalUrl: string;
  status: number;
};

export async function fetchHtml(
  url: string,
  opts: {
    ua?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 20_000,
  );

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": opts.ua ?? DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml",
        ...opts.headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    const html = await resp.text();
    if (isAntiBotBlock(html)) {
      throw new Error(
        `anti-bot block detected at ${url} (Cloudflare interstitial or similar). B6: stop, mark HUMAN-REVIEW-NEEDED.`,
      );
    }
    return {
      $: cheerio.load(html),
      html,
      finalUrl: resp.url,
      status: resp.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract all JSON-LD blocks from a parsed page, flattened (handles
 * `@graph` wrappers and arrays of objects). Filter the result by
 * `@type === "Event"` when you want event-only nodes.
 */
export function parseJsonLd($: cheerio.CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    pushFlattened(out, parsed);
  });
  return out;
}

function pushFlattened(out: unknown[], node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) pushFlattened(out, item);
    return;
  }
  if (node && typeof node === "object" && "@graph" in node) {
    pushFlattened(out, (node as { "@graph": unknown })["@graph"]);
    return;
  }
  out.push(node);
}

/**
 * Filter JSON-LD nodes to those describing an Event (or one of its
 * Schema.org subtypes — MusicEvent, ComedyEvent, etc.).
 */
export function filterEventNodes(nodes: unknown[]): Record<string, unknown>[] {
  return nodes.filter((n): n is Record<string, unknown> => {
    if (!n || typeof n !== "object") return false;
    const t = (n as Record<string, unknown>)["@type"];
    if (typeof t === "string") return /Event$/i.test(t) || t === "Event";
    if (Array.isArray(t))
      return t.some((s) => typeof s === "string" && /Event$/i.test(s));
    return false;
  });
}

/**
 * Pull standard og: meta tags. Useful when JSON-LD is absent.
 */
export function parseOgMeta(
  $: cheerio.CheerioAPI,
): { title?: string; description?: string; image?: string; url?: string } {
  const get = (prop: string): string | undefined => {
    const v = $(`meta[property="${prop}"]`).attr("content");
    return v && v.trim() ? v.trim() : undefined;
  };
  return {
    title: get("og:title"),
    description: get("og:description"),
    image: get("og:image"),
    url: get("og:url"),
  };
}

/**
 * Resolve a possibly-relative href against a base URL.
 * Returns null if the input is empty / invalid.
 */
export function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Common anti-bot fingerprints. Returns true if the HTML body looks like
 * a Cloudflare challenge / waiting room / "Just a moment" interstitial
 * rather than real content.
 *
 * Per M3 rubric B6: detect, document, abort. Do NOT bypass.
 */
export function isAntiBotBlock(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  if (lower.length < 5000 && lower.includes("just a moment")) return true;
  if (lower.includes("cf-browser-verification")) return true;
  if (lower.includes("cf-challenge")) return true;
  if (
    lower.includes("attention required") &&
    lower.includes("cloudflare")
  )
    return true;
  return false;
}
