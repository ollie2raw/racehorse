# Match Scene Masterplan

**Status:** Active — execute one step at a time with human review between steps.  
**Primary mode (v1):** Daily Fritz / Play vs Fritz bot match (`BotMatchScreen`).  
**Anchors:** `docs/match-board-target.md`, `docs/design-references/boardmock1.png`, `docs/agent-skills/racehorse-design-source-of-truth.md`, Play vs Fritz (`PlayVsFritz.tsx` + `_pvf-layout.css`).

> **Superseded for new work:** use [`docs/match-board-greenfield-masterplan.md`](./match-board-greenfield-masterplan.md) + `boardmock1.png`.

---

## 0. Why this plan exists

Repeated CSS-only passes on the current tree produce a **software/dashboard** look because:

1. **Too many wrappers** — walnut match layout → PVF panel → playfield card → arena → NBL stage → board frame → board canvas (10+ nodes).
2. **Wrong composition model** — HUD, arena, and hand are **stacked panels**, not one scene with overlays.
3. **Repurposed components** — `wl-player-pill`, `bot-top-rail` grid, and NBL chrome were built for other screens.
4. **Board is engine-only** — `Board.tsx` has no arena concept; all “table” styling fights the engine from outside.
5. **Stylesheet war** — `walnut-live.css`, `botMatch.css`, `inGameBoardShell.css`, `noBrainerLab.css`, `matchSkinPvf.css` override each other.

**Rule (non-negotiable):** Per design source of truth — **no skin-only pass**. Each phase must change structure first, then type, then polish.

---

## 1. North star

### 1.1 One sentence

The player enters a **single immersive match arena** (like the target mock), with HUD and hand as **part of the same visual plane** — brand-aligned matte navy + brass Fritz, not cyan sci-fi and not SaaS cards.

### 1.2 Mock translation (brand-safe)

| Mock signal | Brand-aligned execution |
|-------------|-------------------------|
| Glowing geometric board frame | Brass rim + restrained blue inner line; optional SVG frame asset |
| Fine grid on play surface | Subtle masked grid on arena only (not full screen) |
| Large faint R watermark | **SVG** watermark, no baked PNG square |
| Hex / trapezoid “YOUR MOVE” | Dedicated `MatchTurnHero` markup + shape (not `border-radius` pill) |
| Opponent tile slots in HUD | `TileRack` or mini tiles in left HUD zone |
| Stacked “14 TILES LEFT” / “OPEN” | Vertical meta stack **on** arena (overlay), not floating dashboard widgets |
| Shaped hand tray | `MatchHandDock` geometry; tiles sit **on** dock, no gold slot rectangles |
| Corner lens-flare energy | Very subtle rim highlights only; no neon overload |

### 1.3 Explicitly not the goal

- Pixel-perfect cyan sci-fi clone of early mocks.
- Casino / brown felt / wood grain / crosshairs.
- Rewriting `Board.tsx` placement, pan/zoom, or bot logic.
- Big-bang migration of Learn / Multiplayer before Fritz path is signed off.

### 1.4 Success criteria (definition of done)

Use this checklist before calling v1 complete:

- [ ] **Single scene** — One root (`MatchScene`) with ≤ 5 meaningful layout nodes (see §3).
- [ ] **No walnut chrome** on Fritz path — `walnut-live` classes may remain on `.screen` for legacy hooks but **must not style** the scene tree.
- [ ] **Screenshot parity** — Side-by-side with `boardmock1.png`: arena inset, HUD density, hand dock, meta stack, turn hero.
- [ ] **Homepage family** — Still reads as Racehorse homepage extended into play (navy, brass, ivory type).
- [ ] **Readability** — Multi-color pips, solid tile divider, domino legibility unchanged.
- [ ] **Viewport locked** — No body scroll; fits `AGENTS.md` app shell.
- [ ] **Build** — `npm run build --prefix client` passes.
- [ ] **One stylesheet** — Scene visuals live in `matchScene.css` (+ tokens); no new `!important` wars in `matchSkinPvf.css`.

---

## 2. Reference kit (keep open during every step)

| Asset | Path |
|-------|------|
| Target composition | `docs/design-references/boardmock1.png` |
| Region spec | `docs/match-board-target.md` |
| Current WIP | `docs/design-references/match-board-current.png` (update after each phase) |
| Canonical panel UI | `client/src/bot/PlayVsFritz.tsx`, `client/src/styles/_pvf-layout.css` |
| Live code entry | `client/src/bot/BotMatchScreen.tsx` |

