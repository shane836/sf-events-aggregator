#!/usr/bin/env node
/**
 * Diagnose what's causing CLS + perf-score failures on a Lighthouse run.
 * Dumps the layout-shift-elements + render-blocking-resources audits.
 *
 * Usage: node scripts/lighthouse-cls-diagnose.mjs <url>
 */
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const url = process.argv[2] ?? "https://sf-events-aggregator-two.vercel.app/";

const chrome = await launch({
  chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
});

const result = await lighthouse(url, {
  port: chrome.port,
  output: "json",
  logLevel: "error",
  onlyCategories: ["performance"],
  formFactor: "mobile",
  throttling: {
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

await chrome.kill();

const lhr = result.lhr;
const cls = lhr.audits["layout-shift-elements"];
const blocking = lhr.audits["render-blocking-resources"];
const unusedJs = lhr.audits["unused-javascript"];
const lcpEl = lhr.audits["largest-contentful-paint-element"];

console.log("=== CLS Sources ===");
if (cls?.details?.items?.length) {
  for (const item of cls.details.items) {
    console.log(
      `  shift=${item.score?.toFixed(4)} node=${item.node?.snippet?.slice(0, 100) ?? "(no snippet)"}`,
    );
  }
} else {
  console.log("  (no items reported)");
}

console.log("\n=== Render-blocking resources ===");
if (blocking?.details?.items?.length) {
  for (const item of blocking.details.items) {
    console.log(`  ${item.totalBytes}b · wasted ${item.wastedMs}ms · ${item.url}`);
  }
} else {
  console.log("  (none)");
}

console.log("\n=== LCP element ===");
if (lcpEl?.details?.items?.length) {
  for (const item of lcpEl.details.items) {
    console.log(`  ${item.node?.snippet?.slice(0, 200) ?? "(no snippet)"}`);
  }
}

console.log("\n=== Unused JS (top 5) ===");
if (unusedJs?.details?.items?.length) {
  const items = unusedJs.details.items.slice(0, 5);
  for (const item of items) {
    console.log(
      `  ${item.totalBytes}b · unused ${item.wastedBytes}b (${item.wastedPercent?.toFixed(0)}%) · ${item.url}`,
    );
  }
}

console.log(`\nPerf score: ${(lhr.categories.performance.score * 100).toFixed(0)}`);
console.log(`LCP: ${Math.round(lhr.audits["largest-contentful-paint"].numericValue)}ms`);
console.log(`CLS: ${lhr.audits["cumulative-layout-shift"].numericValue.toFixed(3)}`);
console.log(`FCP: ${Math.round(lhr.audits["first-contentful-paint"].numericValue)}ms`);
console.log(`TBT: ${Math.round(lhr.audits["total-blocking-time"].numericValue)}ms`);
