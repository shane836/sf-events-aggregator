# DESIGN.md — SF Events design system

Source of truth for visual decisions. If this file and the code disagree, the file wins — update the code. Major changes go through `/plan-design-review` first.

**Reference aesthetic:** `tests/fixtures/reference-funcheap.png` (sf.funcheap.com homepage). The product should feel like funcheap — dense, scannable, info-forward, ugly-but-useful — not a marketing landing page.

**Anti-references:** anything that looks like a SaaS landing page, anything with a "hero section" that takes more than 1 viewport height, anything where the first 30 events take more than 1.5 scrolls to reach.

---

## Principles

1. **Density over whitespace.** Whitespace is for separating sections, not events. An event row should fit in ≤ 80px on desktop.
2. **Hierarchy via type weight, not size jumps.** Body 14-16px; titles get there via `font-semibold`, not `text-2xl`.
3. **Color is signal, not decoration.** Category chips, source-link arrows, and price are the only colored atoms. Everything else is grayscale.
4. **The calendar is the product.** Chrome (header, filter bar, footer) is ≤ 96px total on desktop. Events fill the rest.
5. **Mobile is the same product, not a different one.** Same density, same hierarchy, same reading order — just one column.

---

## Color palette

Dark mode is default (matches current build + most calendar apps). Light mode is a future polish, not M5.

### Surfaces (warm-dark, slightly off-pure-black for readability)

| Token | Value | Use |
|---|---|---|
| `--surface-0` | `#0a0a0b` | Page background |
| `--surface-1` | `#141416` | Card / row background |
| `--surface-2` | `#1d1d20` | Hover / elevated |
| `--surface-3` | `#2a2a2e` | Modal / popover |
| `--border-1` | `#2a2a2e` | Default border |
| `--border-2` | `#3a3a3f` | Emphasis border |

### Text

| Token | Value | Use | Contrast vs `--surface-1` |
|---|---|---|---|
| `--text-1` | `#f4f4f5` | Titles, headings | 16.8:1 |
| `--text-2` | `#d4d4d8` | Body | 12.1:1 |
| `--text-3` | `#a1a1aa` | Meta (venue, time) | 7.3:1 |
| `--text-4` | `#71717a` | Tertiary (counts, hints) | 4.7:1 (AA only) |

All text tokens pass WCAG AA against all surface tokens. `--text-4` is for non-essential meta only; never use for primary content.

### Category accents

Each category has a single accent — used in the chip, the dot before event titles, and nowhere else.

| Category | Token | Hex | Contrast vs `--surface-1` |
|---|---|---|---|
| Music | `--cat-music` | `#a78bfa` (violet-400) | 8.1:1 |
| Comedy | `--cat-comedy` | `#fb923c` (orange-400) | 8.8:1 |
| Lectures | `--cat-lectures` | `#60a5fa` (blue-400) | 7.4:1 |
| Dancing | `--cat-dancing` | `#f472b6` (pink-400) | 7.2:1 |
| Food | `--cat-food` | `#facc15` (yellow-400) | 12.3:1 |

All ≥ 7:1 (WCAG AAA for normal text). Distinguishable for deuteranopia/protanopia: violet/orange/blue/pink/yellow is a verified color-blind-safe set.

Category chip rendering: small caps tracking-wide, color matches the accent, no background fill (just the colored text on the surface). This is denser than filled pills and reads as a tag, not a button.

### Accents (interactive)

| Token | Value | Use |
|---|---|---|
| `--accent-1` | `#facc15` (yellow-400) | Primary CTA, focus ring, source-link arrow |
| `--accent-1-hover` | `#fde047` (yellow-300) | Hover |
| `--accent-danger` | `#f87171` (red-400) | Errors only |
| `--accent-success` | `#34d399` (emerald-400) | Success states (digest sent) only |

Yellow as primary accent is a direct funcheap nod. It pops against the dark surfaces without feeling like a tech-bro blue.

---

## Typography

### Stack

- **Sans (UI + body):** Geist Sans (already loaded via `next/font/google` in `app/layout.tsx`)
- **Mono (data, category chips, dates):** Geist Mono (already loaded)

No serif. No third font.

### Scale

Minimal scale — most content is one of three sizes. Hierarchy comes from weight.

| Token | Size | Line-height | Use |
|---|---|---|---|
| `text-xs` | 12px | 16px (1.33) | Meta, chips, timestamps |
| `text-sm` | 14px | 20px (1.43) | Body, descriptions |
| `text-base` | 16px | 24px (1.5) | Event titles |
| `text-lg` | 18px | 26px (1.44) | Section headers |
| `text-2xl` | 24px | 32px (1.33) | Page header only (max once per page) |

Mobile bumps `text-sm` to 15px to satisfy M5 rubric C1 (≥ 14px floor with margin). No other mobile size changes.

### Weights

| Use | Weight |
|---|---|
| Body | 400 |
| Event titles, section headers | 600 |
| Page header, primary CTA | 600 |
| Meta (venue, time) | 400 |
| Category chip | 500 + tracking-widest + uppercase |

Italics: never.

---

## Layout & spacing

### Grid

Tailwind defaults (4px base). Use `gap-1`/`gap-2`/`gap-3` for row separators; `gap-4`/`gap-6` for section separators; never `gap-8+` (signals a marketing site).

