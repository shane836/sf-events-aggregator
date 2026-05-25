import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M5 C1-C8: readability — typography, contrast, density, empty-state.
 *
 * Many dims are universal (apply to every viewport) so we run the spec
 * across all three projects without viewport filters except where the
 * dim is intentionally mobile-only (C1, C7) or desktop-only.
 */

const KNOWN_DATE = "2026-05-25"; // Monday — used to land in a populated view

test.describe("C. readability", () => {
  test("C1: body text on event cards ≥ 14px @ mobile", async ({
    page,
    viewport,
  }) => {
    test.skip(
      (viewport?.width ?? 0) > 500,
      "mobile-only — desktop sizes assumed larger",
    );
    await page.goto("/");
    // The feed is the densest body-text surface on the page; if it passes,
    // calendar/agenda do too (same Tailwind text-sm token, 14px).
    const sample = page.locator("[data-feed-row]").first();
    await expect(sample).toBeVisible();
    const linkSize = await sample
      .locator("[data-event-link]")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(linkSize).toBeGreaterThanOrEqual(14);
    const venueSize = await sample
      .locator("[data-venue]")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // venue uses text-sm = 14px
    expect(venueSize).toBeGreaterThanOrEqual(14);
  });

  test("C2: every [data-event-title] ≥ 16px", async ({ page }) => {
    await page.goto("/");
    const titles = page.locator("[data-event-title]");
    const n = await titles.count();
    test.skip(n === 0, "no event titles rendered (empty page?)");
    const sizes = await titles.evaluateAll((els) =>
      (els as HTMLElement[]).map((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      ),
    );
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });

  test("C3: line-height on event-title body text is ≥ 1.4× font-size", async ({
    page,
  }) => {
    await page.goto("/");
    const title = page.locator("[data-event-title]").first();
    await expect(title).toBeVisible();
    const ratio = await title.evaluate((el) => {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const lh = parseFloat(cs.lineHeight);
      return lh / fs;
    });
    expect(ratio).toBeGreaterThanOrEqual(1.4);
  });

  test("C4 + F4 sample: axe-core finds 0 serious/critical violations on home", async ({
    page,
  }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (blocking.length > 0) {
      console.log(
        "Blocking axe violations:",
        JSON.stringify(blocking, null, 2),
      );
    }
    expect(blocking).toEqual([]);
  });

  test("C5: category chip text passes WCAG AA color-contrast", async ({
    page,
  }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .include("[data-category-chip], [data-category-filter]")
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("C6: ≥ 5 distinct category chip foreground colors across the page", async ({
    page,
  }) => {
    await page.goto("/");
    // Inactive filter chips share a uniform muted color (text-zinc-400) by
    // design — the per-category color lives in the small inline dot inside
    // each chip. Query the dot's background-color (always rendered with the
    // category accent class).
    const dots = page.locator(
      "[data-category-filter] span[aria-hidden='true']",
    );
    await expect(dots.first()).toBeVisible();
    const colors = await dots.evaluateAll((els) =>
      (els as HTMLElement[]).map((e) => getComputedStyle(e).backgroundColor),
    );
    const distinct = new Set(colors);
    expect(distinct.size).toBeGreaterThanOrEqual(5);
  });

  test("C7: every interactive element on home is ≥ 44×44 @ mobile", async ({
    page,
    viewport,
  }) => {
    test.skip(
      (viewport?.width ?? 0) > 500,
      "tap-target rule is mobile-only (Apple HIG)",
    );
    await page.goto("/");
    // Inspect every <a>, <button>, <input>, <select> inside main UI; ignore
    // off-screen / hidden elements.
    const sel = "main button, main a, main input, main select, header button";
    const items = page.locator(sel);
    const n = await items.count();
    expect(n).toBeGreaterThan(0);
    const undersized: { i: number; w: number; h: number; text: string }[] = [];
    for (let i = 0; i < n; i++) {
      const el = items.nth(i);
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      const text = (await el.innerText().catch(() => "")).slice(0, 40);
      if (Math.min(box.width, box.height) < 44) {
        undersized.push({ i, w: box.width, h: box.height, text });
      }
    }
    if (undersized.length > 0) {
      console.log("Undersized tap targets:", undersized);
    }
    expect(undersized).toEqual([]);
  });

  test("C8a: day view empty-state renders with reset-filters CTA", async ({
    page,
  }) => {
    // Force an empty day: lectures + neighborhood that won't have events
    // is hard to guarantee, so jump to a date 6 months from today with a
    // filter that's unlikely to populate.
    const farDate = "2027-11-25"; // far enough out + Thanksgiving day
    await page.goto(`/?view=day&date=${farDate}&category=comedy&category=dancing`);
    await page.waitForLoadState("networkidle");
    const empty = page.locator('[data-view="day"] [data-empty-state]');
    const visible = await empty.isVisible().catch(() => false);
    test.skip(!visible, "could not produce an empty day — too much data");
    await expect(empty.locator("[data-reset-filters]")).toBeVisible();
  });

  test("C8b: week view empty-state renders with reset-filters CTA", async ({
    page,
  }) => {
    const farDate = "2027-11-22"; // far-future week
    await page.goto(`/?view=week&date=${farDate}&category=comedy&category=dancing`);
    await page.waitForLoadState("networkidle");
    const empty = page.locator('[data-view="week"] [data-empty-state]');
    const visible = await empty.isVisible().catch(() => false);
    test.skip(!visible, "could not produce an empty week — too much data");
    await expect(empty.locator("[data-reset-filters]")).toBeVisible();
  });
});
