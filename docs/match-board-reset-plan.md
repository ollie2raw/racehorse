# Match Board Reset Plan (canonical)

**Status:** Awaiting approval — do not implement until you sign off on §2 (kill list) and §5 (phases).  
**Supersedes for execution:** Incremental work on `match/scene/*`, `matchScene.css`, `matchSkinPvf.css`, and CSS-only passes on `BotMatchScreen` layout.  
**Does not replace:** `AGENTS.md`, `docs/agent-skills/racehorse-design-source-of-truth.md`, `docs/match-board-target.md`.

---

## 1. Why restart (one paragraph)

The match UI failed because **visual design, layout structure, and game logic lived in the same file and the same CSS stack** (`walnut-live` → `botMatch` → `matchSkinPvf` → `match-scene` → `match-board`), with no frame that was ever signed off pixel-by-pixel against `boardmock1.png`. A restart means: **one approved static comp → one React tree → one token file → gameplay plugged into slots** — then delete everything else for Fritz/Daily Fritz.

---

## 2. North star (non-negotiable)

| Source | Wins for |
|--------|----------|
| [`boardmock1.png`](./design-references/boardmock1.png) | **Layout, proportions, region placement, depth** |
| [`homepage-identity.png`](./design-references/homepage-identity.png) + Play vs Fritz panels | **Color, type, matte surfaces, button weight** |
| `AGENTS.md` | **Keep peg race track (region C)** even though mock omits it |
| Mock cyan / blue glow | **Never ship** — translate to Fritz gold `#c8a020` + obsidian shell |

**Out of scope for v1:** Rewriting `Board.tsx` placement math, bot engine, scoring rules, multiplayer, Learn migration.

**Explicitly not region A:** App nav / logo / account stay in existing app chrome.

---

## 3. What we keep (gameplay + atoms only)

These are **dependencies**, not layout owners:

| Asset | Role |
|-------|------|
| `Board.tsx` | Chain render + pan/zoom; transparent inside arena slot |
| `DominoTile.tsx` | Hand + board tiles |
| `botEngine` / move validation / draw-pass | Unchanged |
| `ScoreBoard.tsx` + score-track modal | Region C + tap-to-expand |
| `BoardOpenEndsPill`, `BoneyardCountPill` | Region D3 content (may restyle or replace later) |
| `TileRack` | Opponent rack in HUD |
| `BotMatchScreen` **state/handlers** | Stays until extracted to `useBotMatchController` |

---

## 4. Kill list (do not extend; delete on cutover)

### 4.1 Layout paths (Fritz / Daily Fritz / Ghost bot)

| Asset | Action |
|-------|--------|
| `client/src/match/scene/*` | **Delete** after Phase 6 cutover |
| `matchScene.css` | **Delete** with scene folder |
| `?board=v2` / `?board=legacy` / `useMatchBoardV2Flag.ts` | **Delete** — one path only |
| `MatchScene` branch in `BotMatchScreen.tsx` | **Remove** |
| `match-scene-active` / `match-board-v2-active` dual classes | **Replace** with single `match-board-active` |
| `InGameBoardShell` + `pvf-layout` / `nbl-stage` on Fritz | **Remove** from Fritz render |
| `rh-match-skin-pvf` on bot match screen | **Remove** class + stylesheet import |
| `client/src/match/matchSkinPvf.css` | **Delete** |
| `boardStageInner` JSX blob (toasts/coach/debug inside slot) | **Split** into named overlay siblings of shell |
| Fritz rules in `walnut-live.css` / `botMatch.css` for old HUD rails | **Delete** dead blocks in Phase 6 |
| `inGameBoardShell.css` on Fritz | **Stop importing** for Fritz |

### 4.2 Current greenfield mistakes (reset, not iterate)

| Asset | Action |
|-------|--------|
| `matchBoard.theme.css` (as-is) | **Discard** — re-derived from approved comp only |
| `matchBoard.layout.css` wireframe grays / `%` regions | **Replace** with comp-measured layout |
| Layering scene watermark CSS onto board mat | **Rebuilt** inside board module from comp |

### 4.3 Docs to treat as historical

| Doc | Action |
|-----|--------|
| `docs/match-scene-masterplan.md` | Archive pointer → this doc |
| `docs/match-board-greenfield-masterplan.md` | Archive pointer → this doc |
| Phases that say “theme before layout sign-off” | **Void** — comp-first is mandatory |

