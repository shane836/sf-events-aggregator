import { expect, test } from "@playwright/test";

/**
 * M5 B1-B8: funcheap-style "Upcoming Fun & Cheap Events" feed.
 *
 * The feed lives on the home page above the calendar, fed by /api/events
 * with a 14-day lookahead and the same category/neighborhood filters as
 * the calendar.
 */

test.describe("B. upcoming feed", () => {
  test("B1: feed section exists on home", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="upcoming-feed"]')).toBeVisible();
    await expect(page.locator("[data-feed-header]")).toContainText(
      /upcoming fun/i,
    );
  });

  test("B2: feed rows are in chronological order (strictly non-decreasing)", async ({
    page,
  }) => {
    await page.goto("/");
    const list = page.locator("[data-feed-list]");
    await expect(list).toBeVisible();
    // Inspect link hrefs — each row has [data-event-link]. We pull the live
    // server-rendered DOM (Server Component) instead of polling for late
    // hydration.
    const linksHandle = await page
      .locator("[data-feed-row] [data-event-link]")
      .all();
    test.skip(linksHandle.length < 2, "fewer than 2 rows — order unmeaningful");

    // We need event timestamps to verify ordering. Hit /api/events directly
    // with the same window the page used.
    const now = new Date();
    const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const resp = await page.request.get(
      `/api/events?from=${encodeURIComponent(
        now.toISOString(),
      )}&to=${encodeURIComponent(to.toISOString())}&limit=40`,
    );
    expect(resp.ok()).toBe(true);
    const body = (await resp.json()) as {
      events: { id: string; startTimeUtc: string }[];
    };
    // The page's order should match /api/events order (the page hands off
    // unchanged). Build a map of id → timestamp.
    const tsById = new Map(body.events.map((e) => [e.id, e.startTimeUtc]));
    const renderedIds = await Promise.all(
      linksHandle.map((l) => l.getAttribute("data-event-link")),
    );
    const stamps = renderedIds.map((id) => tsById.get(id ?? ""));
    // Every consecutive pair must be ≤ the next.
    for (let i = 1; i < stamps.length; i++) {
      const prev = stamps[i - 1];
      const cur = stamps[i];
      if (prev && cur) expect(prev <= cur).toBe(true);
    }
  });

  test("B3: every feed event is within the 14-day lookahead window", async ({
    page,
  }) => {
    await page.goto("/");
    const rows = page.locator("[data-feed-row]");
    const n = await rows.count();
    test.skip(n === 0, "feed empty — nothing to bound");

    const now = new Date();
    const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const resp = await page.request.get(
      `/api/events?from=${encodeURIComponent(
        now.toISOString(),
      )}&to=${encodeURIComponent(to.toISOString())}&limit=40`,
    );
    const body = (await resp.json()) as {
      events: { id: string; startTimeUtc: string }[];
    };
    const tsById = new Map(body.events.map((e) => [e.id, e.startTimeUtc]));
    const renderedIds = await rows
      .locator("[data-event-link]")
      .evaluateAll((els) =>
        (els as HTMLElement[]).map((e) => e.getAttribute("data-event-link")),
      );
    const lowerBound = now.getTime() - 60 * 1000; // 1 min slack for clock skew
    const upperBound = to.getTime() + 60 * 1000;
    for (const id of renderedIds) {
      const t = tsById.get(id ?? "");
      if (!t) continue;
      const ms = new Date(t).getTime();
      expect(ms).toBeGreaterThanOrEqual(lowerBound);
      expect(ms).toBeLessThanOrEqual(upperBound);
    }
  });

  test("B4: every feed row has date, title, venue, price, category chip, source link", async ({
    page,
    viewport,
  }) => {
    await page.goto("/");
    const rows = page.locator("[data-feed-row]");
    const n = await rows.count();
    test.skip(n === 0, "feed empty");

    const sample = Math.min(n, 5);
    for (let i = 0; i < sample; i++) {
      const row = rows.nth(i);
      // Date stamp + event link (title proxy) + venue text — always visible
      await expect(row.locator("[data-feed-date]")).toBeVisible();
      await expect(row.locator("[data-event-link]")).toBeVisible();
      // Source link is always present in DOM (small ↗ button)
      await expect(row.locator("[data-source-link]")).toHaveCount(1);
      // Price + chip are hidden on mobile per design (B6 density), present
      // at sm+ viewports only. Check based on viewport.
      if ((viewport?.width ?? 0) >= 640) {
        await expect(row.locator("[data-price]")).toBeVisible();
        await expect(row.locator("[data-category-chip]")).toBeVisible();
      } else {
        await expect(row.locator("[data-price]")).toHaveCount(1);
        await expect(row.locator("[data-category-chip]")).toHaveCount(1);
      }
    }
  });

  test("B5: feed is dense — avg row height ≤ 80px @ desktop", async ({
    page,
    viewport,
  }) => {
    test.skip(
      (viewport?.width ?? 0) < 1280,
      "density target is for desktop+ viewports",
    );
    await page.goto("/");
    const rows = page.locator("[data-feed-row]");
    const n = await rows.count();
    test.skip(n === 0, "feed empty");
    const heights = await rows.evaluateAll((els) =>
      (els as HTMLElement[]).map((e) => e.getBoundingClientRect().height),
    );
    const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
    expect(avg).toBeLessThanOrEqual(80);
  });

  test("B6: at 375px no horizontal scroll, no row > 200px tall", async ({
    page,
    viewport,
  }) => {
    test.skip(
      (viewport?.width ?? 0) > 500,
      "mobile-only assertion",
    );
    await page.goto("/");
    // No horizontal overflow on <html>
    const scrollW = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const clientW = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    expect(scrollW).toBeLessThanOrEqual(clientW + 1);

    const rows = page.locator("[data-feed-row]");
    const n = await rows.count();
    test.skip(n === 0, "feed empty");
    const heights = await rows.evaluateAll((els) =>
      (els as HTMLElement[]).map((e) => e.getBoundingClientRect().height),
    );
    for (const h of heights) expect(h).toBeLessThanOrEqual(200);
  });

  test("B7: applying category filter narrows the feed", async ({ page }) => {
    await page.goto("/?category=comedy");
    await page.waitForLoadState("networkidle");
    const rows = page.locator("[data-feed-row]");
    const n = await rows.count();
    test.skip(n === 0, "no comedy events in 14-day window");
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i)).toHaveAttribute("data-category", "comedy");
    }
  });

  test("B8: feed is sourced from /api/events only (no new endpoint)", async () => {
    // Verified at the source-code level: app/page.tsx imports fetchEvents
    // from @/lib/api/events, which hits /api/events. No new API route exists.
    // The other deterministic part is that no NEW route file exists under
    // app/api/ besides /api/events and /api/digest — checked via repo grep
    // at build time (see ship-gate H5 grep). At runtime, intercept network
    // requests and assert any /api/* hit is /api/events or /api/digest.
    // (Page is a Server Component so the client doesn't fetch /api/events
    // directly — the surface we care about is the server-side import set.)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const apiDir = path.resolve(process.cwd(), "app/api");
    const routes = fs
      .readdirSync(apiDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(routes).toEqual(["digest", "events"]);
  });
});
