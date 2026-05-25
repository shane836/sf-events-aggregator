/**
 * Unit tests for the digest email template.
 *
 * Confirms B3-B6 (source-link per event, price per event, valid HTML, title
 * + venue + date present) by rendering against a deterministic fixture set
 * — no DB, no Resend.
 */
import { render } from "@react-email/render";
import { HtmlValidate, formatterFactory } from "html-validate";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { DigestEmail } from "@/lib/digest/template";
import type { DigestEvent } from "@/lib/digest/types";

const FIXTURE_EVENTS: DigestEvent[] = [
  {
    id: "e1",
    title: "Hannibal Buress",
    category: "comedy",
    startTimeUtc: "2026-06-06T02:00:00.000Z", // 7pm PT Fri Jun 5
    endTimeUtc: null,
    timezone: "America/Los_Angeles",
    venue: { name: "Punch Line SF", neighborhood: "FiDi" },
    sourceUrl: "https://example.com/punchline/hannibal-7pm",
    verificationLevel: "official",
    pricing: { priceMin: 35, priceMax: 35, isFree: false },
    priceDisplay: "$35",
  },
  {
    id: "e2",
    title: "Free Lecture on Quantum Foam",
    category: "lectures",
    startTimeUtc: "2026-06-07T18:30:00.000Z",
    endTimeUtc: null,
    timezone: "America/Los_Angeles",
    venue: { name: "Stanford", neighborhood: null },
    sourceUrl: "https://events.stanford.edu/foo",
    verificationLevel: "trusted_partner",
    pricing: { priceMin: null, priceMax: null, isFree: true },
    priceDisplay: "Free",
  },
  {
    id: "e3",
    title: "Jazz at SFJAZZ",
    category: "music",
    startTimeUtc: "2026-06-08T03:00:00.000Z",
    endTimeUtc: null,
    timezone: "America/Los_Angeles",
    venue: { name: "SFJAZZ Center", neighborhood: "Hayes Valley" },
    sourceUrl: "https://www.sfjazz.org/foo",
    verificationLevel: "official",
    pricing: { priceMin: 25, priceMax: 75, isFree: false },
    priceDisplay: "$25–$75",
  },
];

describe("DigestEmail template — content invariants", () => {
  it("renders one anchor per event with href=sourceUrl (B3)", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: FIXTURE_EVENTS,
        weekOfLabel: "June 1",
      }),
    );
    for (const e of FIXTURE_EVENTS) {
      expect(html).toContain(`href="${e.sourceUrl}"`);
      expect(html).toContain(e.title);
    }
  });

  it("renders priceDisplay per event (B4)", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: FIXTURE_EVENTS,
        weekOfLabel: "June 1",
      }),
    );
    expect(html).toContain("$35");
    expect(html).toContain("Free");
    expect(html).toContain("$25");
    expect(html).toContain("$75");
  });

  it("renders venue and date per event (B6)", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: FIXTURE_EVENTS,
        weekOfLabel: "June 1",
      }),
    );
    expect(html).toContain("Punch Line SF");
    expect(html).toContain("FiDi");
    expect(html).toContain("SFJAZZ Center");
    expect(html).toContain("Stanford");
    // A formatted weekday should appear; Intl localization is stable in node.
    expect(html).toMatch(/Fri|Sat|Sun|Mon|Tue|Wed|Thu/);
  });

  it("renders empty-state copy when no events match (B2)", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: [],
        weekOfLabel: "June 1",
        selectedCategories: ["music"],
      }),
    );
    expect(html).toMatch(/No events match/i);
    // back-to-calendar link is present
    expect(html).toMatch(/href="https?:\/\//);
  });

  it("does NOT contain the word 'unsubscribe' (F3)", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: FIXTURE_EVENTS,
        weekOfLabel: "June 1",
      }),
    );
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("body bytes stay under 102KB at 50-event cap (B7, G2)", async () => {
    const fifty: DigestEvent[] = Array.from({ length: 50 }, (_, i) => ({
      ...FIXTURE_EVENTS[0],
      id: `e${i}`,
      title: `Event ${i} ${"x".repeat(40)}`,
      sourceUrl: `https://example.com/e${i}`,
    }));
    const html = await render(
      React.createElement(DigestEmail, {
        events: fifty,
        weekOfLabel: "June 1",
      }),
    );
    const bytes = Buffer.byteLength(html, "utf8");
    expect(bytes).toBeLessThan(102 * 1024);
  });
});

describe("DigestEmail template — html-validate (B5)", () => {
  // Note: react-email's `<Link>` wraps content in `<a>`; our template wraps
  // only the title text and never nests anchors, so the structural rules
  // below pass. We disable the unclosed-element and meta-rules that don't
  // apply to email-snippet HTML.
  // Email HTML is intentionally non-modern: table-based layout, deprecated
  // align/width/cellpadding/cellspacing attributes, self-closing void
  // elements — Outlook still wants all of it. react-email emits this on
  // purpose. We disable the rules that fire on these patterns and keep the
  // structural ones (anchor nesting, broken element tree, etc).
  const validator = new HtmlValidate({
    rules: {
      // Structural / correctness — keep on.
      "close-order": "error",
      "no-dup-attr": "error",
      "no-dup-id": "error",
      "no-self-closing": "off",
      // Email-HTML idioms — disable.
      "doctype-html": "off",
      "doctype-style": "off",
      "void-style": "off",
      "no-deprecated-attr": "off",
      "attr-case": "off",
      "element-required-content": "off",
      "element-required-attributes": "off",
      "no-inline-style": "off",
      "no-raw-characters": "off",
      "long-title": "off",
      "no-implicit-button-type": "off",
      // WCAG rules don't apply meaningfully to inlined-style email markup.
      "wcag/h30": "off",
      "wcag/h32": "off",
      "wcag/h36": "off",
      "wcag/h37": "off",
      "wcag/h63": "off",
      "wcag/h67": "off",
      "wcag/h71": "off",
    },
  });

  it("renders HTML with no html-validate errors", async () => {
    const html = await render(
      React.createElement(DigestEmail, {
        events: FIXTURE_EVENTS,
        weekOfLabel: "June 1",
      }),
    );
    const report = await validator.validateString(html);
    if (!report.valid) {
      const formatter = formatterFactory("stylish");
      // Print details to make CI failures actionable.
      console.error(formatter(report.results));
    }
    expect(report.valid).toBe(true);
  });
});
