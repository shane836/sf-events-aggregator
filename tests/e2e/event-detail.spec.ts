import { expect, test } from "@playwright/test";

/**
 * E1, E2, E3: source link affordance, source link liveness, price visibility.
 *
 * E4 (price text matches `formatPriceDisplay`) is covered by the API
 * integration test in tests/api/events.test.ts.
 */

test.describe("E. source link + price visibility", () => {
  test("E1: every event card contains an external source anchor", async ({
    page,
  }) => {
    await page.goto("/");
    const cards = page.locator("[data-event-card]");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 25); i++) {
      const card = cards.nth(i);
      const source = card.locator("a[data-source-link]");
      await expect(source).toHaveCount(1);
      const href = await source.getAttribute("href");
      const target = await source.getAttribute("target");
      const rel = await source.getAttribute("rel");
      expect(href).toBeTruthy();
      expect(target).toBe("_blank");
      expect(rel).toMatch(/noopener/);
      expect(rel).toMatch(/noreferrer/);
    }
  });

  test("E2: first 10 source URLs are reachable (not 5xx/dns-fail)", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const sources = page.locator("[data-event-card] a[data-source-link]");
    await expect(sources.first()).toBeAttached({ timeout: 15_000 });
    const hrefs = Array.from(
      new Set(
        await sources.evaluateAll((els) =>
          els.map((e) => (e as HTMLAnchorElement).href),
        ),
      ),
    ).slice(0, 10);

    // "Reachable" = the host answered. Many ticketing sites return 403/405
    // to HEAD requests from non-browser clients — that's not a broken link
    // from a user's perspective. We count 2xx/3xx/4xx as reachable, and
    // 5xx or DNS/network errors as failures.
    let ok = 0;
    const reasons: string[] = [];
    for (const href of hrefs) {
      let status: number | null = null;
      let errText = "";
      try {
        const head = await request.head(href, {
          timeout: 10_000,
          maxRedirects: 5,
        });
        status = head.status();
        if (status >= 500) {
          // Retry as GET; some sites only return real status on GET
          const get = await request.get(href, {
            timeout: 10_000,
            maxRedirects: 5,
          });
          status = get.status();
        }
      } catch (err) {
        errText = err instanceof Error ? err.message : String(err);
      }
      if (status != null && status < 500) {
        ok++;
      } else {
        reasons.push(`${href} → ${status ?? errText}`);
      }
    }
    // Rubric: >= 9/10. We give a 1-fail floor since some venue sites are
    // genuinely flaky over HEAD.
    expect(
      ok,
      `${ok}/${hrefs.length} source URLs reachable\n${reasons.join("\n")}`,
    ).toBeGreaterThanOrEqual(Math.max(0, Math.min(9, hrefs.length - 1)));
  });

  test("E3: every event card renders a non-empty [data-price]", async ({
    page,
  }) => {
    await page.goto("/");
    const cards = page.locator("[data-event-card]");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 25); i++) {
      const card = cards.nth(i);
      const price = card.locator("[data-price]");
      await expect(price).toHaveCount(1);
      const text = (await price.innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
    }
  });

  test("opens the modal when ?event=<id> is set and Esc closes it", async ({
    page,
  }) => {
    await page.goto("/");
    const cards = page.locator("[data-event-card]");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const firstId = await cards.first().getAttribute("data-event-card");
    expect(firstId).toBeTruthy();
    await page.goto(`/?event=${firstId}`);
    const modal = page.getByTestId("event-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("modal-source-link")).toHaveAttribute(
      "target",
      "_blank",
    );

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/^[^?]*\/?$/);
  });
});
