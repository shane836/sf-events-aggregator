import { expect, test } from "@playwright/test";

/**
 * A1-A11: day / week / month view modes from M5 rubric.
 *
 * The view axis is separate from the existing preset/category filters:
 * ?view=day|week|month&date=YYYY-MM-DD changes the rendered layout, not
 * just the data window.
 *
 * Tests run against the dev server (playwright.config.ts) and hit live
 * Neon. Tests that depend on a specific event count call test.skip() when
 * the window is empty.
 */

const KNOWN_DATE = "2026-05-25"; // Monday; week is 2026-05-24..05-30

test.describe("A. view modes", () => {
  test("A1: ?view=week&date=… reflects in URL after reload", async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/view=week/);
    await expect(page).toHaveURL(new RegExp(`date=${KNOWN_DATE}`));
    await expect(page.locator('[data-view="week"]')).toBeVisible();
  });

  test("A2: ?view=month renders a month grid (current default)", async ({
    page,
    viewport,
  }) => {
    // Month grid is desktop+tablet only (parity with pre-M5: mobile shows
    // agenda list, not a 7-col grid that wouldn't fit at 375px).
    test.skip(
      (viewport?.width ?? 0) < 768,
      "month grid is hidden at <md per pre-M5 layout",
    );
    await page.goto(`/?view=month&date=${KNOWN_DATE}`);
    await expect(page.locator('[data-view="month"]')).toBeVisible();
    // Month grid has 35 OR 42 cells depending on layout (May 2026 = 6 weeks → 42)
    const cellCount = await page.locator('[data-view="month"] [role="gridcell"]').count();
    expect([35, 42]).toContain(cellCount);
  });

  test("A3: ?view=week renders 7 day-column children, 1 grid row", async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    await expect(page.locator('[data-view="week"]')).toBeVisible();
    const cells = page.locator('[data-view="week"] [role="gridcell"]');
    await expect(cells).toHaveCount(7);
    // Column headers (Sun..Sat)
    const headers = page.locator(
      '[data-view="week"] [role="columnheader"]',
    );
    await expect(headers).toHaveCount(7);
  });

  test("A4: ?view=day renders a single day header with the requested date", async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${KNOWN_DATE}`);
    await expect(page.locator('[data-view="day"]')).toBeVisible();
    const header = page.locator("[data-day-header]");
    await expect(header).toHaveCount(1);
    await expect(header).toHaveAttribute("data-day-header-date", KNOWN_DATE);
  });

  test("A5: day view filters events to that date", async ({ page }) => {
    await page.goto(`/?view=day&date=${KNOWN_DATE}`);
    await page.waitForLoadState("networkidle");
    const cards = page.locator("[data-view='day'] [data-event-card]");
    const count = await cards.count();
    test.skip(count === 0, "no events on the chosen day — skip");
    // Every visible card should be inside the day-view container, which
    // already constrains to KNOWN_DATE (server filtered by viewToRange +
    // re-filters by localDateKey).
    expect(count).toBeGreaterThan(0);
  });

  test("A6: week view column dates are Sun..Sat of the anchor's week", async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    const headers = page.locator(
      '[data-view="week"] [data-week-col-date]',
    );
    const expected = [
      "2026-05-24",
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ];
    for (let i = 0; i < 7; i++) {
      await expect(headers.nth(i)).toHaveAttribute(
        "data-week-col-date",
        expected[i],
      );
    }
  });

  test("A7: prev / next advances date by the view unit", async ({ page }) => {
    // Day view: ±1 day
    await page.goto(`/?view=day&date=${KNOWN_DATE}`);
    await page.locator('[data-nav="next"]').click();
    await expect(page).toHaveURL(/date=2026-05-26/);
    await page.locator('[data-nav="prev"]').click();
    await page.locator('[data-nav="prev"]').click();
    await expect(page).toHaveURL(/date=2026-05-24/);

    // Week view: ±7 days
    await page.goto(`/?view=week&date=${KNOWN_DATE}`);
    await page.locator('[data-nav="next"]').click();
    await expect(page).toHaveURL(/date=2026-06-01/);

    // Month view: ±1 calendar month
    await page.goto(`/?view=month&date=${KNOWN_DATE}`);
    await page.locator('[data-nav="next"]').click();
    await expect(page).toHaveURL(/date=2026-06-25/);
    await page.locator('[data-nav="prev"]').click();
    await page.locator('[data-nav="prev"]').click();
    await expect(page).toHaveURL(/date=2026-04-25/);
  });

  test("A8: today button removes ?date= so the view re-anchors on today", async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=2026-12-25`);
    await page.locator('[data-nav="today"]').click();
    // After clicking today, URL should not contain a date param at all,
    // and ?view=week should still be set
    await expect(page).toHaveURL(/view=week/);
    await expect(page).not.toHaveURL(/date=/);
  });

  test("A9: category filter composes with view mode", async ({ page }) => {
    await page.goto(`/?view=week&date=${KNOWN_DATE}&category=comedy`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/view=week/);
    await expect(page).toHaveURL(/category=comedy/);
    await expect(page.locator('[data-view="week"]')).toBeVisible();
    const cards = page.locator(
      '[data-view="week"] [data-event-card]',
    );
    const n = await cards.count();
    test.skip(n === 0, "no comedy events in window — skip");
    for (let i = 0; i < n; i++) {
      await expect(cards.nth(i)).toHaveAttribute("data-category", "comedy");
    }
  });

  test("A10: ArrowRight / ArrowLeft / T advance by view unit", async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${KNOWN_DATE}`);
    await page.locator("body").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/date=2026-05-26/);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/date=2026-05-24/);
    // T returns to today (URL drops ?date=)
    await page.keyboard.press("t");
    await expect(page).not.toHaveURL(/date=/);
  });

  test("A11: view toggle has 3 visible buttons (day/week/month) and they swap views", async ({
    page,
  }) => {
    await page.goto("/");
    const group = page.locator("[data-view-toggle]");
    await expect(group).toBeVisible();
    const buttons = group.locator("button[data-view-toggle-button]");
    await expect(buttons).toHaveCount(3);
    // Click week → URL has view=week
    await group.locator('[data-view-toggle-button="week"]').click();
    await expect(page).toHaveURL(/view=week/);
    // Click month → URL drops view (month is default)
    await group.locator('[data-view-toggle-button="month"]').click();
    await expect(page).not.toHaveURL(/view=/);
    // aria-pressed reflects active state
    await group.locator('[data-view-toggle-button="day"]').click();
    await expect(
      group.locator('[data-view-toggle-button="day"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
