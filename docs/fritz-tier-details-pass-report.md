# Fritz Tier Details Pass — Report

**Date:** 2026-06-01  
**Builds on:** `809f9ff` (Fritz difficulty product pass)  
**Scope:** Play vs Fritz UI/copy only — tier details modal

---

## What changed

“View tier details ›” on Play vs Fritz now opens a modal explaining all four Fritz tiers in plain language.

### Modal behavior

- Opens from the link below **Start Match**
- **Rendered via `GameOverlayPortal`** (`document.body`) so it is not clipped by `.pvf-root { overflow: hidden }`
- Closes via **✕**, **Got it**, backdrop click, or **Escape**
- Uses existing `Modal` + `GlassCard` primitives (premium dark glass pattern)
- Link converted from placeholder `<a href="#">` to accessible `<button type="button">`

### Copy added

**Intro**

> The numbers below (like ~600 or ~1800) are approximate strength labels so you can compare tiers. They are not calibrated human Elo ratings.

**Per tier**

| Tier | Role | Approx. | Body |
|------|------|---------|------|
| Rookie | Beginner | ~600 | Beginner-friendly. Fritz makes more human-like mistakes, so you can learn without constant pressure. |
| Standard | Balanced | ~1000 | Balanced play — the best starting point for most players. |
| Elite | Competitive | ~1800 | Competitive Fritz, in the same strength family as Daily Fritz Classic. |
| Master | Expert | ~2400 | Expert challenge with the strongest endgame and search behavior Fritz offers. |

**Daily Fritz note**

> Daily Fritz Classic uses Elite Fritz — today’s competitive daily challenge on that tier.

---

## What did not change

| Area | Status |
|------|--------|
| Fritz AI (`botHeuristics.ts`) | Unchanged |
| Daily Fritz | Unchanged |
| Skunk rules | Unchanged |
| Tournament bots | Unchanged |
| PVF default (Standard) / tier persistence | Unchanged |
| Architecture extraction WIP | Untouched |
| Casual Daily Fritz | Not started |

---

## Files changed

| File | Change |
|------|--------|
| `client/src/bot/fritzTierDetailsContent.ts` | **New** — tier copy source of truth |
| `client/src/bot/FritzTierDetailsModal.tsx` | **New** — modal component |
| `client/src/bot/FritzTierDetailsModal.css` | **New** — modal layout (readable 15px-ish body) |
| `client/src/bot/PlayVsFritz.tsx` | Wire modal open/close |
| `client/src/styles/_pvf-layout.css` | Button styling for tier-details trigger |

---

## Build result

| Check | Result |
|-------|--------|
| `npm run build --prefix client` | **Pass** |

---

## Manual QA checklist

- [ ] Fresh/cleared `racehorse_bot_fritz_tier` → Play vs Fritz defaults to **Standard**
- [ ] Select **Elite** or **Master**, reload → selection persists
- [ ] **View tier details ›** opens modal with all four tiers + approximate-rating disclaimer + Daily Fritz note
- [ ] Close via ✕, Got it, backdrop, and Escape — setup screen usable again
- [ ] Start Match still uses selected tier

---

## Stale dev server (2026-06-02)

If you still see **600/1000** as the main tier number and a dead **View tier details** link, you are almost certainly on an **old Vite process** still bound to port **5173**.

Runtime check (curl dev source):

| Port | PlayVsFritz source |
|------|-------------------|
| `5173` | OLD — `elo: 600`, `<a href="#" preventDefault>` |
| `5176` (fresh `npm run dev`) | NEW — `roleLabel`, `FritzTierDetailsModal` |

**Fix:** stop all zombie Vite servers, then start one client dev server:

```bash
# macOS — free ports 5173–5176
for p in 5173 5174 5175 5176; do lsof -ti tcp:$p | xargs kill -9 2>/dev/null; done
cd client && npm run dev
```

Open **http://localhost:5173** only after a single Vite instance owns that port.

`vite.config.ts` now sets `strictPort: true` so a second dev start fails loudly instead of silently using another port.

**How to tell you have the new UI:** Rookie card shows **Beginner** (large) and **Approx. strength ~600** (small), not **600** as the main label.

---

**What was broken:** Click handler and state were correct, but the modal rendered as a child of `.pvf-root`, which uses `overflow: hidden` and `isolation: isolate`. The `position: fixed` backdrop was clipped/hidden inside that shell — clicks appeared to do nothing.

**What changed:** `FritzTierDetailsModal` now wraps `Modal` in `GameOverlayPortal` so it mounts on `document.body`, matching in-game overlays.

---

- **Casual Daily Fritz** — `docs/casual-daily-fritz-implementation-plan.md`
- Optional: deep-link from Daily Fritz practice hint → Play vs Fritz with Standard pre-selected
