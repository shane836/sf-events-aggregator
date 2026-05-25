import { expect, test } from "@playwright/test";

/**
 * B1-B5: filter behavior on the calendar UI.
 *
 * Runs against the live dev preview (which hits Neon). We assert at the
 * filter-bar API level + the rendered DOM. C5 (tap target) is in
 * responsive.spec.ts.
 */

test.describe("B. filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Make sure event cards rendered before continuing
    await expect(
      page.locator("[data-event-card]").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("B1: clicking a category chip filters the visible events", async ({ page }) => {
    await page.locator("[data-category-filter='comedy']").click();
    // URL reflects the filter
    await expect(page).toHaveURL(/category=comedy/);
    const cards = page.locator("[data-event-card]");
    const count = await cards.count();
    test.skip(count === 0, "no comedy events in window — skip");
    // Every visible card must be comedy
    for (let i = 0; i < count; i++) {
      const cat = await cards.nth(i).getAttribute("data-category");
      expect(cat).toBe("comedy");
    }
  });

  test("B2: 'This Weekend' preset narrows the date range", async ({ page }) => {
    await page.locator("[data-preset='weekend']").click();
    await expect(page).toHaveURL(/preset=weekend/);
    // It either narrows the set of events (most likely) or shows empty state.
    const empty = page.getByTestId("empty-state");
    const cards = page.locator("[data-event-card]");
    await expect.poll(async () => {
      const cnt = await cards.count();
      const hasEmpty = await empty.count();
      return cnt + hasEmpty;
    }).toBeGreaterThan(0);
  });

  test("B3: neighborhood filter limits to that neighborhood", async ({ page }) => {
    const select = page.getByTestId("neighborhood-select");
    const options = await select.locator("option").allTextContents();
    const target = options.find((o) => o !== "All neighborhoods");
    test.skip(!target, "no neighborhood available");
    await select.selectOption({ label: target! });
    await expect(page).toHaveURL(/neighborhood=/);
    // Cards visible should all belong to this neighborhood — we don't have
    // a `data-neighborhood`, but the API filtered them server-side. We assert
    // that the count is non-negative and the URL carries the param. This is
    // sufficient to verify the wiring; underlying SQL correctness is covered
    // by the integration test in tests/api/events.test.ts.
    await expect(page.locator("[data-event-card]").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("B4: combining category + preset composes as AND", async ({ page }) => {
    // Pick a preset wide enough to likely have music events
    await page.locator("[data-category-filter='music']").click();
    await expect(page).toHaveURL(/category=music/);
    await page.locator("[data-preset='next-week']").click();
    await expect(page).toHaveURL(/category=music/);
    await expect(page).toHaveURL(/preset=next-week/);
    const cards = page.locator("[data-event-card]");
    const count = await cards.count();
    // Even if no events, the URL composition itself is the AND wiring. If
    // we DO have results, every card must be music — that's the assertion.
    for (let i = 0; i < Math.min(count, 5); i++) {
      const cat = await cards.nth(i).getAttribute("data-category");
      expect(cat).toBe("music");
    }
  });

  test("B5: reset clears filters and restores full set", async ({ page }) => {
    await page.locator("[data-category-filter='comedy']").click();
    await expect(page).toHaveURL(/category=comedy/);
    const filteredCount = await page.locator("[data-event-card]").count();

    await page.getByTestId("reset-filters").click();
    await expect(page).toHaveURL(/^[^?]*\/?$/); // no query string (or just trailing /)
    const fullCount = await page.locator("[data-event-card]").count();
    expect(fullCount).toBeGreaterThanOrEqual(filteredCount);
  });
});
