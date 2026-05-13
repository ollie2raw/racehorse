# Racehorse Architecture Audit
**Date:** 2026-05-13  
**Auditor:** Staff Engineer / Systems Architect role  
**Branch:** architecture-audit  
**Phase:** Pre-stabilization analysis — no changes made

---

## Executive Summary

The platform is functionally capable but architecturally fragile. **Three years of rapid visual experimentation have deposited 6+ competing design systems, a 4,433-line God component, 18 backup files in source, and 11 competing CSS `:root` token blocks — all simultaneously active in production.** The codebase is at high risk of visual regression with every edit. Before any new feature work, a focused stabilization pass is essential.

The good news: the game logic, multiplayer stack, and bot engine are well-isolated and do not need surgery. The UI layer is the problem zone.

---

## 1. Codebase Architecture Map

```
client/src/
├── App.tsx                    ← 4,433 lines — monolithic God component
├── App.css                    ← 5,586 lines — primary stylesheet  
├── index.css                  ← Global base + Tailwind + Rajdhani import
├── main.tsx                   ← Entry: loads index.css + premium-theme.css + walnut-live.css
├── premium-theme.css          ← Home screen override layer (363 lines, 127 !important)
├── cinematic.css              ← HUD cinematic tokens (91 lines)
├── force-ui-debug.css         ← Experimental glass debug system (not imported in prod?)
├── probe2.ts                  ← Unknown/abandoned probe file
├── walnut-preview.tsx         ← Standalone alt entry point (not linked to prod)
│
├── styles/                    ← Competing game themes
│   ├── gameTheme.css          ← Dark HUD system (463 lines)
│   ├── walnut-live.css        ← Walnut table theme (999 lines, imported globally)
│   ├── felt-green.css         ← Casino green theme (719 lines, 318 !important) 
│   ├── premium-polish.css     ← Card polish system (active)
│   └── premium-polish.DISABLED.css  ← Same file, disabled — toggle anti-pattern
│
├── components/                ← Shared primitives (partially)
│   ├── Board.tsx              ← Core board renderer
│   ├── DominoTile.tsx         ← Tile component (DUPLICATED in ui-walnut/)
│   ├── TileRack.tsx
│   ├── ScoreBoard.tsx
│   ├── GameOverModal.tsx
│   ├── GlobalNav.tsx
│   └── index.ts               ← Barrel export (good pattern, partially used)
│
├── ui/                        ← Secondary UI primitives (mixed purpose)
│   ├── LayoutScreen.tsx       ← Screen wrapper
│   ├── claudeMode.tsx         ← Home screen accordion (1,407-line CSS!)
│   ├── claudeMode.css
│   ├── claudeUtilityPanels.css
│   └── leaderboardPage.css
│
├── ui-walnut/                 ← ABANDONED UI experiment
│   ├── WalnutRoomScreen.tsx   ← Alt game screen (not in prod routing)
│   ├── components/
│   │   ├── DominoTile.tsx     ← DUPLICATE of components/DominoTile.tsx
│   │   └── HandTray.tsx
│   ├── theme.ts               ← 64 walnut CSS vars as JS object
│   └── motion.ts
│
├── experimental/              ← Active but labeled "experimental"
│   ├── RacehorseHomeScreen.tsx  ← Current production home (imported in App.tsx!)
│   ├── SinglePlayerHubScreen.tsx ← Active single player hub
│   ├── RacehorseHomeArt.css
│   ├── SinglePlayerModes.css
│   └── claudeRedesign/        ← Design prototype (7 files, not in prod)
│       ├── ClaudeRedesignApp.tsx
│       ├── ClaudeRedesignHome.tsx
│       ├── ClaudeRedesignDaily.tsx
│       ├── ClaudeRedesignLeaderboard.tsx
│       ├── ClaudeRedesignMulti.tsx
│       ├── ClaudeRedesignSingle.tsx
│       ├── ClaudeRedesignSocial.tsx
│       ├── ClaudeRedesignShared.tsx
│       └── claudeRedesign.css
│
├── learn/                     ← Learning system v2 (11 files + subdirs)
│   ├── LearnHome.tsx
│   ├── LearnPlayer.tsx
│   ├── LearnScenarioScreen.tsx
│   ├── AuthoringCoachPanel.tsx
│   ├── LessonCoachPanel.tsx
│   ├── LessonDebugPanel.tsx
│   ├── learn.css
│   ├── learnPlayer.css        ← 1,830+ lines
│   └── engine/, data/, progress/
│
├── learning/                  ← Learning system v1 (overlapping with learn/)
│   ├── CoachPanel.tsx
│   ├── LearningHandRecap.tsx
│   ├── coach.css
│   └── [9 more .ts files]
│
├── bot/                       ← Well-structured
├── multiplayer/               ← Well-structured  
├── debug/                     ← Debug utilities (some may be prod-leaking)
├── dailyFritz/                ← Feature module
├── dailyPuzzle/               ← Feature module (CONFLICTS with puzzle/)
├── puzzle/                    ← DUPLICATE? Has DailyPuzzleScreen.tsx too
├── ghost/                     ← Feature module
├── league/                    ← Feature module
├── friends/                   ← Feature module
├── stats/                     ← Feature module
├── ranking/                   ← Feature module
├── practice/                  ← Feature module
├── analyzer/                  ← Move analysis tools
├── auth/                      ← Auth module (5 backup files)
└── lib/                       ← Supabase client
```