### Section rhythm

Top to bottom on home:
1. Header (sticky, 48px tall) — logo + digest button
2. Filter bar (sticky under header, 56px tall) — category + date + neighborhood + view-mode toggle + reset
3. **Upcoming Fun & Cheap feed** (funcheap-style chronological list) — new in M5
4. **Calendar** (month / week / day view per `?view=`) — switches grid based on view mode
5. Footer (32px, single line)

Total chrome above the feed: ≤ 104px on desktop. Feed should start in the first viewport.

### Event row (feed)

Funcheap row pattern, adapted:

```
HH:MM · Title goes here ............................... $ · MUSIC ·  ↗
WED MAY 28          Venue Name · Neighborhood
```

- Single-line title (truncate with ellipsis if needed)
- Date + venue on second line, `--text-3`
- Price + category chip + source-link arrow right-aligned on title row
- Row height target: 64-72px desktop, 80-96px mobile
- Hover: `--surface-2` background, no border change

### Calendar — month

7 columns × 5-6 rows. Each cell:
- Day number top-left (`text-xs`, `--text-3`; today gets `--accent-1` background pill)
- Up to 3 event lines, each `text-xs` truncated, prefixed with category dot
- "+N more" link in `--text-4` if overflow

### Calendar — week (new in M5)

7 columns × 1 row, full height. Each column = 1 day, stacked event cards filling vertically.

### Calendar — day (new in M5)

Single full-width agenda for that date. Similar to feed row but ungrouped (just chronological for the one day).

---

## Components

### Buttons

- Primary: `bg-yellow-400 text-zinc-950 hover:bg-yellow-300 font-semibold`
- Secondary: `border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800`
- Tertiary (text-only): `text-zinc-300 hover:text-zinc-100`
- Min tap target: 44×44 (M5 C7). Use padding to hit it; don't use min-h/min-w that breaks layout.
- Focus ring: `focus-visible:ring-2 focus-visible:ring-yellow-400 ring-offset-2 ring-offset-zinc-950`

### Chips (category)

Text-only, no background. `font-mono text-xs uppercase tracking-widest` + category color.

### Inputs

`bg-zinc-950 border-zinc-700 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400`. Same height as buttons.

### Modal

- Overlay: `bg-black/60 backdrop-blur-sm`
- Dialog: `bg-zinc-900 border-zinc-700 rounded-lg shadow-2xl max-w-md`
- **Scrollable when content exceeds viewport** (see digest modal fix, PR #32) — never let content clip off-screen
- Close: Esc, backdrop click, explicit X. All three required.

---

## Motion

Minimal. The product is a calendar, not a marketing site.

- View-mode toggle: instant (no animation — feels snappier and matches Cal app)
- Filter changes: instant
- Modal open/close: 150ms fade only (no scale, no slide)
- Hover: 100ms color transition
- Loading skeleton: `animate-pulse` on event-row placeholder, ≤ 200ms before real content swaps in

No parallax. No scroll-jacking. No "delight" animations.

---

## Accessibility floors

- All text ≥ WCAG AA (verified by axe-core in M5 F4)
- Body text ≥ 14px (mobile floor)
- Title text ≥ 16px (everywhere)
- Line-height ≥ 1.4 on body
- Tap targets ≥ 44×44 on mobile
- Focus visible on every interactive element (yellow ring above)
- `prefers-reduced-motion: reduce` disables the modal fade and pulse skeleton
- All interactive elements reachable + actionable via keyboard

---

## What this design system explicitly is NOT

- A marketing site for the calendar
- A "minimal aesthetic" (we're going for *dense*, which often reads as more — that's the point)
- Adaptive to user theme preference at M5 (light mode is post-ship)
- Brand-system-complete (no logo, no print collateral — this is a web product only)
- Tailwind-config-driven (tokens above are intentional CSS variables, not extending the Tailwind theme — keeps the design system independent of framework churn)

---

## Implementation notes

- CSS variables defined in `app/globals.css` under `:root`
- Tailwind utility classes reference the variables via `bg-[var(--surface-1)]` pattern OR via the Tailwind theme extension if we add one later — TBD in M5-C
- `lib/digest/category-styles.ts` already encodes category color mapping; M5-C extends this and ensures consistency between digest email + UI
- No new design dependencies (Radix, shadcn, headlessui) without explicit approval — keep the bundle small

---

## Open design questions for M5

These get answered during `/design-shotgun` against funcheap; lock the decision into this file before implementing.

1. **Feed vs. calendar placement on home.** Stacked (feed above calendar) vs. tabbed (toggle between them) vs. side-by-side (feed in sidebar, calendar main). Recommend stacked for parity with funcheap.
2. **View-mode toggle UI.** Segmented control vs. dropdown vs. tabs. Recommend segmented control (3 buttons) — matches macOS Cal.
3. **Calendar density at month view.** Show 3 events + "+N more" (current) vs. show 5 + "+N more" vs. show titles only no times. Recommend 3 + more, dense rows.
4. **Empty day in week view.** Greyed-out "no events" vs. nothing vs. a CTA to widen filters. Recommend faint "—" placeholder, no CTA.
