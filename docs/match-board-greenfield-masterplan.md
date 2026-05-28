# Match Board Greenfield Masterplan

**Status:** **SUPERSEDED** — do not execute further phases here. Use [`match-board-reset-plan.md`](./match-board-reset-plan.md) (comp-first restart).  
**Historical:** Phases 0–2 explored `client/src/match/board` + `?board=v2`; visual result was not approved.  
**Supersedes for execution:** Incremental CSS on `client/src/match/scene/*` (frozen).  
**Scope v1:** Daily Fritz + Play vs Fritz bot match (`BotMatchScreen`). Learn stays on legacy shell until v2.

---

## 0. Decision: why we reset

The current path tried to **restyle** an old composition:

- `BotMatchScreen` still owns ~8k lines including a fat `boardStageInner` blob (toasts, coach, debug, overlays) poured into a “slot.”
- `MatchScene` only models **3 bands** (HUD / arena / hand) while `docs/match-board-target.md` requires **8 regions** (top chrome, HUD, turn hero, **race score track**, arena, hand, **action dock**, meta chips).
- Visual work landed in `matchScene.css` as stacked gradients, pseudo-elements, and optional SVGs — **atmosphere without layout**.
- Legacy sheets (`walnut-live.css`, `botMatch.css`, `inGameBoardShell.css`, `matchSkinPvf.css`) still exist; isolation helped but did not remove the wrong tree.

**New rule:** No color, glow, grid, watermark, or rim work until **grayscale layout** matches the target composition in a side-by-side screenshot.

---

## 1. North star (one sentence)

The player sees **one continuous match stage** — homepage Racehorse identity, target-board **composition** (inset arena, integrated HUD, visible race track, hand dock, action dock) — with gameplay behavior unchanged.

### 1.1 Brand vs mock (non-negotiable)

| Source | Wins for |
|--------|----------|
| `docs/design-references/homepage-identity.png` + `AGENTS.md` | Colors, typography family, matte panels, Fritz gold `#c8a020`, navy shell |
| `docs/design-references/boardmock1.png` | **Layout, proportions, region placement, depth layering** |
| Play vs Fritz (`PlayVsFritz.tsx`, `_pvf-layout.css`) | Panel density, button weight, selected states |

**Mock cyan is layout reference only** — energy lines become brass/gold on Fritz; blue stays for Standard/Ghost tokens later.

### 1.2 Explicitly out of scope (v1)

- Rewriting `Board.tsx` placement math, pan/zoom, or bot engine.
- Multiplayer / Daily Puzzle / full Learn migration.
- Pixel-perfect sci-fi clone.
- Casino / brown felt / walnut visual direction.

### 1.3 Definition of done (v1)

- [ ] All **8 regions** exist in DOM with stable `data-ui` hooks (see §3).
- [ ] Grayscale wireframe matches target proportions (±5% by eye).
- [ ] Race score track is **in-layout** (not only modal overlay).
- [ ] Hand + action dock read as one bottom “player station.”
- [ ] `Board` renders in a single transparent slot; no nested board “cards.”
- [ ] Fritz path uses **one** layout stylesheet (+ tokens); no `!important` wars from old skins.
- [ ] `npm run build --prefix client` passes; match playable end-to-end.
- [ ] `docs/design-references/match-board-current.png` updated after sign-off.

---

## 2. Reference kit

| Asset | Path |
|-------|------|
| Target composition | `docs/design-references/boardmock1.png` |
| Region spec | `docs/match-board-target.md` |
| Identity | `docs/design-references/homepage-identity.png` |
| Panel canon | `client/src/bot/PlayVsFritz.tsx`, `client/src/styles/_pvf-layout.css` |
| Design rules | `docs/agent-skills/racehorse-design-source-of-truth.md` |
| Current (broken) | `docs/design-references/match-board-current.png` |

**Review ritual (every phase):** screenshot → overlay target PNG → list gaps **by region name** → implement **only that phase** → rebuild.

---

## 3. Target layout model (8 regions)

Vertical stack inside viewport-locked `.app` child (see `AGENTS.md` §6). Proportions are **initial wireframe targets**; tune in Phase 1 with your screenshots.