**Review ritual (every step):** screenshot → compare to target → note gaps by region → implement only that step → rebuild → update `match-board-current.png` when a phase completes.

---

## 3. Target DOM contract (v1)

Replace the integrated PVF wrapper stack with this tree. Names are stable `data-ui` hooks for CSS and tests.

```tsx
<MatchScene mode="daily-fritz" tier="elite">
  {/* Full viewport column — fills .app flex child */}
  <MatchHud>
    <MatchHudSide side="opponent" />   {/* Fritz + score + TileRack */}
    <MatchTurnHero />                 {/* Game N · YOUR MOVE */}
    <MatchHudSide side="you" />       {/* You + score */}
  </MatchHud>

  <MatchArena>
    <MatchArenaBackdrop />            {/* grid + vignette + optional SVG rim */}
    <MatchArenaBoardSlot>
      <Board ... />                   {/* transparent; engine unchanged */}
    </MatchArenaBoardSlot>
    <MatchArenaWatermark />
    <MatchArenaMeta />                {/* OPEN, boneyard — vertical stack */}
    <MatchArenaUtilities />           {/* zoom + sound + home */}
  </MatchArena>

  <MatchHandDock>
  {hand}
  </MatchHandDock>
</MatchScene>
```

**Max depth rule:** From `MatchScene` to `board-canvas` ≤ 4 wrappers (slot + container + canvas is OK).

### 3.1 Mode tokens (CSS variables on `MatchScene`)

```css
/* daily-fritz / elite */
--scene-bg: #04070c;
--scene-accent: #e7b64a;          /* brass */
--scene-accent-muted: rgba(231, 182, 74, 0.22);
--scene-energy: rgba(88, 166, 255, 0.12);  /* restrained blue */
--scene-rim: rgba(210, 170, 30, 0.38);
--scene-surface: #060b14;
--scene-text: #f2eee8;
--scene-text-muted: #8891a0;
```

Standard / Ghost bot modes use `--scene-accent: #3b82f6` (same structure, different token).

---

## 4. New files (create; do not grow old skin)

| File | Responsibility |
|------|----------------|
| `client/src/match/scene/MatchScene.tsx` | Root layout, mode prop, children slots |
| `client/src/match/scene/MatchHud.tsx` | 3-column HUD composition |
| `client/src/match/scene/MatchHudSide.tsx` | Opponent / you score card |
| `client/src/match/scene/MatchTurnHero.tsx` | Center turn module |
| `client/src/match/scene/MatchArena.tsx` | Arena shell + overlay slots |
| `client/src/match/scene/MatchHandDock.tsx` | Hand region |
| `client/src/match/scene/matchScene.css` | **Only** scene visual rules |
| `client/src/match/scene/index.ts` | Barrel export |
| `client/public/match/arena-watermark-r.svg` | Clean R (design/export) |
| `client/public/match/arena-rim-fritz.svg` | Optional; Phase 4 |

**Keep but stop extending for Fritz path:** `matchSkinPvf.css` (freeze → delete after migration).

**Keep unchanged:** `Board.tsx`, `DominoTile.tsx`, `botEngine`, pills’ **data** (can re-skin or wrap pills in Phase 5).

---

## 5. Phased execution plan

Work **one step per chat session** unless the step is trivial. Do not start step N+1 until step N is reviewed.

---

### Step 0 — Lock spec & baseline (no product code)

**Goal:** Shared truth before touching layout.

**Tasks:**
1. Export fresh screenshot → `docs/design-references/match-board-current.png`.
2. Annotate `boardmock1.png` with numbered regions (HUD / hero / arena / meta / hand / utilities).
3. Agree mode for v1: **Daily Fritz** (`bot-match-mode-daily-fritz`, tier elite/gold).
4. Record “reject list” from past attempts (grain, wood, crosshairs, monochrome pips, dashed dividers).

**Exit:** Written region list in this doc or a comment on PR; user says “go to Step 1.”

**Chat prompt:** “Execute Step 0 of match-scene-masterplan.”

---

### Step 1 — Scaffold `MatchScene` (structure only, zero polish)

**Goal:** New tree renders in app; looks rough but **correct shape**.

