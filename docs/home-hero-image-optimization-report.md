# Home hero image optimization report

**Date:** 2026-06-01  
**Scope:** First-load home card art only (`newHOMEdailyfritz`, `homefinalpuzzle`). No UI redesign, layout, masks, gameplay, or server changes.

## Summary

| Metric | Before | After (WebP, q90) | Change |
|--------|--------|-------------------|--------|
| **Daily Fritz source** (`newHOMEdailyfritz`) | 1,665,612 B PNG | 70,800 B WebP | **−95.7%** |
| **Daily Puzzle source** (`homefinalpuzzle`) | 1,778,796 B PNG | 64,452 B WebP | **−96.4%** |
| **Combined home hero transfer** (modern browsers) | ~3,444 KB | ~135 KB | **~96% smaller** |

Encoding: `cwebp -q 90 -m 6 -mt` from the exact PNG files already referenced in CSS. PSNR at encode time: **49.8 dB** (Fritz), **47.9 dB** (Puzzle)—visually safe for masked, filtered card backgrounds.

PNG sources remain in the repo and build output for `image-set` fallback (Safari 16+, Chrome, Firefox, Edge all support `image-set` with WebP).

---

## Files changed

| File | Change |
|------|--------|
| `client/src/assets/home/newHOMEdailyfritz.webp` | **Added** (q90 WebP from `newHOMEdailyfritz.png`) |
| `client/src/assets/home/homefinalpuzzle.webp` | **Added** (q90 WebP from `homefinalpuzzle.png`) |
| `client/src/screens/RacehorseHomeArt.css` | `image-set(webp, png)` on `.home-card-art--fritz` and `--puzzle`; PNG line kept as fallback for older engines |
| `docs/home-hero-image-optimization-report.md` | This report |

**Unchanged:** `background-size`, `background-position`, `opacity`, `filter`, `mask-image`, `::after` overlays, card containers, and PNG filenames/paths for fallback.

---

## CSS pattern

```css
.home-card-art--fritz {
  background-image: url("../assets/home/newHOMEdailyfritz.png");
  background-image: image-set(
    url("../assets/home/newHOMEdailyfritz.webp") type("image/webp"),
    url("../assets/home/newHOMEdailyfritz.png") type("image/png")
  );
  /* background-size, position, mask, filter — unchanged */
}
```

Same pattern for `.home-card-art--puzzle` / `homefinalpuzzle`.

---

## Build validation

```bash
npm run build --prefix client
```

| Check | Result |
|-------|--------|
| Exit code | **0** |
| Unresolved asset warnings | **None** |
| WebP emitted to `dist/assets/` | `newHOMEdailyfritz-*.webp` (70.8 kB), `homefinalpuzzle-*.webp` (64.5 kB) |
| PNG still in dist (fallback) | Yes — not requested on WebP-capable browsers |

Chunk size warnings (>500 kB JS) unchanged and unrelated to this pass.

---

## Before / after sizes

### Source (`client/src/assets/home/`)

| Asset | Before | After (WebP q90) |
|-------|--------|------------------|
| `newHOMEdailyfritz.png` | 1,665,612 B | (kept for fallback) |
| `newHOMEdailyfritz.webp` | — | 70,800 B |
| `homefinalpuzzle.png` | 1,778,796 B | (kept for fallback) |
| `homefinalpuzzle.webp` | — | 64,452 B |

### Production `dist/assets/` (hashed names)

| Role | Before (PNG only) | After (browser picks WebP) |
|------|-------------------|----------------------------|
| Daily Fritz card art | ~1,665.6 kB | **~70.8 kB** |
| Daily Puzzle card art | ~1,778.8 kB | **~64.5 kB** |

---

## Reproduce WebP assets

From `client/src/assets/home/`:

```bash
cwebp -q 90 -m 6 -mt newHOMEdailyfritz.png -o newHOMEdailyfritz.webp
cwebp -q 90 -m 6 -mt homefinalpuzzle.png -o homefinalpuzzle.webp
```

---

## Manual QA checklist

Verify on **home** (`appMode === 'home'`) in production build or `npm run preview --prefix client`:

- [ ] **Daily Fritz card** — Same crop (`background-position: 64% 42%`), brass/gold treatment, left scrim, mask fade, Fritz visible on the right; no new banding or color shift vs prior PNG.
- [ ] **Daily Puzzle card** — Same crop (`56% center`), cyan/blue scrim and radial lift on `::after`, tile/board readable; mask edge unchanged.
- [ ] **Hover / focus** — Card hover brightness/shadow unchanged (container rules untouched).
- [ ] **Network panel** — On Chrome/Firefox/Safari 17+, home load requests **`.webp`** for both heroes, not multi‑MB PNGs.
- [ ] **Narrow viewport** — Cards still fit viewport-locked home shell; no layout shift.

---

## Notes

- **Orphan assets:** `daily-fritz-art.webp` and `daily-puzzle-art.webp` in the same folder are unused (not referenced in code). They are larger than the new encodings and can be removed in a separate cleanup pass after confirmation they are not needed for design reference.
- **Deploy weight:** PNGs still ship in `dist/` for fallback; a future pass could drop PNG from the build if analytics show negligible non-WebP traffic.
- **Single Player hub** hero PNGs were out of scope (already lazy-loaded per bundle audit).

---

## Definition of done

- [x] Home first-load image weight materially reduced (~96% on WebP-capable browsers)
- [x] Visual pipeline unchanged (same PNG sources, same CSS geometry/masks/filters)
- [x] Client build clean, no unresolved asset warnings
- [ ] Manual QA checkboxes above signed off in browser
