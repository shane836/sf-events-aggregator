import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for M2 calendar UI rubric tests.
 *
 * Three projects mirror the rubric's required viewports (C1/C2/C3):
 *   - desktop  (1440x900)  → grid layout
 *   - tablet   (768x1024)  → grid layout
 *   - mobile   (375x812)   → agenda layout (C4)
 *
 * Some specs only run at a single viewport — they tag-skip via `test.skip()`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // tests share a single dev server
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
});