### 4.4 Keep but do not use for Fritz layout

| Asset | Action |
|-------|--------|
| `client/src/match/scene/` for Learn | **Keep** until Learn migrates (separate project) |
| `docs/design-references/board-arena-v2-mock/` | **Reference ideas only** (open-ends panel, right rail) — layout SSOT remains **boardmock1** unless you explicitly change §2 |

---

## 5. Target DOM (final tree)

Single root class: `.match-board` on screen + `data-mode` / `data-tier`.

```
MatchBoardShell
├── MatchHudBar                    (B)
│   ├── MatchPlayerCard opponent
│   ├── MatchTurnBadge
│   └── MatchPlayerCard you
├── MatchRaceStrip                 (C) → ScoreBoard compact
├── MatchArena                     (D)
│   └── MatchArenaMat            (D1)
│       ├── [grid, spotlight, watermark — presentational only]
│       ├── MatchArenaBoardSlot  (D2) → Board
│       ├── MatchArenaMeta       (D3) → open ends + boneyard
│       └── MatchArenaControls   (D4) → zoom + utilities
├── MatchHandDock                  (E1) → hand tray
└── [portals] score toast, coach, game over, score-track modal
```

**Depth rule:** From `MatchBoardShell` to `.board-canvas` ≤ 4 wrappers.  
**Overlay rule:** Nothing in `boardStageInner` except `Board` (+ board-local UI). Toasts/coach/debug are **siblings** of the shell or portals.

---

## 6. Stylesheet architecture (one system)

| File | Purpose |
|------|---------|
| `matchBoard.tokens.css` | CSS variables only (`--mb-gold`, surfaces, type scale, spacing) |
| `matchBoard.layout.css` | Flex/grid, region sizes from comp (fixed px / clamp, not blind `%`) |
| `matchBoard.theme.css` | Borders, shadows, gold energy, component skin — **imports tokens** |

**Import order:** tokens → layout → theme (in `MatchBoardShell.tsx` only).

**Forbidden:** Fritz match styling in `walnut-live.css`, `botMatch.css`, `matchSkinPvf.css`, or `matchScene.css`.

---

## 7. How professionals do this (our version)

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ boardmock1   │ ──► │ Static HTML/CSS │ ──► │ React shell only │ ──► │ Wire Board  │
│ + identity   │     │ comp (sign-off) │     │ (no game logic)  │     │ + hand + HUD│
└──────────────┘     └─────────────────┘     └──────────────────┘     └─────────────┘
                              │                        │                      │
                              ▼                        ▼                      ▼
                     Overlay screenshot          data-ui contract        Delete legacy
                     ±5% by region              stable hooks            paths (§4)
```

**Gate between every phase:** Full-viewport screenshot at 1440×900 (and one mobile width) overlaid on `boardmock1.png` — list gaps **by region name** only. No next phase until you approve.

---

## 8. Implementation order (one phase per PR/session)

### Phase 0 — Reset agreement (this doc)

- [ ] You approve kill list (§4) and DOM tree (§5).
- [ ] Update `docs/design-references/match-board-current.png` as “before reset” baseline.
- [ ] No product code changes except optional feature flag default **off** for broken v2 skin until Phase 1 comp exists.

**Deliverable:** Approved `match-board-reset-plan.md`.

---

### Phase 1 — Static comp (zero React layout risk)

**Goal:** A screenshot you would ship as UI, with fake scores/tiles, **no** `BotMatchScreen`.

| Task | Detail |
|------|--------|
| Comp | [`design-references/match-board-comp/`](./design-references/match-board-comp/) — `index.html` + tokens + CSS |
| Match mock | HUD, race strip, arena frame, meta stack, utilities, hand dock — **boardmock1 proportions** |
| Tokens | `match-board.tokens.css` → copy to client in Phase 2 |
| Fritz gold | `#c8a020` / shell `#060608` — no cyan, no walnut brown |
| Fake content | CSS domino placeholders; peg track with sample pegs |

**Gate:** Side-by-side overlay with `boardmock1.png` — you say “comp is approved.”

**Status:** **Built** — open `match-board-comp/index.html`, use overlay toggle. Awaiting your sign-off.

**Do not:** Touch `BotMatchScreen` layout until comp approved (`?board=v2` off by default).

---

### Phase 2 — React shell (structure only)

