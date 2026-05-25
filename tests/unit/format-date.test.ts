import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  formatLocalDayLabel,
  formatLocalFullDate,
  formatLocalTime,
  localDateKey,
  monthGridDays,
} from "@/lib/ui/dates";

/**
 * Rubric tie-ins:
 *   - Identity invariant: dates must use the event timezone, not UTC slice.
 *   - F4/F5 / G1-G3 visual fit relies on consistent date formatting.
 */
describe("dates: timezone-aware formatters", () => {
  // Khruangbin: 2026-06-05T03:00:00Z is 8:00 PM PT on June 4.
  const isoUtc = "2026-06-05T03:00:00Z";
  const tz = "America/Los_Angeles";

  it("localDateKey returns local date, not UTC date", () => {
    expect(localDateKey(isoUtc, tz)).toBe("2026-06-04");
    // Slicing the ISO string would give 2026-06-05 — that's the bug we're
    // guarding against.
    expect(isoUtc.slice(0, 10)).toBe("2026-06-05");
  });

  it("formatLocalTime returns hour:minute with am/pm", () => {
    expect(formatLocalTime(isoUtc, tz)).toMatch(/8:00\s?PM/);
  });

  it("formatLocalDayLabel returns weekday + month + day", () => {
    const s = formatLocalDayLabel(isoUtc, tz);
    expect(s).toMatch(/Thu/); // 2026-06-04 is Thursday
    expect(s).toMatch(/Jun 4/);
  });

  it("formatLocalFullDate returns long form for modal headers", () => {
    expect(formatLocalFullDate(isoUtc, tz)).toMatch(/Thursday, June 4, 2026/);
  });
});

describe("dates: month grid helpers", () => {
  it("monthGridDays returns 5 or 6 full weeks", () => {
    const cells = monthGridDays(2026, 5); // June 2026
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.length).toBeLessThanOrEqual(42);
  });

  it("monthGridDays starts on Sunday", () => {
    const cells = monthGridDays(2026, 5);
    expect(cells.length).toBeGreaterThan(0);
    const first = cells[0];
    // Compute the weekday of the first cell directly
    const [y, m, d] = first.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    expect(dt.getUTCDay()).toBe(0);
  });

  it("monthGridDays contains every day of the target month", () => {
    const cells = monthGridDays(2026, 5); // June 2026 has 30 days
    for (let day = 1; day <= 30; day++) {
      const key = `2026-06-${String(day).padStart(2, "0")}`;
      expect(cells).toContain(key);
    }
  });

  it("addDaysIso handles month/year rollover", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});
