# Match Board Target

## 1. Purpose

This document guides in-game board layout and visual work for Racehorse Dominoes.

Use with `AGENTS.md`, `docs/agent-skills/racehorse-design-source-of-truth.md`, and the `racehorse-ui-fidelity` skill.

## 2. Canonical mock (single source)

**Layout composition:** [`docs/design-references/boardmock1.png`](./design-references/boardmock1.png)

**Annotated review:** open [`docs/design-references/boardmock1-annotated.html`](./design-references/boardmock1-annotated.html) in a browser.

**Implementation baseline (current build, not a mock):** [`docs/design-references/match-board-current.png`](./design-references/match-board-current.png) — update after each greenfield phase.

**Brand identity:** [`docs/design-references/homepage-identity.png`](./design-references/homepage-identity.png)

Removed obsolete board mocks (`match-board-target.png`, `match-board-old.png`, `board-arena-v2-mock*`) — do not reference them.

### Conflict resolution

| If conflict between… | Winner for… |
|----------------------|-------------|
| `homepage-identity.png` vs `boardmock1.png` | Homepage wins **colors & brand**; mock wins **layout & composition** |
| `boardmock1.png` vs `AGENTS.md` race track | AGENTS wins — keep **inline peg track** (region C) even though mock does not draw it |

Mock uses cyan/blue glow → ship as **Fritz gold** (`#c8a020`) and navy shell, not cyan UI.

## 3. Target board feel

Premium digital strategy table: game-native, focused, immersive without casino or SaaS dashboard clutter.

Inherits homepage: midnight navy, restrained brass, ivory tiles, clean hierarchy.

## 4. Regions (from boardmock1)

| Region | Mock shows | Greenfield component |
|--------|------------|----------------------|
| **A** | Top bar in mock only | **Not built** — app-level nav handles logo / account |
| **B** | Fritz pod left · hex “YOUR MOVE” center · You pod right | `MatchHudBar`, `MatchPlayerCard`, `MatchTurnBadge`, `TileRack` |
| **C** | *(not in mock)* | `MatchRaceStrip` → `ScoreBoard` compact — **product requirement** |
| **D** | Framed arena, grid, R watermark | `MatchArena`, `MatchArenaMat`, `MatchArenaBoardSlot` |
| **D3** | Tiles left + open ends (right stack) | `MatchArenaMeta` |
| **D4** | Zoom + sound / fullscreen / home | `MatchArenaControls` |
| **E1** | Hand row below arena | `MatchHandDock` |
| **E2** | *(not in mock)* | Optional minimal dock later; no CHAT/DRAW bar in v1 unless product asks |

## 5. Visual requirements by region

### B — Match HUD

- Fritz: avatar, name, large score, opponent rack slots.
- Center: hex (or strong lozenge) turn badge — dominant on your turn.
- You: score card right-aligned.
- Matte navy panels, brass trim on active side; ivory type.

### C — Race score track

Signature peg track to match target score (e.g. 60). Compact bar between HUD and arena. Modal detail view may remain on score tap.

### D — Main arena

Recessed inset mat, subtle dot grid, faint R mark, brass frame energy (not cyan). Board slot transparent; tiles cast readable shadows.

### D3 — Meta chips

Right stack: boneyard / tiles left, open ends. Compact uppercase labels, gold values.

### D4 — Utilities

Bottom corners inside arena: zoom tray left; mute, fullscreen, leave/home right.

### E1 — Hand dock

Wide tray below arena; ivory tiles; playable gold underline; dim unplayable tiles.

## 6. What to preserve

Gameplay logic, peg scoring mechanic, domino readability, turn and action clarity.

## 7. What to avoid

Casino felt, western tropes, generic sci-fi HUD overload, brown table, SaaS card stacks, monochrome pips, decorative CSS layers without layout.

## 8. Greenfield pass plan

See [`docs/match-board-greenfield-masterplan.md`](./match-board-greenfield-masterplan.md) and [`docs/match-board-phase-0.md`](./match-board-phase-0.md).

- Phase 1+: layout proportions from [`match-board-wireframe.html`](./design-references/match-board-wireframe.html) (updated for boardmock1).
- Theme only after grayscale layout sign-off.
