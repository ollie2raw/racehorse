# Match Board — Phase 0 Sign-off

**Date:** 2026-05-25  
**Plan:** [`match-board-greenfield-masterplan.md`](./match-board-greenfield-masterplan.md)  
**Status:** Phase 0 complete — ready for your **“Proceed to Phase 1”** (or revision notes).

---

## 1. v1 scope lock

| Decision | Value |
|----------|--------|
| Primary route | `#/daily-fritz` → `BotMatchScreen` `mode="daily-fritz"` |
| Tier accent | `elite` / gold Fritz (`#c8a020`, brass trim) |
| Secondary v1 | Play vs Fritz bot (`mode="bot"`) — same shell, same tokens |
| Out of scope v1 | Learn (`InGameBoardShell`), Ghost, Multiplayer, Daily Puzzle |
| Region A (app chrome) | **Omitted** — in boardmock1 only; match uses existing app nav, not `MatchBoardShell` |
| Layout authority | `docs/design-references/boardmock1.png` (only board mock) |
| Color authority | Homepage + `AGENTS.md` + Play vs Fritz panels (mock cyan = placement only) |

---

## 2. Annotated target regions

Open [`docs/design-references/boardmock1-annotated.html`](./design-references/boardmock1-annotated.html) in a browser for numbered overlays on **boardmock1.png**.

**Removed mocks:** `match-board-target.png`, `match-board-old.png`, `board-arena-v2-mock*` — do not use.

### Region map (target mock → greenfield contract)

| ID | Target mock label | Greenfield component | Notes |
|----|-------------------|----------------------|-------|
| **B** | HUD: Fritz **left** · hex turn **center** · You **right** | `MatchHudBar` + cards + `MatchTurnBadge` | Opponent rack slots beside Fritz |
| **C** | Race peg track | `MatchRaceStrip` → `ScoreBoard` `compact` | **Not drawn in mock** — keep per AGENTS.md between B and D |
| **D** | Game arena | `MatchArena` | Largest region; inset mat + board |
| **D1** | Play surface / grid | `MatchArenaMat` | Mat art only; board transparent |
| **D2** | Chain + tiles | `MatchArenaBoardSlot` → `Board` | Engine unchanged |
| **D3** | Meta chips | `MatchArenaMeta` | Mock: “14 TILES LEFT” + “0 OPEN ENDS” right stack |
| **D4** | Arena utilities | `MatchArenaControls` | Zoom bottom-left; mute / fullscreen / leave bottom-right (current behavior) |
| **E** | Player station | `MatchPlayerStation` | Hand + actions as one bottom block |
| **E1** | Hand below arena | `MatchHandDock` | Mock places hand **below** arena — matches wireframe |
| **E2** | Action toolbar | `MatchActionDock` | **Not in boardmock1** — optional v2; v1 uses implicit play + D4 utilities |

### Current vs target (baseline reject)

Baseline screenshot: [`docs/design-references/match-board-current.png`](./design-references/match-board-current.png) (2026-05-25).

| Region | Target | Current (`match-scene` path) | Gap |
|--------|--------|------------------------------|-----|
| A | Logo + rating + friends + profile | None in match shell | Add chrome or align app nav |
| B | Fritz left · hex turn · You right | Flat score chips | Pods, avatar, rack, hex hero |
| C | *(product)* peg track | Missing inline | **Critical** (AGENTS signature) |
| D | Glowing inset arena | Partial | Frame energy, grid, watermark |
| D3 | Tiles left + open ends stack | OPEN + boneyard | Label parity |
| E1 | Hand below arena | Hand below (OK) | Tray styling |
| E2 | — | No mock dock | Not required for v1 |

---

## 3. Wireframe proportions (Phase 1 implementation)

**Canonical wireframe:** [`docs/design-references/match-board-wireframe.html`](./design-references/match-board-wireframe.html)

Locked **viewport** split (of match shell only, 100% minus `.app` padding if any):

| Region | CSS variable | Height | Purpose |
|--------|--------------|--------|---------|
| **B** | `--mb-hud` | **13%** | Fritz left · turn center · You right |
| **C** | `--mb-race` | **6%** | Peg track (product; not in mock) |
| **D** | `--mb-arena` | **flex 1** (~52%) | Arena + inset mat |
| **E1** | `--mb-hand` | **20%** | Hand dock below arena |

**Inside D (arena):**

| Sub | Placement |
|-----|-----------|
| D1 mat | `inset: 8px` from arena border |
| D3 meta | `top: 12px; right: 12px` inside mat |
| D4 zoom | `bottom: 12px; left: 12px` |
| D4 utilities | `bottom: 12px; right: 12px` |

**Tolerance:** ±5% by eye vs target PNG when overlaid in browser devtools.

**Hand placement:** **boardmock1** places E1 **below** the arena — wireframe matches mock. No E2 action bar in mock; defer `MatchActionDock` unless product requests it.

---