**Goal:** `MatchBoardShell` renders comp markup 1:1 with **empty** slots (no `Board`, gray placeholders OK).

| Task | Detail |
|------|--------|
| Rebuild `client/src/match/board/*` | Components match §5; delete old theme/layout content |
| CSS | Port comp → `tokens` + `layout` only (still no gold polish beyond comp) |
| Route | `#/daily-fritz?board=preview` or internal dev route — **not** production default |
| Region labels | `showRegionLabels` for dev only |

**Gate:** React screenshot matches Phase 1 comp.

---

### Phase 3 — Gameplay slots

**Goal:** Playable Daily Fritz on new shell only.

| Task | Detail |
|------|--------|
| `MatchArenaBoardSlot` | Mount `Board` only |
| `MatchArenaMeta` / `MatchArenaControls` | Wire existing pills + toolbar |
| `MatchHandDock` | Wire `handTray` |
| `MatchRaceStrip` | Wire `ScoreBoard` compact |
| `MatchHudBar` | Wire live scores, turn badge, `TileRack` |
| Extract | `BotMatchBoardView.tsx` — props in, shell out; shrink `BotMatchScreen` |

**Gate:** Full game playable; overlay still compared to boardmock1 by region.

---

### Phase 4 — Theme polish (from comp, not imagination)

**Goal:** `matchBoard.theme.css` = exact visual delta between Phase 2 grayscale and Phase 1 color comp.

| Task | Detail |
|------|--------|
| Arena | Grid, vignette, watermark, corner energy — **no new effects** not in comp |
| HUD / hand | Matte pods, gold active states, ivory tiles |
| Board tiles | On-mat shadows per `match-board-target.md` |
| Kill conflicts | Remove `walnut-live` / `botMatch` / PVF rules affecting `.match-board-active` |

**Gate:** You sign off “looks like a professional game stage.”

---

### Phase 5 — Overlays & cleanup

| Task | Detail |
|------|--------|
| Move score toast, coach, debug out of board slot | Siblings/portals |
| Default route | Daily Fritz uses new shell **without** query flag |
| Delete §4 kill list | Scene folder, flags, `matchSkinPvf.css`, dead CSS |
| Learn | Document still on `InGameBoardShell` until separate plan |

**Gate:** `npm run build --prefix client`; manual play test; update `match-board-current.png`.

---

### Phase 6 — Optional enhancements (after v1 ship)

Not part of “perfect v1” — only after Phase 5:

- Open ends **panel** (ideas from `board-arena-v2-mock/DESIGN.md`)
- Hex turn badge from mock (if comp updated)
- Ghost / Play vs Fritz tier tokens
- Learn migration to `MatchBoardShell`

---

## 9. BotMatchScreen refactor (required, ordered)

| Step | What |
|------|------|
| 1 | `buildBotMatchViewModel(state)` — scores, labels, flags, no JSX |
| 2 | `BotMatchBoardView({ vm, slots })` — only `MatchBoardShell` |
| 3 | `BotMatchOverlays` — toast, coach, modals |
| 4 | `BotMatchScreen` — hooks + engine + compose views |

**Rule:** No new JSX layout inside `BotMatchScreen` after step 2.

---

## 10. Review ritual (every phase)

1. `npm run build --prefix client`
2. Open `#/daily-fritz` (or preview route) at 1440×900
3. Screenshot → overlay `boardmock1.png` in Figma/Photoshop or annotated HTML
4. Write **max 8 bullets**, one per region (B, C, D, E1…)
5. Implement **only** those bullets in the next session

---

## 11. What “done” looks like (v1)

- [ ] One layout path for Fritz/Daily Fritz/Ghost bot
- [ ] No `match-scene`, no `match-board-v2` flag, no PVF skin on match
- [ ] Static comp approved and React matches it
- [ ] Playable end-to-end; peg track in layout
- [ ] No `!important` wars with walnut/botMatch for match screen
- [ ] `match-board-current.png` updated; you’d show it without apologizing

---

## 12. Your decision (required before code)

Reply with:

1. **Approve kill list?** (yes / yes but keep Learn on scene for now / changes: …)
2. **Layout SSOT:** boardmock1 only, or adopt board-arena-v2-mock right rail?
3. **Start Phase 1 comp** in-repo HTML, or you’ll supply Figma export?

Until (1) is **yes**, implementation stays frozen at Phase 0.
