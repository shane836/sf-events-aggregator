import { describe, expect, it } from "vitest";
import {
  fingerprint,
  formatLocalDate,
  formatLocalMinute,
  normalizeTitle,
  normalizeVenueName,
} from "@/lib/identity";

const PT = "America/Los_Angeles";

describe("identity / fingerprint invariants", () => {
  // B1 — minute-level resolution
  it("distinguishes same-night same-act 7pm and 9:30pm shows", () => {
    const at7 = fingerprint({
      title: "Hannibal Buress",
      venueName: "Punch Line SF",
      startTimeUtc: new Date("2026-06-08T02:00:00Z"), // 7pm PT
      timezone: PT,
    });
    const at930 = fingerprint({
      title: "Hannibal Buress",
      venueName: "Punch Line SF",
      startTimeUtc: new Date("2026-06-08T04:30:00Z"), // 9:30pm PT
      timezone: PT,
    });
    expect(at7).not.toBe(at930);
  });

  // B2 — UTC date drift
  it("8pm PT June 4 does NOT fingerprint as June 5", () => {
    const local = formatLocalDate(new Date("2026-06-05T03:00:00Z"), PT); // 8pm PT June 4
    expect(local).toBe("2026-06-04");
    expect(local).not.toBe("2026-06-05");
  });

  // B3 — diacritics
  it("collapses diacritics in titles (Café == Cafe)", () => {
    const a = fingerprint({
      title: "Café Music Night",
      venueName: "The Independent",
      startTimeUtc: new Date("2026-06-10T03:00:00Z"),
      timezone: PT,
    });
    const b = fingerprint({
      title: "Cafe Music Night",
      venueName: "The Independent",
      startTimeUtc: new Date("2026-06-10T03:00:00Z"),
      timezone: PT,
    });
    expect(a).toBe(b);
  });

  // B4 — punctuation preserved
  it("treats 'K.Flay' and 'K Flay' as different (no over-merge)", () => {
    const a = fingerprint({
      title: "K.Flay",
      venueName: "The Independent",
      startTimeUtc: new Date("2026-06-10T03:00:00Z"),
      timezone: PT,
    });
    const b = fingerprint({
      title: "K Flay",
      venueName: "The Independent",
      startTimeUtc: new Date("2026-06-10T03:00:00Z"),
      timezone: PT,
    });
    expect(a).not.toBe(b);
  });

  // B5 — cross-source collapse
  it("two adapters producing same title+venue+local-minute+tz yield identical fingerprints", () => {
    const ticketmasterRow = fingerprint({
      title: "Khruangbin",
      venueName: "The Fillmore",
      startTimeUtc: new Date("2026-06-05T03:00:00Z"),
      timezone: PT,
    });
    const scraperRow = fingerprint({
      title: "Khruangbin",
      venueName: "The Fillmore",
      startTimeUtc: new Date("2026-06-05T03:00:00Z"),
      timezone: PT,
    });
    expect(ticketmasterRow).toBe(scraperRow);
  });

  it("formatLocalMinute returns YYYY-MM-DDTHH:mm", () => {
    expect(formatLocalMinute(new Date("2026-06-08T02:00:00Z"), PT)).toBe(
      "2026-06-07T19:00",
    );
    expect(formatLocalMinute(new Date("2026-06-08T04:30:00Z"), PT)).toBe(
      "2026-06-07T21:30",
    );
  });

  it("normalizeTitle lowercases + collapses whitespace + strips diacritics", () => {
    expect(normalizeTitle("  Café  Du   Nord  ")).toBe("café du nord".replace(/é/, "e"));
  });

  it("normalizeVenueName behaves like normalizeTitle", () => {
    expect(normalizeVenueName("Café Du Nord")).toBe(normalizeTitle("Café Du Nord"));
  });
});
