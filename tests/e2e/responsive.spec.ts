import { expect, test } from "@playwright/test";

/**
 * C1-C5: responsive layout assertions.
 *
 * C1/C2/C3 — no horizontal scroll at 375, 768, 1440.
 * C4       — at 375, the agenda view paints, not the grid.
 * C5       — interactive tap targets >= 44px (min) on mobile.
 */

test.describe("C. responsive", () => {
  test("C1/C2/C3: no horizontal scroll at any project viewport", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("[data-event-card]").first()).toBeVisible({
      timeout: 15_000,
    });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `${testInfo.project.name}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth + 1); // +1 tolerance for sub-pixel rounding
  });

  test("C4: at 375px viewport, agenda layout paints (not grid)", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "C4 only checked on mobile project",
    );
    await page.goto("/");
    const agenda = page.locator("[data-view-mode='agenda']").first();
    const grid = page.locator("[data-view-mode='grid']").first();
    // Both are in DOM; only the agenda paints visibly at < md.
    await expect(agenda).toBeVisible({ timeout: 15_000 });
    await expect(grid).toBeHidden();
  });

  test("C5: every interactive element has a >= 44px tap target on mobile", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "C5 only checked on mobile project",
    );
    await page.goto("/");
    await expect(page.locator("[data-event-card]").first()).toBeVisible({
      timeout: 15_000,
    });

    // Only count interactive elements rendered in the visible mobile layout.
    // The off-screen agenda mount is `display:none` at md+ but at mobile the
    // visible agenda is what we want — agendalist is the only visible variant.
    const visibleAgenda = page.locator("[data-view-mode='agenda']").first();
    const interactive = visibleAgenda.locator(
      "a[href], button, select, [role=button]",
    );
    const count = await interactive.count();
    expect(count).toBeGreaterThan(0);

    let failures = 0;
    const reasons: string[] = [];
    for (let i = 0; i < Math.min(count, 30); i++) {
      const el = interactive.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      const min = Math.min(box.width, box.height);
      if (min < 44) {
        failures++;
        const tag = await el.evaluate((n) => (n as HTMLElement).outerHTML.slice(0, 80));
        reasons.push(`${tag} (${box.width}x${box.height})`);
      }
    }
    expect(failures, reasons.join("\n")).toBe(0);
  });
});
