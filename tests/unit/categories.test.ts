import { describe, expect, it } from "vitest";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "@/lib/ui/categories";
import type { Category } from "@/lib/sources/types";

/**
 * Locked-decision smoke test for the category palette.
 *
 * If any of these change, M2 rubric assertions (and possibly D14/contrast
 * checks) need to be re-verified — palette is intentionally rigid.
 */
describe("CATEGORY_STYLES", () => {
  const CATEGORIES: Category[] = [
    "music",
    "comedy",
    "lectures",
    "dancing",
    "food",
  ];

  it("defines a style for every category", () => {
    for (const c of CATEGORIES) {
      expect(CATEGORY_STYLES[c]).toBeDefined();
    }
  });

  it("uses the locked Tailwind palette", () => {
    expect(CATEGORY_STYLES.music.dot).toBe("bg-sky-400");
    expect(CATEGORY_STYLES.comedy.dot).toBe("bg-orange-400");
    expect(CATEGORY_STYLES.lectures.dot).toBe("bg-violet-400");
    expect(CATEGORY_STYLES.dancing.dot).toBe("bg-red-500");
    expect(CATEGORY_STYLES.food.dot).toBe("bg-emerald-400");
  });

  it("provides chip, dot, text and label for every category", () => {
    for (const c of CATEGORIES) {
      const s = CATEGORY_STYLES[c];
      expect(s.dot).toMatch(/^bg-/);
      expect(s.chip).toMatch(/bg-/);
      expect(s.chip).toMatch(/text-/);
      expect(s.chip).toMatch(/ring-/);
      expect(s.text).toMatch(/^text-/);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("CATEGORY_ORDER contains every category exactly once", () => {
    const set = new Set(CATEGORY_ORDER);
    expect(set.size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(set.has(c)).toBe(true);
    }
  });
});