## 4. Reject list (do not repeat)

From failed `match-scene` CSS passes and user feedback:

- Stacked gradients + pseudo-element rims + SVG overlay images on the same mat
- Double dot-grid layers at high opacity
- Decorative hand-dock tick strips (`repeating-linear-gradient` squares)
- Hex / trapezoid `clip-path` on HUD and turn pill
- Broken `<img>` rim assets stretched with `object-fit: fill`
- Olive/muddy mat gradients unrelated to navy shell
- “Three equal SaaS cards” HUD with no race strip
- Pouring coach/debug/toast into `boardStageInner` without region ownership
- Extending `matchScene.css` or `matchSkinPvf.css`

---

## 5. Portaled / floating overlays (not in shell layout)

These stay **outside** `MatchBoardShell` flex tree — portaled to `document.body` or fixed on screen root.

| Overlay | Component / class | Trigger | z-index notes |
|---------|-------------------|---------|---------------|
| Score track modal | `ScoreTrackOverlay` `.score-track-overlay` | Tap score HUD | Above match; excluded from flex child stack |
| Hand over | `HandOverModal` via `GameOverlayPortal` | Hand ends | Portal |
| Game over | `GameOverModal` | Match ends | Portal |
| Daily Fritz set | `.daily-fritz-set-overlay` | Between games in set | Portal |
| Daily Fritz final | `DailyFritzFinalResultOverlay` | Run complete | Portal |
| Leave confirm | `LeaveGameModal` | Leave control | Modal |
| Flying tile | `.flying-tile-overlay` | Draw animation | Portal; `GameOverlayPortal` |
| Score toast | inline in `boardStageInner` today | Points scored | **Move to shell overlay layer in Phase 3** |
| Rotate device | `RotateOverlay` | Portrait guard | Screen root sibling |
| Ghost played tile | `.ghost-played-overlay` | Ghost mode | Inside board today → ghost-only overlay slot |
| Coach panel | `CoachPanel` | Guided (not DF v1) | Not on daily-fritz path |
| Guided coach modal | `.learn-guided-coach-modal` | Learn | Learn only |
| Debug HUD | fixed `position:fixed` blocks | `showDebug` | Admin only |
| Game reviewer | `GameReviewer` | Analyzer | Modal |
| App confetti | canvas in `App.tsx` | MP game over | N/A for Fritz |

**Shell-level overlay slot (Phase 3):** Add `MatchBoardOverlays` sibling for score toast, ghost tile, optional coach — **not** inside `MatchArenaBoardSlot`.

---

## 6. Action dock inventory (Phase 4 input)

### boardmock1.png

No bottom action toolbar. Player actions: tap tiles; draw/pass via engine; leave/home/mute/fullscreen in D4.

### Current Daily Fritz behavior

| Player action | UI today |
|---------------|----------|
| Play tile | Tap hand tile → board placement |
| Draw | **Automatic** draw sequence when no legal play (no DRAW button) |
| Pass | Engine / sequence (no PASS button) |
| Blocked hand | Hand-over flow |
| Leave | Home icon in arena utilities |
| Mute / fullscreen | Arena utilities |
| Score track detail | Tap score → `ScoreTrackOverlay` |

### Phase 4 recommendation

**Skip `MatchActionDock` for v1** — not in boardmock1. Utilities in D4 + implicit play. Revisit only if product adds explicit DRAW/HINT UI.

---

## 7. `data-ui` hook registry (Phase 1+)

| Hook | Region |
|------|--------|
| `match-board-shell` | Root |
| `match-hud-bar` | B |
| `match-player-card` | B (side=opponent\|you) |
| `match-turn-badge` | B |
| `match-race-strip` | C |
| `match-arena` | D |
| `match-arena-mat` | D1 |
| `match-arena-board-slot` | D2 |
| `match-arena-meta` | D3 |
| `match-arena-controls` | D4 |
| `match-player-station` | E |
| `match-hand-dock` | E1 |
| `match-action-dock` | E2 |

---

## 8. Phase 0 exit checklist

- [x] `boardmock1.png` installed; obsolete mocks deleted
- [x] Target annotated (`boardmock1-annotated.html`)
- [x] Current baseline saved → `match-board-current.png`
- [x] v1 mode locked (Daily Fritz + Fritz bot)
- [x] Grayscale wireframe HTML with % heights
- [x] Overlay inventory documented
- [x] **Phase 1** — gray `MatchBoardShell` behind `?board=v2` (2026-05-25)
- [x] **Phase 2** — live HUD + inline `ScoreBoard` on v2 path (2026-05-25)
- [ ] **Your sign-off:** Phase 2 — scores/turn/rack/track update in play, then “Proceed to Phase 3”

---

## 9. Next step

**Prompt for implementation:** `Execute Phase 1 of match-board-greenfield-masterplan.`

Phase 1 creates `client/src/match/board/` gray shell behind `?board=v2`, no gameplay styling, no `Board` mount yet.
