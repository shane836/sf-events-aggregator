#!/usr/bin/env node
/**
 * M5 D1-D8 Lighthouse runner.
 *
 * Usage:
 *   node scripts/lighthouse-m5.mjs                       # localhost smoke
 *   node scripts/lighthouse-m5.mjs https://prod.url      # rubric ship gate
 *
 * Asserts (mobile profile, throttled to "Slow 4G"):
 *   D1 LCP ≤ 2500ms
 *   D2 CLS ≤ 0.1
 *   D3 FCP ≤ 1800ms
 *   D4 TBT ≤ 200ms
 *   D6 Performance score ≥ 90
 *
 * D5 (INP) is asserted via Playwright user flow elsewhere.
 * D7 (bundle size) is asserted via `next build` output post-build.
 * D8 (regression vs baseline) compares to baselines/m2-lighthouse.json
 *    if present; otherwise warns + skips.
 *
 * Exits non-zero on any MUST-PASS dim failure.
 */
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "baselines/m2-lighthouse.json");

const url = process.argv[2] ?? "http://127.0.0.1:3100/";
const isProd = !url.includes("localhost") && !url.includes("127.0.0.1");

const THRESHOLDS = {
  // ms / score units
  largestContentfulPaint: 2500, // D1
  cumulativeLayoutShift: 0.1, // D2
  firstContentfulPaint: 1800, // D3
  totalBlockingTime: 200, // D4
  perfScore: 0.9, // D6 (Lighthouse 0-1 scale)
};

async function main() {
  console.log(`[lighthouse-m5] target: ${url}`);
  console.log(
    `[lighthouse-m5] mode: ${isProd ? "STRICT (rubric)" : "SMOKE (localhost)"}`,
  );

  const chrome = await launch({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
  });

  let runnerResult;
  try {
    runnerResult = await lighthouse(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      formFactor: "mobile",
      throttling: {
        // Lighthouse "Slow 4G" simulation defaults
        rttMs: 150,
        throughputKbps: 1638.4,
        cpuSlowdownMultiplier: 4,
      },
      screenEmulation: {
        mobile: true,
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        disabled: false,
      },
    });
  } finally {
    await chrome.kill();
  }

  if (!runnerResult) {
    console.error("[lighthouse-m5] FATAL: no result returned");
    process.exit(2);
  }

  const lhr = runnerResult.lhr;
  const audits = lhr.audits;
  const metrics = {
    lcp: audits["largest-contentful-paint"]?.numericValue ?? NaN,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? NaN,
    fcp: audits["first-contentful-paint"]?.numericValue ?? NaN,
    tbt: audits["total-blocking-time"]?.numericValue ?? NaN,
    speedIndex: audits["speed-index"]?.numericValue ?? NaN,
    perfScore: lhr.categories.performance?.score ?? 0,
  };

  console.log("\n[lighthouse-m5] results:");
  console.log(`  D1 LCP                       ${fmt(metrics.lcp)}ms`);
  console.log(`  D2 CLS                       ${metrics.cls.toFixed(3)}`);
  console.log(`  D3 FCP                       ${fmt(metrics.fcp)}ms`);
  console.log(`  D4 TBT                       ${fmt(metrics.tbt)}ms`);
  console.log(`  D6 Performance score         ${(metrics.perfScore * 100).toFixed(0)}/100`);

  // Always write a snapshot for regression tracking.
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  const snapshotPath = isProd
    ? join(REPO_ROOT, "baselines/m5-lighthouse.json")
    : join(REPO_ROOT, "baselines/m5-lighthouse-local.json");
  writeFileSync(snapshotPath, JSON.stringify(metrics, null, 2));
  console.log(`\n[lighthouse-m5] snapshot: ${snapshotPath}`);

  // D8: compare to M2 baseline if present.
  if (existsSync(BASELINE_PATH)) {
    try {
      const base = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      console.log("\n[lighthouse-m5] D8 regression vs M2 baseline:");
      console.log(`  LCP   ${fmt(base.lcp)} → ${fmt(metrics.lcp)}`);
      console.log(`  CLS   ${base.cls.toFixed(3)} → ${metrics.cls.toFixed(3)}`);
      console.log(`  TBT   ${fmt(base.tbt)} → ${fmt(metrics.tbt)}`);
    } catch (e) {
      console.warn("[lighthouse-m5] D8: baseline parse failed:", e.message);
    }
  } else {
    console.log("\n[lighthouse-m5] D8: no M2 baseline at", BASELINE_PATH);
    console.log("  (run on M2 commit to seed; treating as informational only)");
  }

  // Hard-gate only when run against a production URL. Localhost = smoke.
  const failures = [];
  if (metrics.lcp > THRESHOLDS.largestContentfulPaint)
    failures.push(`D1 LCP ${fmt(metrics.lcp)} > ${THRESHOLDS.largestContentfulPaint}`);
  if (metrics.cls > THRESHOLDS.cumulativeLayoutShift)
    failures.push(`D2 CLS ${metrics.cls.toFixed(3)} > ${THRESHOLDS.cumulativeLayoutShift}`);
  if (metrics.fcp > THRESHOLDS.firstContentfulPaint)
    failures.push(`D3 FCP ${fmt(metrics.fcp)} > ${THRESHOLDS.firstContentfulPaint}`);
  if (metrics.tbt > THRESHOLDS.totalBlockingTime)
    failures.push(`D4 TBT ${fmt(metrics.tbt)} > ${THRESHOLDS.totalBlockingTime}`);
  if (metrics.perfScore < THRESHOLDS.perfScore)
    failures.push(`D6 Perf score ${(metrics.perfScore * 100).toFixed(0)} < 90`);

  if (failures.length > 0) {
    console.error("\n[lighthouse-m5] FAILURES:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    if (isProd) {
      process.exit(1);
    } else {
      console.warn(
        "[lighthouse-m5] smoke mode — not exiting non-zero, but address before prod run",
      );
      process.exit(0);
    }
  }

  console.log("\n[lighthouse-m5] ✓ all MUST-PASS dims clear");
}

function fmt(ms) {
  return Number.isFinite(ms) ? Math.round(ms).toString() : "n/a";
}

main().catch((e) => {
  console.error("[lighthouse-m5] FATAL:", e);
  process.exit(2);
});