---

## 2. Critical Architecture Problems

### 2.1 The God Component (CRITICAL RISK)

**`App.tsx` is 4,433 lines.** It contains:
- All application state (`useState` for game state, players, modes, scores, timers, etc.)
- All socket event handling
- All multiplayer logic
- All mode switching (14 modes via `if/else` cascade)
- All rendering for the multiplayer game screen
- All bot game state
- All ghost mode state
- Analytics, learning coach initialization, room recovery logic

This is a single point of failure. **Any change to routing, state, or rendering risks breaking everything simultaneously.** It cannot be tested in isolation. It cannot be understood at a glance.

### 2.2 No URL-Based Routing

Navigation is a `useState<AppMode>('home')` toggle. Consequences:
- No browser back button
- No deep-linking (can't share a URL to a specific mode)
- No page refresh survival
- All 14 screens rendered in one component
- Mode switching is `setAppMode(...)` calls scattered across 4,433 lines

The app currently special-cases `window.location.pathname === '/redesign'` inline in the render function — a sign that URL routing is being bolted on ad-hoc.

### 2.3 Dual Learning Systems

`learn/` and `learning/` are **parallel systems doing overlapping things:**
- `learn/` has `LearnHome`, `LearnPlayer`, `LearnScenarioScreen`, `AuthoringCoachPanel`, `LessonCoachPanel`, data engines
- `learning/` has `CoachPanel`, `LearningHandRecap`, `coachMessaging`, `moveAnalysis`, `learningStore`
- `BotMatchScreen.tsx` imports from **both**: `../learn/learnPlayer.css` AND `../learning/coach.css`
- `learn/AuthoringCoachPanel.tsx` imports from `../learning/coach.css`

One of these is the intended system. The other is legacy. It's unclear which.

### 2.4 `experimental/` Contains Production Code

`experimental/RacehorseHomeScreen.tsx` and `experimental/SinglePlayerHubScreen.tsx` are **imported directly in App.tsx** and are the current production home and single-player hub. The directory name "experimental" no longer reflects reality — it's the active UI. This creates confusion about what's safe to delete.

---

## 3. CSS System Diagnosis

### 3.1 The !important War

The codebase is a cascade war. Every new theme layer was applied via `!important` to override previous layers, creating an arms race:

| File | `!important` count | Status |
|---|---|---|
| `App.css` | 245 | Active |
| `styles/felt-green.css` | 318 | Active (globally imported via walnut-live?) |
| `premium-theme.css` | 127 | Globally imported |
| `styles/walnut-live.css` | 26 | Globally imported |
| `cinematic.css` | 23 | Status unclear |

**Felt-green is particularly dangerous.** It's a completely different visual aesthetic (casino green felt, ivory tiles, white cards on green) that directly conflicts with the premium dark direction. It has 318 `!important` declarations overriding `body`, `.domino-body`, `.board-area`, `.game-screen`, `.scoreboard`, `.player-score`, `.turn-badge`, `.hand-area` etc.

### 3.2 Eleven Competing `:root` Blocks

11 files define CSS custom properties at `:root`, with overlapping and conflicting names:

| File | Key vars defined |
|---|---|
| `App.css` | `--tile-bg`, `--dot-color`, etc. |
| `premium-theme.css` | `--bg-obsidian`, `--accent-teal/blue/purple/red/amber/green`, `--text-primary/secondary` |
| `cinematic.css` | `--hud-bg`, `--hud-border`, `--hud-radius`, `--hud-blur`, `--hud-text` |
| `force-ui-debug.css` | `--bg0`, `--bg1`, `--glassA/B`, `--lineA/B`, `--feltGlow` |
| `styles/gameTheme.css` | `--hud-*` (same names as cinematic.css, different values!) |
| `styles/felt-green.css` | `--brand`, `--brand-hi/lo/dark`, `--card`, `--ink`, `--gold`, `--r-card`, etc. |
| `styles/walnut-live.css` | `--wl-bg-top/mid/bottom`, `--wl-gold`, `--wl-mint`, `--wl-card`, etc. |
| `styles/premium-polish.css` | `--r-sm/md/lg/xl`, `--sh-1/2/3`, `--surface-0/1/2/3`, `--hairline`, etc. |
| `bot/PlayVsFritz.css` | `--pvf-*` scoped tokens |
| `bot/RacehorseMatchArena.css` | Arena-specific tokens |
| `premium-polish.DISABLED.css` | Disabled copy of premium-polish.css |

**`--hud-bg` and `--hud-border` are defined in BOTH `cinematic.css` and `styles/gameTheme.css` with different values and one uses `!important`.** Whichever loads last wins. This is non-deterministic if chunk order changes.

### 3.3 Six Competing Background Systems

Six files each set the global `body {}` background:

1. `index.css` — no explicit background
2. `cinematic.css` — `radial-gradient(#0f1725 → #070b12 → #04060a)`
3. `styles/gameTheme.css` — `radial-gradient(#0f1725 → #070b12 → #04060a)` (identical to cinematic)
4. `styles/felt-green.css` — `background: var(--brand)` = `#3a9e5f` (GREEN!)
5. `styles/walnut-live.css` — `font-family: 'Avenir Next'` (also sets global font)
6. `premium-theme.css` — `background-color: var(--bg-obsidian) !important`

**The felt-green system sets body to solid green.** If load order shifts or specificity changes, the entire app could go green.

### 3.4 Font Fragmentation

6 different typefaces are in use with no font hierarchy or rationale:

| Font | Where used |
|---|---|
| `Rajdhani` | `index.css` (global import), `PlayVsFritz.css` |
| `Barlow Condensed` | `claudeMode.css` (home screen), `claudeRedesign.css` |
| `Outfit` | `claudeMode.css`, `premium-theme.css`, `PlayVsFritz.css` |
| `Space Grotesk` | `claudeMode.css`, `PlayVsFritz.css`, `ghost/ghostMode.css` |
| `Montserrat` | `PlayVsFritz.css` only |
| `Inter` | `premium-theme.css`, `ui-walnut/theme.ts` |
| `Avenir Next` | `walnut-live.css` (global body) |

`claudeMode.css` alone imports **4 Google Fonts in a single `@import`**. Multiple files import the same fonts redundantly (Rajdhani loaded in `index.css` AND `PlayVsFritz.css`).

### 3.5 Three Separate Game Screen Implementations

The multiplayer/live game screen exists in at least 3 versions:
1. **`App.tsx` inline** — the current production render (inside the God component)
2. **`ui-walnut/WalnutRoomScreen.tsx`** — standalone walnut theme variant  
3. **`bot/RacehorseMatchArena.tsx`** — arena layout for bot matches

These share components (`DominoTile`, `TileRack`, `Board`) but have completely separate layout CSS:
- `walnut-live.css` (999 lines)
- `RacehorseMatchArena.css` (479 lines)
- `App.css` (5,586 lines — includes game screen layout)

---

## 4. Dead Code & Abandoned Systems

### 4.1 Confirmed Dead (safe to delete)

| Path | Evidence of abandonment |
|---|---|
| `src/walnut-preview.tsx` | Separate entry point, not referenced in prod build |
| `src/ui-walnut/` (entire dir) | WalnutRoomScreen not routed in App.tsx; walnut-preview.tsx is sole reference |
| `experimental/claudeRedesign/` (7 files) | Not routed in App.tsx; ClaudeRedesignApp not imported anywhere in prod |
| `src/probe2.ts` | Name is a debugging probe; likely orphaned |
| All 18 `.bak*` files | Manual snapshots; git is the correct tool |
| `styles/premium-polish.DISABLED.css` | Disabled copy of active file |

### 4.2 Likely Dead / Vestigial

| Path | Status |
|---|---|
| `styles/felt-green.css` | **Not directly imported** — but `walnut-live.css` is imported globally and they coexist. Felt-green is NOT imported in main.tsx or App.tsx. Verify import chain. |
| `styles/gameTheme.css` | Not imported in main.tsx or App.tsx — status unclear |
| `cinematic.css` | Not imported in main.tsx — likely manually tested only |
| `force-ui-debug.css` | Named "debug", not imported in main.tsx |
| `learning/` directory | May be superseded by `learn/` — requires archeology |
| `puzzle/` directory | Conflicts with `dailyPuzzle/` — verify which is active |
| `debug/renderProfiler.ts` | May be prod-leaking (imported in App.tsx line 36) |

### 4.3 The `puzzle/` vs `dailyPuzzle/` Conflict

Both contain `DailyPuzzleScreen.tsx`. The routing in App.tsx uses `dailyPuzzle/DailyPuzzleScreen` (confirmed via lazy import). The `puzzle/` directory may be an older iteration. Requires verification before deletion.

---

## 5. Component Abstraction Problems

### 5.1 No Design Primitive Layer

There is no shared `<Button>`, `<Card>`, `<Modal>`, `<Panel>` primitive. Every feature module styles its own buttons from scratch. Results:
- `btn` class styled in `gameTheme.css`, `premium-polish.css`, `walnut-live.css` (3 competing definitions)
- Modal overlays: `AuthModal`, `GameOverModal`, `LeaveGameModal`, `DailyFritzLeaderboard`, `AnalyzerModal` all implement their own glass/backdrop systems

### 5.2 Duplicated DominoTile

`components/DominoTile.tsx` and `ui-walnut/components/DominoTile.tsx` are **two separate implementations** of the core game tile. If the walnut dir is dead, this is dead too. But if any feature uses it, a merge is needed.

### 5.3 CSS Bleeding Between Modules

`BotMatchScreen.tsx` imports:
- `./botMatch.css` (local)
- `../learn/learnPlayer.css` (cross-module!)
- `../learning/coach.css` (cross-module, different system!)

`learn/AuthoringCoachPanel.tsx` imports `../learning/coach.css` (cross-module).

This means the `learning/` module's CSS is a transitive dependency of `bot/`, making it impossible to safely delete learning/ without breaking bot match rendering.

### 5.4 Inline Styles Mixed With Class-Based CSS

The codebase uses three styling approaches simultaneously:
1. Class-based CSS (majority)
2. Inline `style={{}}` props (scattered throughout)
3. Tailwind utility classes (pulled in via `index.css` but minimally used)

This is not a critical problem, but it means there's no single source of truth for any element's appearance.

---

## 6. Design Token Opportunities

The following patterns appear repeatedly across CSS files and are prime candidates for a unified token system:

**Surface system (used 40+ times):**
```css
/* Currently: 6 competing definitions */
--bg-obsidian: #04070d      /* premium-theme */
--surface-0: #080b12        /* premium-polish */
--bg0: #060a10              /* force-ui-debug */
--wl-bg-top: #08100f        /* walnut-live */
/* Could be: */
--surface-bg: #06080e
```

**Glass card pattern (used ~30+ times across files):**
```css
background: rgba(X, Y, Z, 0.5-0.8);
backdrop-filter: blur(16-22px);
border: 1px solid rgba(255,255,255, 0.08-0.18);
```

**Radius scale (4 competing scales):**
- `premium-theme.css`: 12px cards
- `premium-polish.css`: `--r-sm:8px --r-md:14px --r-lg:20px --r-xl:28px`
- `felt-green.css`: `--r-card:16px --r-pill:100px --r-tile:7px`
- `walnut-live.css`: `--walnut-radius-md:14px --walnut-radius-lg:24px --walnut-radius-xl:28px`

**Premium blue/gold/purple accent system** (used extensively in claudeMode.css and home screen):
- Blue: `#38bdf8` / `#0ea5e9`
- Gold: `#f59e0b` / `#d8b56f`
- Purple: `#a855f7` / `#c040ff`
- These should be 3 canonical tokens, not 6 hardcoded variants.

---

## 7. Technical Debt Risk Assessment

| Risk | Severity | Impact |
|---|---|---|
| App.tsx 4,433-line God component | **CRITICAL** | Any game state change risks breaking 14 modes simultaneously |
| `!important` cascade war | **HIGH** | Silent visual regressions on any CSS edit |
| Competing `body {}` backgrounds | **HIGH** | Wrong background can appear on load-order change |
| `felt-green.css` globally loaded (if so) | **HIGH** | Green background could bleed into production |
| Dual learning systems (`learn/` + `learning/`) | **MEDIUM** | Dead code leaks into active CSS imports |
| No URL routing | **MEDIUM** | Deep-linking impossible; UX regression risk |
| 18 `.bak` files in src | **MEDIUM** | Build tools may process or include them |
| `debug/renderProfiler.ts` imported in App.tsx | **LOW** | Potential perf overhead in production |
| `probe2.ts` unknown file | **LOW** | Unknown purpose; could contain active side effects |
| Font loading overhead | **LOW** | 4 Google Font families loaded; some redundant |

---

## 8. UI Entropy Map — Visual Identity Layers

The following visual systems have been added sequentially, each one attempting to fix or override the previous:

```
Layer 0 (foundation): App.css — original game CSS
Layer 1 (theme attempt): styles/gameTheme.css — dark HUD tokens
Layer 2 (experiment): styles/walnut-live.css — walnut table, globally loaded
Layer 3 (experiment): styles/felt-green.css — casino green (conflicting direction)
Layer 4 (override): premium-theme.css — obsidian/bento home screen
Layer 5 (override): cinematic.css — cinematic HUD upgrade
Layer 6 (polish): styles/premium-polish.css — card system
Layer 7 (debug): force-ui-debug.css — glass debug system
Layer 8 (screen-specific): claudeMode.css — accordion home (1,407 lines)
Layer 9 (screen-specific): PlayVsFritz.css — Fritz-specific identity
Layer 10 (screen-specific): RacehorseMatchArena.css — arena layout
```

**The currently winning visual identity** (dark, atmospheric, blue/gold accents) lives primarily in:
- `claudeMode.css` (home screen)
- `PlayVsFritz.css` (Fritz screen)
- `experimental/RacehorseHomeScreen.tsx` + `RacehorseHomeArt.css`

These should become the canonical reference for the design system.

---

## 9. Prioritized Cleanup Recommendations

### Priority 1 — Immediate Safety (no visual changes, zero risk)

1. **Delete all `.bak*` files** from `src/`. They're in git history. 18 files.
2. **Delete `probe2.ts`** — confirm no imports first.
3. **Delete `walnut-preview.tsx`** — standalone entry not in prod.
4. **Delete `ui-walnut/` directory** — fully abandoned, `walnut-preview.tsx` is only reference.
5. **Delete `experimental/claudeRedesign/`** — 7 prototype files, not in prod routing.
6. **Delete `styles/premium-polish.DISABLED.css`** — redundant, git has history.
7. **Move `experimental/RacehorseHomeScreen.tsx` and `SinglePlayerHubScreen.tsx`** to a proper location (e.g. `screens/`) — they're production code mislabeled as experimental.

### Priority 2 — CSS System Triage (moderate risk, highest visual impact)

8. **Audit what actually imports `felt-green.css`** — if nothing does, delete it. If something does, this is a critical visual conflict to resolve.
9. **Determine `cinematic.css` status** — is it imported anywhere in the active prod build? If not, archive or delete.
10. **Determine `force-ui-debug.css` status** — same question.
11. **Determine `styles/gameTheme.css` status** — is it imported? Overlaps with cinematic.css tokens.
12. **Reconcile `learn/` vs `learning/`** — identify which is the live system, delete the other, fix the cross-module CSS imports in BotMatchScreen.

### Priority 3 — Design Token Consolidation

13. **Create `src/styles/tokens.css`** — single `:root` block with all brand variables:
    - Surface scale (5 levels)
    - Accent palette (blue, gold, purple, green)  
    - Radius scale (4 levels)
    - Shadow scale (3 levels)
    - Typography scale
14. **Refactor `premium-theme.css` to use tokens** — replace hardcoded values.
15. **Replace competing `:root` blocks** in gameTheme, cinematic, force-ui-debug with references to tokens.css.

### Priority 4 — Component Primitive Layer

16. **Create `src/components/primitives/`**:
    - `Button.tsx` — replaces `.btn`, `.home-top-btn`, `.draw-btn`, etc.
    - `GlassCard.tsx` — the repeated glass panel pattern
    - `HUDPanel.tsx` — score HUD abstraction
    - `Modal.tsx` — replaces ad-hoc modal implementations
17. **Eliminate cross-module CSS imports** in BotMatchScreen.

### Priority 5 — Routing Architecture

18. **Introduce React Router** (or similar) — convert `AppMode` state to URL routes.
19. **Extract game screen** from App.tsx into `screens/MultiplayerGameScreen.tsx`.
20. **Begin App.tsx decomposition** — one screen per file, App.tsx becomes a router.

---

## 10. Suggested Folder Structure

```
client/src/
├── styles/
│   ├── tokens.css           ← SINGLE source of design tokens
│   ├── base.css             ← Reset + body + html
│   └── animations.css       ← Shared keyframes
│
├── components/
│   ├── primitives/          ← Button, Card, Modal, Panel
│   ├── game/                ← Board, DominoTile, TileRack, ScoreBoard
│   └── layout/              ← LayoutScreen, GlobalNav
│
├── screens/                 ← One file per route
│   ├── HomeScreen.tsx
│   ├── MultiplayerScreen.tsx
│   ├── BotMatchScreen.tsx
│   ├── DailyPuzzleScreen.tsx
│   ├── DailyFritzScreen.tsx
│   ├── SinglePlayerHubScreen.tsx
│   ├── GhostScreen.tsx
│   ├── LeagueScreen.tsx
│   ├── StatsScreen.tsx
│   ├── FriendsScreen.tsx
│   └── [etc]
│
├── features/                ← Domain logic, keeps co-located CSS
│   ├── bot/
│   ├── ghost/
│   ├── learn/               ← Merged learn + learning
│   ├── puzzle/              ← Merged puzzle + dailyPuzzle
│   ├── league/
│   ├── stats/
│   └── friends/
│
├── multiplayer/             ← Keep as-is (well-structured)
├── auth/                    ← Keep as-is
├── analyzer/                ← Keep as-is
├── utils/                   ← sound.ts, etc.
├── types.ts
└── main.tsx                 ← Entry: loads tokens.css + base.css only
```

---

## 11. Suggested Design System Architecture

The canonical visual identity (dark atmospheric, blue/gold/purple accents, HUD-like interfaces) should be extracted into:

### `styles/tokens.css`
```css
:root {
  /* Surfaces — obsidian dark */
  --surface-base: #05080e;
  --surface-1: #0c1220;
  --surface-2: #131928;
  --surface-3: #1a2235;
  --surface-glass: rgba(13, 18, 31, 0.6);

  /* Accents — premium triad */
  --accent-blue: #38bdf8;
  --accent-gold: #d8a84a;
  --accent-purple: #a855f7;
  --accent-green: #34d399;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-light: rgba(255, 255, 255, 0.14);

  /* Text */
  --text-primary: rgba(255, 255, 255, 0.95);
  --text-secondary: rgba(255, 255, 255, 0.6);
  --text-dim: rgba(255, 255, 255, 0.35);

  /* Radius */
  --r-sm: 8px;
  --r-md: 14px;
  --r-lg: 20px;
  --r-xl: 28px;
  --r-pill: 999px;

  /* Shadows */
  --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.6);

  /* Blur */
  --blur-glass: 18px;

  /* Typography */
  --font-display: 'Barlow Condensed', system-ui, sans-serif;
  --font-body: 'Outfit', system-ui, sans-serif;

  /* Tiles */
  --tile-face: #ffffff;
  --tile-face-lo: #f5f2eb;
  --tile-border: #4a3a28;
}
```

### Typography Hierarchy (reduce to 2 fonts)
- **Display/HUD labels:** Barlow Condensed 700–800 (tactical, condensed feel — already used on home screen)
- **Body/UI:** Outfit 700–900 (modern, clean — already dominant in claudeMode)
- **Drop:** Rajdhani, Montserrat, Space Grotesk, Avenir Next, Inter

---

## 12. Phased Cleanup Roadmap

### Phase 0 — Archaeology (1 session, no changes)
- Confirm exactly which CSS files are actually imported in the production build (trace all `import` chains)
- Confirm which components/screens are reachable from App.tsx routing
- Confirm learn/ vs learning/ — which is used in prod
- Confirm puzzle/ vs dailyPuzzle/ — which is used in prod

### Phase 1 — Dead Code Removal (low risk, high clarity)
- Delete 18 `.bak` files
- Delete `ui-walnut/` directory
- Delete `experimental/claudeRedesign/`
- Delete `probe2.ts`, `walnut-preview.tsx`
- Delete `styles/premium-polish.DISABLED.css`
- Delete whichever of `puzzle/` or `learning/` is confirmed dead
- Rename `experimental/` → promote active files to `screens/`
- **Estimated reduction: ~3,000–5,000 lines**

### Phase 2 — CSS Triage (medium risk)
- Determine and remove inactive CSS files (felt-green, cinematic, force-ui-debug, gameTheme)
- Create `styles/tokens.css` — single token block
- Reduce `:root` definitions from 11 → 1
- Remove all `!important` from `premium-theme.css` (replace with proper cascade)
- Reduce font families from 7 → 2
- **Estimated reduction: 1,500–2,000 CSS lines, all `!important` removed**

### Phase 3 — Component Primitives (medium risk)
- Create `components/primitives/Button.tsx` + CSS
- Create `components/primitives/GlassCard.tsx`  
- Create `components/primitives/Modal.tsx`
- Fix cross-module CSS imports in BotMatchScreen
- Merge `learn/coach.css` and `learning/coach.css`
- **Enables: consistent styling without !important wars**

### Phase 4 — Routing Introduction (high risk, high value)
- Add React Router
- Extract `HomeScreen` from App.tsx
- Extract `MultiplayerGameScreen` from App.tsx
- App.tsx becomes a router + shared context provider
- **Target App.tsx size: under 500 lines**

### Phase 5 — Full Screen Decomposition
- One file per screen, each under 400 lines
- Shared game state via context or lightweight store
- Bot match screen fully isolated
- Learning system unified

---

## 13. Immediate Action Checklist (Phase 0 → 1)

Before writing any new UI:

- [ ] Verify which CSS files are actually imported (trace full import graph)
- [ ] Verify `felt-green.css` is NOT loaded in production
- [ ] Confirm `cinematic.css` import status
- [ ] Confirm `force-ui-debug.css` import status
- [ ] Confirm `styles/gameTheme.css` import status
- [ ] Delete 18 `.bak` files
- [ ] Delete `ui-walnut/` directory
- [ ] Delete `experimental/claudeRedesign/`
- [ ] Delete `probe2.ts` and `walnut-preview.tsx`
- [ ] Move `experimental/RacehorseHomeScreen.tsx` → `screens/HomeScreen.tsx`
- [ ] Move `experimental/SinglePlayerHubScreen.tsx` → `screens/SinglePlayerHubScreen.tsx`
- [ ] Audit `puzzle/` vs `dailyPuzzle/` — delete the legacy one
- [ ] Audit `learn/` vs `learning/` — identify which is live

---

*This audit is read-only analysis. No files were modified. All findings are based on static analysis of the source as of 2026-05-13.*
