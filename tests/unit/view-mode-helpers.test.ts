import { describe, expect, it } from "vitest";
import {
  advanceDate,
  parseFilters,
  todayInPT,
  viewToRange,
} from "@/lib/ui/filters";
import { viewLabel } from "@/lib/ui/dates";

describe("parseFilters — view + date", () => {
  it("defaults view to month and date to null", () => {
    const f = parseFilters({});
    expect(f.view).toBe("month");
    expect(f.date).toBe(null);
  });

  it("accepts valid view values", () => {
    expect(parseFilters({ view: "day" }).view).toBe("day");
    expect(parseFilters({ view: "week" }).view).toBe("week");
    expect(parseFilters({ view: "month" }).view).toBe("month");
  });

  it("falls back to month for invalid view", () => {
    expect(parseFilters({ view: "year" }).view).toBe("month");
    expect(parseFilters({ view: "" }).view).toBe("month");
  });

  it("accepts a well-formed YYYY-MM-DD date", () => {
    expect(parseFilters({ date: "2026-05-25" }).date).toBe("2026-05-25");
  });

  it("rejects malformed dates", () => {
    expect(parseFilters({ date: "2026-5-25" }).date).toBe(null);
    expect(parseFilters({ date: "tomorrow" }).date).toBe(null);
    expect(parseFilters({ date: "2026/05/25" }).date).toBe(null);
  });
});

describe("viewToRange", () => {
  it("day view: from = start, to = end of same date in PT (over-approximated)", () => {
    const r = viewToRange("day", "2026-05-25");
    expect(r.from < r.to).toBe(true);
    // The start should fall on or before the date in question; the end after.
    expect(r.from.startsWith("2026-05-25")).toBe(true);
    // end is +1 day at 07:59:59 UTC ≈ 23:59:59 PT
    expect(r.to.startsWith("2026-05-26")).toBe(true);
  });

  it("week view: Sun..Sat spanning 7 days regardless of anchor", () => {
    // 2026-05-25 is a Monday — Sunday is 2026-05-24, Saturday is 2026-05-30
    const r = viewToRange("week", "2026-05-25");
    expect(r.from.startsWith("2026-05-24")).toBe(true);
    expect(r.to.startsWith("2026-05-31")).toBe(true); // end of 05-30 PT ≈ 05-31 UTC
  });

  it("week view: anchoring on Sunday yields same Sunday as start", () => {
    // 2026-05-24 is a Sunday
    const r = viewToRange("week", "2026-05-24");
    expect(r.from.startsWith("2026-05-24")).toBe(true);
  });

  it("month view: 1st through last day of anchor's month", () => {
    const r = viewToRange("month", "2026-05-25");
    expect(r.from.startsWith("2026-05-01")).toBe(true);
    expect(r.to.startsWith("2026-06-01")).toBe(true); // end of 05-31 PT ≈ 06-01 UTC
  });

  it("month view: handles February correctly", () => {
    const r = viewToRange("month", "2026-02-15");
    expect(r.from.startsWith("2026-02-01")).toBe(true);
    expect(r.to.startsWith("2026-03-01")).toBe(true); // 2026 is not a leap year — last day = 28
  });
});

describe("advanceDate", () => {
  it("day: ±1 day", () => {
    expect(advanceDate("day", "2026-05-25", 1)).toBe("2026-05-26");
    expect(advanceDate("day", "2026-05-25", -1)).toBe("2026-05-24");
  });

  it("day: crosses month boundary", () => {
    expect(advanceDate("day", "2026-05-31", 1)).toBe("2026-06-01");
    expect(advanceDate("day", "2026-06-01", -1)).toBe("2026-05-31");
  });

  it("week: ±7 days", () => {
    expect(advanceDate("week", "2026-05-25", 1)).toBe("2026-06-01");
    expect(advanceDate("week", "2026-05-25", -1)).toBe("2026-05-18");
  });

  it("month: ±1 calendar month, same day-of-month", () => {
    expect(advanceDate("month", "2026-05-25", 1)).toBe("2026-06-25");
    expect(advanceDate("month", "2026-05-25", -1)).toBe("2026-04-25");
  });

  it("month: clamps to last day when target month is shorter", () => {
    expect(advanceDate("month", "2026-03-31", 1)).toBe("2026-04-30");
    expect(advanceDate("month", "2026-01-31", 1)).toBe("2026-02-28");
  });

  it("month: crosses year boundary", () => {
    expect(advanceDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(advanceDate("month", "2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("viewLabel", () => {
  it("month label", () => {
    expect(viewLabel("month", "2026-05-25")).toBe("May 2026");
  });

  it("day label includes weekday + month + day", () => {
    // 2026-05-25 is a Monday
    expect(viewLabel("day", "2026-05-25")).toBe("Monday, May 25");
  });

  it("week label anchors to the containing Sunday", () => {
    // 2026-05-25 is Monday, containing Sunday is 2026-05-24
    expect(viewLabel("week", "2026-05-25")).toBe("Week of May 24");
    expect(viewLabel("week", "2026-05-24")).toBe("Week of May 24");
    // 2026-05-30 (Sat) is still in the same week
    expect(viewLabel("week", "2026-05-30")).toBe("Week of May 24");
  });
});

describe("todayInPT", () => {
  it("returns a YYYY-MM-DD string", () => {
    const t = todayInPT();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats a known UTC date in PT", () => {
    // 2026-05-26T05:00:00Z → still 2026-05-25 in PT (UTC-7 in May)
    const t = todayInPT(new Date("2026-05-26T05:00:00Z"));
    expect(t).toBe("2026-05-25");
  });
});
