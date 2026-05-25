import { expect, test } from "@playwright/test";

/**
 * M5 D5: INP (Interaction to Next Paint) on view-mode toggle ≤ 200ms.
 *
 * Measured via Playwright's PerformanceObserver — captures `event` entries
 * and reports the longest one within the interaction window. Synthetic
 * measurement (local dev build), but D5 is about main-thread responsiveness
 * of the React state update, which doesn't depend meaningfully on network
 * round-trip the way LCP/FCP do.
 */

const TARGET_MS = 200;

test.describe("D5. INP on view-mode toggle", () => {
  test("clicking the week button settles within 200ms", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-viewport");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Install a PerformanceObserver in the page. Captures `event` entries
    // (Long-Animation-Frame + Event Timing) and stashes the max duration.
    await page.evaluate(() => {
      (window as unknown as { __maxEventDuration?: number }).__maxEventDuration = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEventTiming;
          const w = window as unknown as { __maxEventDuration: number };
          if (e.duration > w.__maxEventDuration) {
            w.__maxEventDuration = e.duration;
          }
        }
      });
      observer.observe({ type: "event", buffered: true, durationThreshold: 16 });
    });

    // Trigger the interaction.
    const t0 = await page.evaluate(() => performance.now());
    await page.locator('[data-view-toggle-button="week"]').click();
    await page.waitForURL(/view=week/);
    await page.locator('[data-view="week"]').waitFor({ state: "visible" });
    const t1 = await page.evaluate(() => performance.now());
    const wallClock = t1 - t0;

    // Read out the max event duration captured.
    const maxEvent = await page.evaluate(
      () =>
        (window as unknown as { __maxEventDuration?: number })
          .__maxEventDuration ?? 0,
    );

    console.log(
      `[D5] wall-clock click→paint: ${wallClock.toFixed(0)}ms · max event-timing: ${maxEvent.toFixed(0)}ms`,
    );
    // INP is the *single longest event*, not the wall clock. The wall clock
    // is reported for context (includes the server round-trip + render).
    expect(maxEvent).toBeLessThanOrEqual(TARGET_MS);
  });
});
