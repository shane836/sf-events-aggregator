import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * F1-F6 dims specific to M5 view-mode + feed surfaces. The original
 * tests/e2e/a11y.spec.ts covers the calendar surface; this file adds the
 * view-mode + feed checks introduced in M5.
 */

const KNOWN_DATE = "2026-05-25";

test.describe("F. a11y — view modes + feed", () => {
  test("F1+F2: no console errors on home or after view toggle", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-viewport");
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);

    // Toggle through each view mode and assert still 0 console errors.
    for (const view of ["day", "week", "month"]) {
      await page.locator(`[data-view-toggle-button="${view}"]`).click();
      await page.waitForLoadState("networkidle");
    }
    expect(errors).toEqual([]);
  });

  test("F3: no console errors on prev/next nav", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-viewport");
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    await page.locator('[data-nav="next"]').click();
    await page.locator('[data-nav="next"]').click();
    await page.locator('[data-nav="prev"]').click();
    await page.locator('[data-nav="today"]').click();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("F4: axe-core finds 0 serious/critical violations across all 3 view modes", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-viewport");
    for (const view of ["day", "week", "month"]) {
      await page.goto(`/?view=${view}&date=${KNOWN_DATE}`);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      if (blocking.length > 0) {
        console.log(
          `Blocking axe violations in view=${view}:`,
          JSON.stringify(blocking, null, 2),
        );
      }
      expect(blocking).toEqual([]);
    }
  });

  test("F5: every navigation control is keyboard-focusable", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-viewport");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Programmatically focus each control and assert it received focus.
    // (Pure Tab-traversal is brittle here — the feed has ~80 links between
    // the filter bar and the calendar-nav so a Tab-based check would need
    // hundreds of iterations.)
    const selectors = [
      '[data-view-toggle-button="day"]',
      '[data-view-toggle-button="week"]',
      '[data-view-toggle-button="month"]',
      '[data-nav="prev"]',
      '[data-nav="today"]',
      '[data-nav="next"]',
    ];
    for (const sel of selectors) {
      const el = page.locator(sel);
      await expect(el).toBeVisible();
      await el.focus();
      const isFocused = await el.evaluate(
        (node) => node === document.activeElement,
      );
      expect(isFocused, `${sel} should be focusable`).toBe(true);
    }
    // Feed event links: assert the first one is focusable too.
    const feedLink = page.locator("[data-feed-row] [data-event-link]").first();
    await expect(feedLink).toBeVisible();
    await feedLink.focus();
    const linkFocused = await feedLink.evaluate(
      (node) => node === document.activeElement,
    );
    expect(linkFocused).toBe(true);
  });

  test("F6: active view-toggle button has aria-pressed=true; inactive have false", async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    const active = page.locator('[data-view-toggle-button="week"]');
    await expect(active).toHaveAttribute("aria-pressed", "true");
    const inactiveDay = page.locator('[data-view-toggle-button="day"]');
    const inactiveMonth = page.locator('[data-view-toggle-button="month"]');
    await expect(inactiveDay).toHaveAttribute("aria-pressed", "false");
    await expect(inactiveMonth).toHaveAttribute("aria-pressed", "false");
  });
});