**Tasks:**
1. Create files in §4 with minimal markup and `data-ui` attributes.
2. Add `matchScene.css` with layout only: flex column, `flex: 1; min-height: 0; overflow: hidden`, region proportions (HUD ~12%, arena flex 1, hand ~18%).
3. Wire `BotMatchScreen` to render `MatchScene` for Fritz/bot matches (done; flag removed in Step 8).
4. Pass existing `board`, `hand`, HUD content into slots — **reuse** `botMatchTopHud` internals temporarily inside `MatchHud` if needed (shim), or placeholder boxes labeled OPPONENT / TURN / YOU.
5. **Do not** use `InGameBoardShell` integrated path for flag-on builds.
6. Neutralize styling: flat `#04070c` regions, 1px debug borders optional, no gradients yet.

**Exit:** Flag on → match loads, plays, no console errors; DOM depth ≤ contract; screenshot shows 3-band layout.

**Chat prompt:** “Execute Step 1 of match-scene-masterplan.”

---

### Step 2 — Arena shell (structure + depth, still no HUD polish)

**Goal:** Board lives inside **one inset arena**; reads as a table not a void.

**Tasks:**
1. Implement `MatchArena`, `MatchArenaBackdrop`, `MatchArenaBoardSlot`.
2. Board slot: `background: transparent`; all mat art on arena/backdrop.
3. Backdrop: recessed surface color, **masked grid** (CSS or SVG), inner vignette (subtle; document if radial used per `match-board-target.md`).
4. Arena border: brass rim + inner blue hairline per tokens.
5. Move watermark + meta + utilities into arena overlays (position absolute).
6. Remove `nbl-board-frame` / `nbl-stage` from Fritz path entirely.

**Exit:** Tiles cast shadows on visible mat; clear playfield edge; no nested rectangular “cards” around board.

**Chat prompt:** “Execute Step 2 of match-scene-masterplan.”

---

### Step 3 — `MatchHud` + `MatchTurnHero` (composition pass)

**Goal:** HUD matches mock **layout**, not walnut grid.

**Tasks:**
1. Build `MatchHud` 3-column grid; migrate score buttons from `botMatchTopHud` into `MatchHudSide`.
2. Build `MatchTurnHero` with real markup for game number + turn label (extract strings from existing logic).
3. Opponent row: Fritz label + `TileRack` (keep component).
4. Typography pass: turn hero `Barlow Condensed`, labels `Outfit`, sizes from `match-board-target.md`.
5. Remove `bot-top-rail` / `wl-player-pill` dashboard styling from scene tree — either override in `matchScene.css` or slim new presentational wrappers.

**Exit:** Turn moment is visually dominant; opponent/you secondary; no “three equal SaaS cards.”

**Chat prompt:** “Execute Step 3 of match-scene-masterplan.”

---

### Step 4 — `MatchHandDock` (integration pass)

**Goal:** Hand feels attached to arena, not a separate app footer.

**Tasks:**
1. Implement dock shape (trapezoid top edge via `clip-path` or SVG border).
2. Single brass hairline separation from arena; inset shadow **up** into mat.
3. Remove gold slot rectangles around each tile if present (hand tiles only — no rack cells).
4. Preserve selection underline / playable gold from existing interaction CSS (scoped under `.match-scene`).
5. Migrate `hand-container` styles that belong to dock vs tiles.

**Exit:** Hand reads as one dock; tiles float with physical shadow; selection states work.

**Chat prompt:** “Execute Step 4 of match-scene-masterplan.”

---

### Step 5 — Meta stack & utilities (polish HUD on arena)

**Goal:** OPEN / boneyard / zoom / sound match target chips and docks.

**Tasks:**
1. `MatchArenaMeta` — vertical stack, top-right; restyle `BoardOpenEndsPill` / `BoneyardCountPill` wrappers only.
2. `MatchArenaUtilities` — bottom-left zoom, bottom-right icons; one dark glass module style.
3. Score track overlay unchanged (modal); entry points stay on HUD sides.

**Exit:** Meta and utilities feel native to arena; not floating SaaS widgets.

**Chat prompt:** “Execute Step 5 of match-scene-masterplan.”

---

### Step 6 — Assets & signature details

**Goal:** Mock-level fidelity on static art.

**Tasks:**
1. Ship `arena-watermark-r.svg`; replace `brand_logo.png` on arena.
2. Optional `arena-rim-fritz.svg` if CSS rim insufficient.
3. Tune grid opacity, spotlight under chain, watermark scale per target PNG.
4. Board tile shadows on mat (board-tile filter scoped to scene).