```
┌─────────────────────────────────────────────────────────────┐
│ B  MatchHudBar — Fritz left · turn center · You right       │  ~13%
│    (region A / app chrome omitted — app nav only)           │
├─────────────────────────────────────────────────────────────┤
│ C  MatchRaceStrip (peg track — product, not in mock)          │  ~6%
├─────────────────────────────────────────────────────────────┤
│ D  MatchArena (flex 1)                                      │  ~52%
│    ┌ inset playfield ─────────────────────────────────┐     │
│    │  D1 mat · D2 board · D3 meta · D4 utilities      │     │
│    └──────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────────┤
│ E1 MatchHandDock (tiles below arena — boardmock1)           │  ~20%
└─────────────────────────────────────────────────────────────┘
```

### 3.1 DOM contract (greenfield)

New root: **`MatchBoardShell`** (name TBD). Old `MatchScene` folder may be replaced or emptied — do not grow `matchScene.css`.

```tsx
<MatchBoardShell mode="daily-fritz" tier="elite">
  {/* A — app chrome omitted (boardmock1 only; use app nav) */}
  <MatchHudBar>                           {/* B */}
    <MatchPlayerCard side="opponent" />
    <MatchTurnBadge />
    <MatchPlayerCard side="you" />
  </MatchHudBar>
  <MatchRaceStrip />                      {/* C — wraps ScoreBoard compact */}
  <MatchArena>                            {/* D */}
    <MatchArenaMat />                     {/* D1 — structure only in Phase 2 */}
    <MatchArenaBoardSlot ref={...}>       {/* D2 */}
      <Board ... />
    </MatchArenaBoardSlot>
    <MatchArenaMeta>                      {/* D3 */}
      <OpenEndsChip />
      <BoneyardChip />
    </MatchArenaMeta>
    <MatchArenaControls>                  {/* D4 */}
      <BoardZoomCluster />
      <MatchUtilityCluster />             {/* sound, fullscreen, home */}
    </MatchArenaControls>
  </MatchArena>
  <MatchHandDock>{hand}</MatchHandDock>     {/* E1 — below arena per boardmock1 */}
  {/* E2 MatchActionDock — not in boardmock1; defer unless product requests */}
</MatchBoardShell>
```

**Depth budget:** `MatchBoardShell` → `board-canvas` ≤ **4** wrappers (slot + `board-container` + canvas is allowed).

**Overlay rule:** Flying tiles, score toasts, game-over, score-track **modal** may portal above shell; they must not be children of `boardStageInner` once Phase 4 lands.

---

## 4. Code architecture (strip apart)

### 4.1 New module (create fresh)

| Path | Responsibility |
|------|----------------|
| `client/src/match/board/` | All greenfield layout components |
| `client/src/match/board/MatchBoardShell.tsx` | Root flex column, mode tokens |
| `client/src/match/board/MatchHudBar.tsx` | Region B |
| `client/src/match/board/MatchPlayerCard.tsx` | Score + label + rack slot |
| `client/src/match/board/MatchTurnBadge.tsx` | Turn / game copy |
| `client/src/match/board/MatchRaceStrip.tsx` | Region C — hosts `ScoreBoard` |
| `client/src/match/board/MatchArena.tsx` | Region D shell |
| `client/src/match/board/MatchPlayerStation.tsx` | Regions E1 + E2 |
| `client/src/match/board/MatchActionDock.tsx` | Draw / pass / hint / chat buttons |
| `client/src/match/board/matchBoard.layout.css` | **Layout only** (flex, grid, sizes) |
| `client/src/match/board/matchBoard.theme.css` | **Phase 5+** — color, borders, type |
| `client/src/match/board/index.ts` | Barrel |

### 4.2 Thin adapter (shrink `BotMatchScreen`)

Extract presentation from `BotMatchScreen.tsx`:

| New hook / module | Holds |
|-------------------|--------|
| `useBotMatchController()` (existing logic stays in screen or `bot/useBotMatch.ts`) | State, handlers, match ref |
| `buildBotMatchViewModel(controller)` | Scores, turn label, open ends, boneyard count, flags |
| `BotMatchBoardView.tsx` | **Only** renders `MatchBoardShell` + slots |

**Delete from Fritz path (after cutover):**

- `boardStageInner` as a 200+ line JSX soup — split overlays into named siblings of shell.
- `InGameBoardShell` / `pvf-layout` / `nbl-stage` / `rh-match-skin-pvf` on Fritz.
- Default import of current `match/scene` for production Fritz (park behind `?board=v2` until Phase 6).

