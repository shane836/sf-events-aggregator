import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * F. accessibility + console-error checks.
 *
 * Only the desktop project runs the full a11y sweep; mobile/tablet projects
 * share the same DOM so we don't triple-cost the suite.
 */

test.describe("F. a11y + console", () => {
  test("F1: no console errors on home", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "F1 single-viewport");
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.locator("[data-event-card]").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("F2: no console errors after a filter interaction", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "F2 single-viewport");
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.locator("[data-event-card]").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-category-filter='music']").click();
    await page.waitForTimeout(500);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("F3: no console errors opening event detail", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "F3 single-viewport");
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    const first = page.locator("[data-event-card]").first();
    await first.waitFor({ timeout: 15_000 });
    const id = await first.getAttribute("data-event-card");
    await page.goto(`/?event=${id}`);
    await expect(page.getByTestId("event-modal")).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("F4: axe-core finds 0 serious/critical violations on home + filter + modal", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "F4 single-viewport");
    await page.goto("/");
    await page.locator("[data-event-card]").first().waitFor({ timeout: 15_000 });

    let result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expectNoSerious(result.violations, "home");

    await page.locator("[data-category-filter='music']").click();
    await page.waitForTimeout(400);
    result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expectNoSerious(result.violations, "filtered");

    const card = page.locator("[data-event-card]").first();
    const id = await card.getAttribute("data-event-card");
    await page.goto(`/?event=${id}`);
    await expect(page.getByTestId("event-modal")).toBeVisible();
    result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expectNoSerious(result.violations, "modal");
  });

  test("F5: color contrast passes WCAG AA (covered by F4 color-contrast rule)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "F5 single-viewport");
    await page.goto("/");
    await page.locator("[data-event-card]").first().waitFor({ timeout: 15_000 });
    const result = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    const serious = result.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious,
      serious
        .map(
          (v) =>
            `${v.id}: ${v.nodes.length} node(s)\n${v.nodes
              .map((n) => n.failureSummary)
              .join("\n")}`,
        )
        .join("\n---\n"),
    ).toEqual([]);
  });
});

function expectNoSerious(
  violations: { id: string; impact?: string | null; nodes: { failureSummary?: string }[] }[],
  label: string,
) {
  const serious = violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious,
    `[${label}] ${serious
      .map(
        (v) =>
          `${v.id}: ${v.nodes.length} node(s)\n${v.nodes
            .map((n) => n.failureSummary)
            .join("\n")}`,
      )
      .join("\n---\n")}`,
  ).toEqual([]);
}