**Exit:** Watermark has no dark box; rim reads intentional in screenshot compare.

**Chat prompt:** “Execute Step 6 of match-scene-masterplan.”

---

### Step 7 — Walnut / legacy isolation

**Goal:** No regressions from old CSS.

**Tasks:**
1. Add `.match-scene` root on `MatchScene`; scope all new CSS under it.
2. In `walnut-live.css` / `matchSkinPvf.css`: add top-level `:not(.match-scene-active)` or stop applying to Fritz screen when scene is on.
3. Document legacy path for Learn (still `InGameBoardShell` until Step 9).

**Exit:** With scene on, zero brown/walnut/dashboard overrides affecting tree.

**Chat prompt:** “Execute Step 7 of match-scene-masterplan.”

---

### Step 8 — Cutover & cleanup

**Goal:** Fritz path uses scene by default.

**Tasks:**
1. Remove feature flag; delete integrated PVF shell usage from `BotMatchScreen` (keep `InGameBoardShell` for learn).
2. Delete or archive dead rules in `matchSkinPvf.css` (or entire file if empty).
3. Update `docs/design-references/match-board-current.png`.
4. Full build + smoke test: play tile, draw, pass, zoom, score track, game over.

**Exit:** Production path = `MatchScene`; masterplan v1 complete.

**Chat prompt:** “Execute Step 8 of match-scene-masterplan.”

---

### Step 9 — Extend to other modes (optional v2)

| Mode | Change |
|------|--------|
| Play vs Fritz (non-daily) | Same scene, `mode="fritz"` tokens |
| Ghost | Blue accent token |
| Learn guided | Hybrid: scene arena + learn cockpit column |
| Multiplayer | `MatchScene` + multiplayer HUD variant |
| Daily Puzzle | Blue accent, same structure |

One mode per step after v1 sign-off.

---

## 6. Per-step quality gate (use every time)

1. **Structure** — Does DOM match §3?
2. **Identity** — Brass Fritz + navy, not cyan takeover?
3. **Target** — Region-by-region compare to `boardmock1.png`?
4. **Gameplay** — No logic changes; moves, scores, timers work?
5. **Build** — Client build passes?
6. **User review** — Oliver approves before next step?

---

## 7. Risk register

| Risk | Mitigation |
|------|------------|
| Learn mode breaks | Don’t touch learn layout until Step 9; flag during Steps 1–7 |
| Board resize / camera bugs | Don’t change `Board.tsx` sizing; slot is `position: relative; flex: 1` |
| CSS specificity wars | All scene rules under `.match-scene`; legacy excluded |
| Gradient policy conflict | Arena atmosphere only; panels stay matte per PVF standard |
| Scope creep | No score-track redesign in v1; polish existing overlay |
| Watermark asset delay | Temporary text “R” SVG inline until design exports |

---

## 8. How we work in this chat

1. You say: **“Execute Step N of match-scene-masterplan.”**
2. Agent implements **only** that step.
3. Agent reports: files changed, screenshot regions addressed, build result, **remaining gaps vs target**.
4. You review in browser; reply **“approved, next step”** or **“revise X.”**
5. Repeat.

**Do not** combine steps without explicit approval.

---

## 9. Current status

| Step | Status |
|------|--------|
| 0 — Lock spec & baseline | **Not started** |
| 1 — Scaffold MatchScene | **Done** |
| 2 — Arena shell | **Done** |
| 3 — MatchHud + TurnHero | **Done** |
| 4 — MatchHandDock | **Done** |
| 5 — Meta & utilities | **Done** |
| 6 — Assets | **Done** |
| 7 — Legacy isolation | **Done** |
| 8 — Cutover | **Done** — default Fritz path = `MatchScene` |
| 9 — Other modes | Not started |

---

## 10. Appendix — Current vs target wrapper count

**Current (integrated PVF, simplified):**  
`walnut-match-layout` → `rh-pvf-match-panel` → `__main` → `__play` → `rh-match-body` → `rh-match-playfield-card` → `rh-match-arena` → `wl-stage-shell` → `nbl-stage` → `nbl-board-frame` → `nbl-board-canvas` → `board-container` → `board-canvas` (**12**)

**Target:**  
`MatchScene` → `MatchArena` → `MatchArenaBoardSlot` → `board-container` → `board-canvas` (**5**)

That reduction is the main reason the new structure will finally read like the mock.