### 4.3 Keep unchanged (import only)

| Asset | Notes |
|-------|--------|
| `Board.tsx` | Transparent background; slot provides mat |
| `DominoTile.tsx` | Hand + board tiles |
| `botEngine` / move validation | No changes |
| `ScoreBoard.tsx` / `ScoreTrackOverlay.tsx` | Strip inline in C; modal overlay unchanged |
| `BoardOpenEndsPill`, `BoneyardCountPill` | Rewrap in Phase 3; restyle in Phase 5 |
| `TileRack` | Opponent rack in player card |

### 4.4 Park / retire (do not extend)

| Asset | Action |
|-------|--------|
| `client/src/match/scene/*` | Freeze at cutover; remove or archive after v1 |
| `client/src/match/matchSkinPvf.css` | Already deprecated — delete in Phase 6 |
| `matchScene.css` decorative layers | Do not port — rewrite in `matchBoard.theme.css` |
| Fritz styling in `walnut-live.css` | Already gated; delete dead rules in Phase 6 |

---

## 5. Phased execution (structure before skin)

**One phase per session.** No Phase N+1 until you approve screenshot for Phase N.

---

### Phase 0 — Lock spec & wireframe (no product code)

**Goal:** Shared layout truth.

**Tasks:**

1. Annotate `boardmock1.png` with regions A–E (see `boardmock1-annotated.html`).
2. Export current screenshot → `match-board-current.png` (baseline “reject”).
3. Agree v1 mode: **Daily Fritz** (`daily-fritz`, elite tier).
4. Write **grayscale wireframe** (Figma or HTML static page in `docs/design-references/match-board-wireframe.html`) with exact % heights for B/C/D/E.
5. List overlays that stay portaled (game over, flying tile, score-track modal).
6. Sign-off: “Proceed to Phase 1.”

**Exit:** Wireframe + annotated target; no debate during CSS phases.

**Prompt:** `Execute Phase 0 of match-board-greenfield-masterplan.`

---

### Phase 1 — Empty shell (layout CSS only)

**Goal:** All regions visible as labeled gray boxes; zero brand styling.

**Tasks:**

1. Create `client/src/match/board/*` per §4.1.
2. `matchBoard.layout.css` only: flex column, `min-height: 0`, `overflow: hidden`, region heights from wireframe.
3. Wire `BotMatchScreen` with `?board=v2` (or env flag) → `MatchBoardShell` with placeholder text in each region.
4. **Do not** mount `Board` yet.
5. Confirm viewport: no body scroll.

**Exit:** Screenshot matches wireframe proportions; DOM has all `data-ui` hooks from §3.1.

**Prompt:** `Execute Phase 1 of match-board-greenfield-masterplan.`

---

### Phase 2 — Race strip + HUD structure

**Goal:** Real data in B + C; still grayscale.

**Tasks:**

1. `MatchPlayerCard` — label, score, `onOpenScoreTrack` (opens existing modal).
2. `MatchTurnBadge` — game number + turn string from existing match state.
3. `MatchRaceStrip` — render `ScoreBoard` `compact` between HUD and arena.
4. Opponent `TileRack` in left card (reuse component).
5. Remove placeholder HUD from old `matchScene` path when flag on.

**Exit:** Race track visible during play; scores update; still no board/hand styling.

**Prompt:** `Execute Phase 2 of match-board-greenfield-masterplan.`

---

### Phase 3 — Arena + board slot

**Goal:** Game plays on mat; inset playfield edge visible in gray.

**Tasks:**

1. `MatchArenaMat` — single inset rectangle (1px border for debug).
2. Mount `Board` in `MatchArenaBoardSlot` only.
3. Move **board-adjacent** UI: zoom tray → `MatchArenaControls`; meta pills → `MatchArenaMeta`.
4. Strip `boardStageInner` down: board + strictly board-local overlays (placement highlights only).
5. Relocate coach/debug/toast overlays to shell-level siblings (named components).

**Exit:** Tiles play correctly; pan/zoom works; meta pills on arena interior top-right.

**Prompt:** `Execute Phase 3 of match-board-greenfield-masterplan.`

---

### Phase 4 — Player station (hand + actions)

**Goal:** Bottom of screen matches target **station** model.

**Tasks:**

1. `MatchHandDock` — hand row only; no decorative pseudo-elements.
2. `MatchActionDock` — migrate draw/pass/hint/chat (and Daily Fritz–specific actions) from scattered bot footer / PVF chips.
3. Wire handlers from controller; preserve disabled states and legality.
4. Delete gold slot rectangles / legacy hand chrome from `walnut-live` on v2 path.

**Exit:** Full match loop without using old hand/footer layout.

**Prompt:** `Execute Phase 4 of match-board-greenfield-masterplan.`

---

### Phase 5 — Visual system (theme pass)

**Goal:** Brand + target depth — **one** controlled pass.

**Tasks:**

1. Add `matchBoard.theme.css` with tokens from Play vs Fritz + Fritz gold mode map.
2. Arena: recessed mat, subtle dot field, brass rim, faint R (SVG or typography — pick one).
3. HUD cards: matte navy panels, brass trim on active turn.
4. Hand: ivory tiles, playable underline, dim unplayable.
5. Action dock: PVF button weights.
6. **No new regions** in this phase — theme only.

**Exit:** Side-by-side with target PNG passes “same composition, Racehorse colors.”

**Prompt:** `Execute Phase 5 of match-board-greenfield-masterplan.`

---

### Phase 6 — Cutover & demolition

**Goal:** v2 is default; legacy tree removed.

**Tasks:**

1. Remove `?board=v2` flag; Fritz default = `MatchBoardShell`.
2. Delete or archive `client/src/match/scene/` and `matchScene.css`.
3. Remove Fritz branches from `matchSkinPvf.css`, unused `InGameBoardShell` bot path.
4. Prune `walnut-live` / `botMatch` rules that only served old layout.
5. Update `match-board-current.png`, `LEGACY-ISOLATION.md`, and mark old `match-scene-masterplan.md` as **superseded**.
6. Full smoke: play, draw, pass, zoom, score track modal, game over, leave match.

**Exit:** v1 greenfield complete.

**Prompt:** `Execute Phase 6 of match-board-greenfield-masterplan.`

---

### Phase 7 — Other modes (optional v2)

One mode per session: Ghost (blue tokens), Standard Fritz hub, Learn hybrid, Multiplayer HUD variant, Daily Puzzle.

---

## 6. Quality gates (every phase)

| Gate | Question |
|------|----------|
| Structure | Does screenshot match wireframe for **this** phase’s regions? |
| Scope | Did we avoid color/texture before Phase 5? |
| Gameplay | Any change to scoring, draws, bot, validation? (Must be **no**.) |
| Depth | Is `board-canvas` depth ≤ 4? |
| CSS | Did we add rules only to `match/board/*.css`? |
| Legacy | Is old path still behind flag until Phase 6? |

---

## 7. Risk register

| Risk | Mitigation |
|------|------------|
| `BotMatchScreen` too coupled | Phase 1 flag + `BotMatchBoardView` adapter; no big-bang delete until Phase 6 |
| Score track too tall | Start `ScoreBoard` compact; tune in Phase 2 with screenshot |
| Action buttons scattered | Inventory all bot actions in Phase 0; single `MatchActionDock` API |
| Overlay z-index fights | Document z-index scale on shell root in Phase 1 |
| User wants mock 1:1 cyan | Reiterate §1.1; layout yes, color no |
| Another CSS-only spiral | Phase 5 blocked until Phases 1–4 signed off |

---

## 8. What we stop doing immediately

- Adding gradients, rims, watermarks, or hex clip-paths to `matchScene.css`.
- Treating `MatchScene` 3-band layout as “close enough” to the target mock.
- Styling `boardStageInner` children without moving them to named regions.
- Extending `match-scene-masterplan.md` Steps 9+ on the old tree.

---

## 9. How to start the next chat

Pick one:

1. **“Execute Phase 0”** — wireframe + annotation only.  
2. **“Execute Phase 1”** — gray boxes, all regions (after Phase 0 sign-off).  
3. **Revise masterplan** — if region list or proportions should change before code.

---

## 10. Relationship to old masterplan

| Document | Status |
|----------|--------|
| `docs/match-scene-masterplan.md` | Historical — scaffold proved insufficient |
| `docs/match-board-target.md` | Still canonical for **regions** and feel |
| **This doc** | Active execution plan for greenfield rebuild |
