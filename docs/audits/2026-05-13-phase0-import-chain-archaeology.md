# Phase 0: Import Chain Archaeology
**Date:** 2026-05-13  
**Branch:** architecture-audit  
**Method:** Static analysis — grep + manual import tracing from entry points  
**Status:** Complete. No files modified.

---

## Entry Points

The Vite build has **one entry point** in production:

```
index.html → src/main.tsx
```

`walnut-preview.tsx` is a **second entry point** that was used during development but is **not referenced by `index.html`** and therefore **does not enter the Vite production build graph.**

TypeScript compiles the full `src/` directory (`tsconfig.app.json` `include: ["src"]`), so `walnut-preview.tsx` and `probe2.ts` are type-checked but produce no output in the Vite build.

---

## CSS Load Order — Complete Cascade Map

This is the definitive order CSS is applied in production. Later entries override earlier ones at equal specificity.

```
LAYER 0 — index.html <head> inline
  body { background: #020617; }

LAYER 1 — index.html <head> Google Fonts preload
  Outfit (wght: 400, 600, 700, 800)
  Montserrat (wght: 900)
  Inter (wght: 400, 700, 900)

LAYER 2 — main.tsx import './index.css'
  Rajdhani (wght: 500, 600, 700)  ← via @import url(Google Fonts)
  @tailwind base / components / utilities
  Global reset (box-sizing, margin, padding)
  body: height, font-family system stack, line-height
  Rajdhani applied to specific class selectors

LAYER 3 — main.tsx import './premium-theme.css'
  :root { --bg-obsidian, --accent-*, --text-*, --border-subtle }
  body, #root { background-color: var(--bg-obsidian) !important }
  Home screen overrides (.mode-home-screen, .mode-hub, .mode-option, etc.)

LAYER 4 — App.tsx import './App.css'   [App module, runs before walnut-live]
  :root { --tile-bg, --tile-border, --dot-color, --space-*, --radius-*, etc. }
  Full game screen layout, scoreboard, board, hand area, modals, etc.
  5,586 lines — the largest single CSS file

LAYER 5 — main.tsx import './styles/walnut-live.css'
  :root { --wl-bg-*, --wl-gold, --wl-mint, --wl-card, etc. }
  body { font-family: 'Avenir Next', 'Trebuchet MS', 'Segoe UI' }  ← OVERRIDES index.css body font
  All .walnut-live.* scoped rules + global .hand-container rules at bottom
  999 lines

LAYER 6 — App.tsx direct import: ./experimental/RacehorseHomeScreen.tsx
  → RacehorseHomeArt.css (home screen art/layout)

LAYER 7 — App.tsx direct import: ./experimental/SinglePlayerHubScreen.tsx
  → SinglePlayerModes.css

LAYER 8 — App.tsx direct import: ./ui/claudeMode.tsx
  → claudeMode.css
  + Barlow Condensed, Outfit, Rajdhani, Space Grotesk  ← via @import url()
  1,407 lines — the home screen accordion system

LAYER 9 — App.tsx direct import: ./components/LeaveGameModal.tsx
  → leaveGameModal.css

LAYER 10 — App.tsx direct import: ./components/RoomReactions.tsx
  → roomReactions.css

--- Lazy chunk CSS (loaded on-demand when React renders the component) ---

LAYER 11 — lazy: ./bot/PlayVsFritz.tsx
  → PlayVsFritz.css
  + Montserrat, Outfit, Rajdhani, Space Grotesk  ← DUPLICATE of claudeMode.css fonts
  708 lines

LAYER 12 — lazy: ./bot/BotMatchScreen.tsx
  → botMatch.css
  → ../learn/learnPlayer.css  (cross-module import)
  → ../learning/coach.css    (cross-module import)

LAYER 13 — lazy: ./dailyPuzzle/DailyPuzzleScreen.tsx
  → dailyPuzzle.css

LAYER 14 — lazy: ./dailyFritz/DailyFritzScreen.tsx
  → dailyFritz.css

LAYER 15 — lazy: ./league/LeagueScreen.tsx
  → league.css

LAYER 16 — lazy: ./stats/StatsScreen.tsx
  → statsScreen.css

LAYER 17 — lazy: ./friends/FriendsScreen.tsx
  → friendsScreen.css

LAYER 18 — lazy: ./ghost/GhostSetupScreen.tsx
  → ghostMode.css

LAYER 19 — lazy: ./practice/NoBrainerLabScreen.tsx
  → noBrainerLab.css

LAYER 20 — lazy: ./auth/AuthModal.tsx AND ./auth/UsernameModal.tsx
  → authModal.css (imported by both, deduplicated by Vite)

LAYER 21 — lazy: ./analyzer/GameReviewer.tsx
  (no CSS import)

LAYER 22 — lazy: ./ranking/RatingHistoryPage.tsx
  (no CSS import, uses LayoutScreen)
```

**Note:** `leaderboardPage.css` is imported by `LeaderboardPageShell.tsx`, which is imported by `DailyFritzScreen.tsx` and `DailyPuzzleScreen.tsx` — so it loads as part of their lazy chunks.

---

## ACTIVE Dependency Map

Every file that IS in the Vite production build graph.

### Core Entry Chain
```
index.html
└── src/main.tsx
    ├── debug/globalErrors.ts
    │   └── debug/socketTrace.ts
    ├── index.css  [CSS]
    ├── premium-theme.css  [CSS]
    ├── styles/walnut-live.css  [CSS]
    └── App.tsx
        ├── App.css  [CSS]
        ├── components/ (barrel via index.ts)
        │   ├── Board.tsx
        │   ├── BoneyardStackIcon.tsx
        │   ├── BrandLogo.tsx
        │   ├── DominoTile.tsx
        │   ├── GameOverModal.tsx
        │   ├── GlobalNav.tsx
        │   │   └── BrandLogo.tsx
        │   ├── RotateOverlay.tsx
        │   ├── ScoreBoard.tsx
        │   ├── ScoreTrackOverlay.tsx
        │   └── TileRack.tsx
        ├── components/LeaveGameModal.tsx → leaveGameModal.css
        ├── components/RoomReactions.tsx → roomReactions.css
        ├── auth/useAuth.ts → lib/supabase.ts
        ├── ui/LayoutScreen.tsx
        ├── ui/claudeMode.tsx → claudeMode.css  [CSS — 1,407 lines]
        ├── analyzer/moveAnalyzer.ts
        ├── analyzer/moveLogger.ts
        ├── stats/statsApi.ts
        ├── ghost/api.ts
        ├── types.ts
        ├── bot/botEngine.ts (type only)
        ├── bot/fritzConfig.ts (type only)
        ├── multiplayer/useMultiplayerConnection.ts
        ├── multiplayer/useMultiplayerRoomActions.ts
        ├── multiplayer/useRoomSocketSync.ts
        ├── debug/renderProfiler.ts  [DEV only — no prod overhead]
        ├── learn/guidedAuthoring.ts
        │   └── (learn internals)
        ├── experimental/RacehorseHomeScreen.tsx → RacehorseHomeArt.css  [CSS]
        │   ├── components/ (BrandLogo, DominoTile, GlobalNav)
        │   ├── auth/useAuth.ts
        │   ├── friends/friendsApi.ts
        │   ├── dailyFritz/api.ts
        │   ├── dailyPuzzle/api.ts
        │   └── experimental/homeDailySummaryApi.ts
        │       └── lib/supabase.ts
        └── experimental/SinglePlayerHubScreen.tsx → SinglePlayerModes.css  [CSS]
            ├── types.ts
            └── components/ (GlobalNav)
```

### Lazy Chunks (loaded on demand)
```
bot/BotMatchScreen.tsx → botMatch.css + learnPlayer.css + coach.css  [CSS]
    ├── bot/botEngine.ts
    ├── bot/botHeuristics.ts
    ├── bot/fritzConfig.ts
    ├── analyzer/GameReviewer.tsx  [EMBEDDED — not separately lazy]
    ├── analyzer/moveAnalyzer.ts + moveLogger.ts
    ├── ghost/share.ts + logic.ts
    ├── dailyPuzzle/date.ts
    ├── lib/supabase.ts
    ├── learning/useLearningCoach.ts (FULL learning/ system)
    │   └── learning/*.ts (all 12 files)
    ├── learning/CoachPanel.tsx → coach.css  [CSS — same file as above, deduped]
    ├── learning/LearningHandRecap.tsx → coach.css  [deduped]
    ├── learn/AuthoringCoachPanel.tsx → ../learning/coach.css  [CSS — cross-dir, same file]
    ├── learn/LessonCoachPanel.tsx
    ├── learn/guidedAuthoring.ts
    └── learn/lessonV2.ts
        └── ghost/logic.ts
        └── learn/guidedLessonNotes.ts

bot/PlayVsFritz.tsx → PlayVsFritz.css  [CSS — 708 lines, 4 font families]
    ├── bot/fritzConfig.ts
    ├── bot/botEngine.ts
    ├── types.ts
    └── components/ (DominoTile, GlobalNav)

practice/NoBrainerLabScreen.tsx → noBrainerLab.css  [CSS]
    └── (noBrainer logic + dataset)

ghost/GhostSetupScreen.tsx → ghostMode.css  [CSS]
    ├── ghost/api.ts + logic.ts
    └── utils/sound.ts

dailyPuzzle/DailyPuzzleScreen.tsx → dailyPuzzle.css  [CSS]
    ├── dailyPuzzle/DailyPuzzleLadderScreen.tsx
    │   ├── ui/LeaderboardPageShell.tsx → leaderboardPage.css  [CSS]
    ├── ui/LeaderboardPageShell.tsx  [same, deduped]
    ├── dailyPuzzle/api.ts + validator.ts + types.ts + date.ts
    └── dailyPuzzle/DailyPuzzleAdminScreen.tsx → dailyPuzzle.css  [deduped]

dailyPuzzle/DailyPuzzleAdminScreen.tsx → dailyPuzzle.css  [deduped]

dailyFritz/DailyFritzScreen.tsx → dailyFritz.css  [CSS]
    ├── ui/LeaderboardPageShell.tsx → leaderboardPage.css  [CSS, deduped]
    └── dailyFritz/DailyFritzLeaderboard.tsx
        └── dailyFritz/api.ts

league/LeagueScreen.tsx → league.css  [CSS]
    ├── league/LeagueHistoryScreen.tsx
    └── league/api.ts

stats/StatsScreen.tsx → statsScreen.css  [CSS]
    └── stats/statsApi.ts

friends/FriendsScreen.tsx → friendsScreen.css  [CSS]
    └── friends/friendsApi.ts

auth/AuthModal.tsx → authModal.css  [CSS]
auth/UsernameModal.tsx → authModal.css  [CSS, deduped]
    └── auth/useAuth.ts

ranking/RatingHistoryPage.tsx (no CSS)
    └── ranking/api.ts

learn/LearnHome.tsx → learn.css  [CSS]
learn/LearnPlayer.tsx → learnPlayer.css  [CSS]
    (full learn/ system reachable via App.tsx's LEARN_MODE_VISIBLE flag)

analyzer/GameReviewer.tsx (no CSS)
    └── analyzer/moveAnalyzer.ts + moveLogger.ts
```

---

## DEAD Dependency Map

Files confirmed to have **zero inbound imports** from the production build graph. None of these files are reached from `index.html → main.tsx`.

### Dead CSS Files (6 files, ~2,000 lines)

| File | Lines | Reason |
|---|---|---|
| `styles/felt-green.css` | 719 | 0 import references in entire src/ |
| `styles/gameTheme.css` | 463 | 0 import references in entire src/ |
| `styles/premium-polish.css` | ~400 | 0 import references in entire src/ |
| `styles/premium-polish.DISABLED.css` | ~400 | Explicitly disabled, 0 references |
| `cinematic.css` | 91 | 0 import references in entire src/ |
| `force-ui-debug.css` | 116 | 0 import references in entire src/ |
| `ui/claudeUtilityPanels.css` | unknown | 0 import references in entire src/ |

**These 7 CSS files have ZERO effect on the production build. They are completely inert.**

### Dead TypeScript/TSX Files

| File | Lines | Reason |
|---|---|---|
| `walnut-preview.tsx` | ~10 | Not in index.html, not imported by any prod file |
| `probe2.ts` | ~35 | Not imported by any prod file; standalone debug script |
| `ui-walnut/WalnutRoomScreen.tsx` | large | Only referenced by walnut-preview.tsx (dead) |
| `ui-walnut/components/DominoTile.tsx` | medium | Only used by WalnutRoomScreen.tsx (dead) |
| `ui-walnut/components/HandTray.tsx` | medium | Only used by WalnutRoomScreen.tsx (dead) |
| `ui-walnut/theme.ts` | 63 | Only used by WalnutRoomScreen.tsx (dead) |
| `ui-walnut/motion.ts` | unknown | Only used in ui-walnut/ (dead chain) |
| `experimental/claudeRedesign/ClaudeRedesignApp.tsx` | medium | 0 inbound imports from prod |
| `experimental/claudeRedesign/ClaudeRedesignHome.tsx` | medium | 0 inbound imports from prod |
| `experimental/claudeRedesign/ClaudeRedesignDaily.tsx` | medium | 0 inbound imports |
| `experimental/claudeRedesign/ClaudeRedesignLeaderboard.tsx` | medium | 0 inbound imports |
| `experimental/claudeRedesign/ClaudeRedesignMulti.tsx` | medium | 0 inbound imports |
| `experimental/claudeRedesign/ClaudeRedesignSingle.tsx` | medium | 0 inbound imports |
| `experimental/claudeRedesign/ClaudeRedesignSocial.tsx` | medium | 0 inbound imports |
| `experimental/claudeRedesign/ClaudeRedesignShared.tsx` | medium | 0 inbound imports |
| `analyzer/AnalyzerModal.tsx` | medium | 0 inbound imports (GameReviewer does NOT use it) |
| `puzzle/DailyPuzzleScreen.tsx` | large | 0 inbound imports (dailyPuzzle/ is the active one) |
| `puzzle/DailyPuzzleEntry.tsx` | medium | 0 inbound imports |
| `puzzle/DailyPuzzlePlay.tsx` | medium | 0 inbound imports |
| `puzzle/getDailyPuzzle.ts` | small | 0 inbound imports |
| `puzzle/puzzleApi.ts` | small | 0 inbound imports |
| `puzzle/puzzles.ts` | small | 0 inbound imports |

### Dead CSS (in experimental/claudeRedesign/)
| File | Reason |
|---|---|
| `experimental/claudeRedesign/claudeRedesign.css` | Only imported by ClaudeRedesignApp.tsx (dead) |

### Backup Files (TypeScript does NOT compile these — safe to delete)
All 18 `.bak*` files have non-standard extensions (`.bak`, `.bak_statslog`, `.bak_namefix`, etc.) that TypeScript and Vite do not process. They are inert noise in the filesystem.

---

## Safe Deletion Candidates

**Zero risk. These files/directories are fully confirmed dead.**

```
DELETE ENTIRE DIRECTORIES:
  client/src/ui-walnut/                    ← dead chain from walnut-preview.tsx
  client/src/experimental/claudeRedesign/  ← 0 inbound imports
  client/src/puzzle/                        ← 0 inbound imports (dailyPuzzle/ is active)

DELETE FILES:
  client/src/walnut-preview.tsx            ← not in build, sole entry to dead ui-walnut/
  client/src/probe2.ts                     ← standalone debug script, 0 inbound imports
  client/src/analyzer/AnalyzerModal.tsx    ← 0 inbound imports from anywhere

DELETE DEAD CSS:
  client/src/styles/felt-green.css         ← 719 lines, 0 imports, wrong visual direction
  client/src/styles/gameTheme.css          ← 463 lines, 0 imports
  client/src/styles/premium-polish.css     ← 0 imports
  client/src/styles/premium-polish.DISABLED.css  ← explicitly disabled
  client/src/cinematic.css                 ← 0 imports
  client/src/force-ui-debug.css            ← 0 imports
  client/src/ui/claudeUtilityPanels.css    ← 0 imports

DELETE BACKUP FILES (all 18):
  client/src/App.ts20260222_174552.bakx
  client/src/App.ts20260222_182714.bak_statslog
  client/src/App.tsx.20260222_185700.bak_namefix
  client/src/auth/useAuth.ts.20260222_185407.bak
  client/src/auth/useAuth.ts.20260222_190114.bak_profilecache
  client/src/auth/useAuth.ts.20260222_190633.bak_fixcache
  client/src/auth/useAuth.ts.20260222_190705.bak_fixcache
  client/src/auth/useAuth.ts.20260222_190753.bak_cachealign
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_184729.bak
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_191645.bak_top3
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_191750.bak_lobby_top3
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_191950.bak_ui
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_192554.bak_leadermodal
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_192909.bak_leader_popup
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_193101.bak_leaderpopup_safe
  client/src/dailyPuzzle/DailyPuzzleScreen.tsx.20260222_193612.bak_leader_btn_modal_safe
  client/src/dailyPuzzle/dailyPuzzle.css.20260222_191950.bak_ui
  client/src/dailyPuzzle/dailyPuzzle.css.20260222_201923.bak_leaderpolish
```

**Total safe deletions: ~3 directories + 7 files + 7 dead CSS files + 18 backup files**

---

## High-Risk Deletion Candidates

**Requires additional investigation before touching.**

### 1. `walnut-live.css` (999 lines, GLOBALLY LOADED)

**Status:** Loaded globally via `main.tsx`. Every production user loads all 999 lines.  
**Risk:** The file contains `.walnut-live.*` scoped rules that only apply when `.walnut-live` class is present on the game screen. However, it **also contains unscoped global rules** at the bottom:

```css
/* These at bottom of walnut-live.css apply GLOBALLY regardless of .walnut-live class */
.hand-container .domino-tile { transition: ... }
.hand-container .domino-tile:not(.disabled):not(.selected):hover { transform: translateY(-8px) scale(1.04); }
.hand-container .domino-tile.selected { transform: translateY(-12px) scale(1.06); }
.hand-container .domino-tile.highlight:not(.selected) .domino-body { box-shadow: ... }
```

These unscoped `.hand-container` rules at the bottom of `walnut-live.css` **actively affect the current production UI.** Deleting this file would change tile hover behavior in the multiplayer game.

**Decision needed:** Is the `.walnut-live` class currently applied to any game screen in production? If not, all scoped rules are dead but the unscoped bottom rules are live.

### 2. `learning/` directory (currently active via BotMatchScreen)

**Status:** Fully active — `BotMatchScreen.tsx` imports 3 components and hooks from it.  
**Risk:** Cannot be deleted without migrating its consumers.  
**Clarification:** `learning/` = the live coaching system (BotMatchScreen runtime coaching). `learn/` = the structured lesson player system (LearnHome, LearnPlayer, guided authoring). They are **separate systems serving different purposes**, not duplicates.  
**Cross-dir dependency:** `learn/AuthoringCoachPanel.tsx` imports `../learning/coach.css` — `learning/coach.css` is active.

### 3. `debug/renderProfiler.ts` (imported by App.tsx)

**Status:** Imported by App.tsx, called 3 times.  
**Risk:** Minimal — `shouldProfileRenders()` returns false unless `import.meta.env.DEV && localStorage.RENDER_PROFILE === '1'`. Zero production overhead. **Do not delete.**

### 4. `experimental/` directory (partially active)

**Status:** `RacehorseHomeScreen.tsx` and `SinglePlayerHubScreen.tsx` ARE production code.  
`homeDailySummaryApi.ts` IS used by RacehorseHomeScreen.  
`claudeRedesign/` is dead (safe to delete separately).  
**Action:** Don't delete the directory — remove `claudeRedesign/` subdirectory, keep the rest.

---

## Confirmed System Roles — `learn/` vs `learning/`

These are NOT duplicates. They serve distinct purposes:

| System | Purpose | Active consumers |
|---|---|---|
| `learning/` | Runtime coaching coach during live bot matches — move evaluation, intervention levels, hand summaries | `BotMatchScreen.tsx` |
| `learn/` | Structured lesson player — lesson scenarios, guided authoring, progress tracking | `App.tsx` (guidedAuthoring), `BotMatchScreen.tsx` (AuthoringCoachPanel, LessonCoachPanel) |

`learning/coach.css` is imported by BOTH systems (via `learning/CoachPanel.tsx`, `learning/LearningHandRecap.tsx`, AND `learn/AuthoringCoachPanel.tsx`).

---

## Confirmed System Roles — `puzzle/` vs `dailyPuzzle/`

| System | Status |
|---|---|
| `dailyPuzzle/` | **ACTIVE** — lazy-loaded by App.tsx, contains DailyPuzzleScreen + LadderScreen + Admin + validator + API |
| `puzzle/` | **DEAD** — zero inbound imports. Older iteration. Has its own DailyPuzzleScreen.tsx, puzzleApi.ts, puzzles.ts, getDailyPuzzle.ts, DailyPuzzleEntry.tsx, DailyPuzzlePlay.tsx |

---

## Dangerous Side-Effect Import Analysis

| Import | Location | Side Effect | Risk |
|---|---|---|---|
| `installGlobalErrorHandlers()` | `main.tsx` | Adds window error/unhandledrejection handlers | Intentional, benign |
| `import './styles/walnut-live.css'` | `main.tsx` | Loads 999 lines including unscoped `.hand-container` rules | **ACTIVE EFFECT** — unscoped rules at file bottom affect all game screens |
| `import './premium-theme.css'` | `main.tsx` | Loads `body, #root { background: !important }` | Intentional, sets obsidian background |
| `import './App.css'` | `App.tsx` | 5,586 lines including HUD, game screen layout, body overrides | Core stylesheet |
| `import '../learning/coach.css'` | `learn/AuthoringCoachPanel.tsx` | Cross-module CSS import — creates implicit coupling | Risk if learning/ restructured |
| `import '../learn/learnPlayer.css'` | `bot/BotMatchScreen.tsx` | Cross-module CSS import — learn/ CSS in bot/ chunk | Risk if learn/ restructured |
| `useRenderProfiler('App')` | `App.tsx` | No-op in prod unless DEV + localStorage flag | Benign |
| `PlayVsFritz.css @import url(Google Fonts)` | Bot lazy chunk | Loads 4 font families when Fritz mode opens | Redundant load (fonts already loaded by claudeMode.css) |

---

## Vite Build — What Gets Included Despite Not Being Routed

Vite only bundles files reachable from the import graph starting at `main.tsx`. However:

1. **`walnut-preview.tsx`** — TypeScript-compiled but not in Vite's graph. Does NOT appear in the production bundle.

2. **`probe2.ts`** — TypeScript-compiled but not in Vite's graph. Does NOT appear in the production bundle.

3. **All `experimental/claudeRedesign/` files** — TypeScript-compiled but not in Vite's graph. Do NOT appear in the production bundle.

4. **`ui-walnut/` files** — TypeScript-compiled (via `include: ["src"]`) but not in Vite's graph. Do NOT appear in the production bundle.

5. **All dead CSS files** — NOT compiled by TypeScript (CSS isn't TS). NOT in Vite's graph (no `import` statement reaches them). Do NOT appear in the production bundle.

6. **`puzzle/` files** — TypeScript-compiled but not imported. Do NOT appear in the production bundle.

**Conclusion:** The dead code is correctly excluded from the production Vite bundle. However, it IS TypeScript-compiled, which:
- Slows `tsc` type-checking
- Generates stale `.tsbuildinfo` entries
- Creates risk of type errors in dead files preventing `npm run build` from completing if types drift

---

## `.bak` File TypeScript Status

All 18 backup files have extensions like `.bak`, `.bak_statslog`, `.bak_namefix` — TypeScript's `include: ["src"]` only processes `.ts`, `.tsx`, `.d.ts` files. These extensions are not recognized. **Backup files are NOT type-checked and NOT bundled.** They are pure filesystem noise.

---

## Import Chain Diagram — Production Build

```
index.html
│
└─► main.tsx
    │
    ├── [CSS] index.css
    │   └── @import Rajdhani (Google Fonts)
    │   └── @tailwind base/components/utilities
    │
    ├── [CSS] premium-theme.css
    │   └── :root { --bg-obsidian, --accent-* }
    │   └── body, #root { background: !important }
    │
    ├── [CSS] styles/walnut-live.css         ← 999 lines loaded globally
    │   └── :root { --wl-* }
    │   └── body { font-family: Avenir Next }  ← OVERRIDES index.css body font
    │   └── .walnut-live.* scoped rules
    │   └── .hand-container rules (UNSCOPED — global effect)
    │
    ├── debug/globalErrors.ts → debug/socketTrace.ts
    │
    └── App.tsx
        ├── [CSS] App.css (5,586 lines)
        │
        ├── [DIRECT] experimental/RacehorseHomeScreen.tsx
        │   ├── [CSS] RacehorseHomeArt.css
        │   ├── experimental/homeDailySummaryApi.ts → lib/supabase.ts
        │   ├── friends/friendsApi.ts
        │   ├── dailyFritz/api.ts
        │   └── dailyPuzzle/api.ts
        │
        ├── [DIRECT] experimental/SinglePlayerHubScreen.tsx
        │   └── [CSS] SinglePlayerModes.css
        │
        ├── [DIRECT] ui/claudeMode.tsx
        │   └── [CSS] claudeMode.css (1,407 lines)
        │       └── @import Barlow Condensed + Outfit + Rajdhani + Space Grotesk
        │
        ├── [DIRECT] components/* (Board, DominoTile, TileRack, etc.)
        ├── [DIRECT] components/LeaveGameModal → [CSS] leaveGameModal.css
        ├── [DIRECT] components/RoomReactions → [CSS] roomReactions.css
        ├── [DIRECT] auth/useAuth → lib/supabase.ts
        ├── [DIRECT] ui/LayoutScreen.tsx
        ├── [DIRECT] analyzer/moveAnalyzer.ts + moveLogger.ts
        ├── [DIRECT] stats/statsApi.ts
        ├── [DIRECT] ghost/api.ts
        ├── [DIRECT] multiplayer/* (3 hooks)
        ├── [DIRECT] debug/renderProfiler.ts  [DEV-gated]
        ├── [DIRECT] learn/guidedAuthoring.ts
        │
        ├── [LAZY] bot/BotMatchScreen.tsx
        │   ├── [CSS] botMatch.css
        │   ├── [CSS] ../learn/learnPlayer.css
        │   ├── [CSS] ../learning/coach.css
        │   ├── bot/botEngine.ts + botHeuristics.ts + fritzConfig.ts
        │   ├── analyzer/GameReviewer.tsx (embedded)
        │   ├── ghost/share.ts + logic.ts
        │   ├── dailyPuzzle/date.ts
        │   ├── lib/supabase.ts
        │   ├── learning/* (all 12 files — full coaching system)
        │   ├── learning/CoachPanel.tsx (+ CSS deduped)
        │   ├── learning/LearningHandRecap.tsx (+ CSS deduped)
        │   ├── learn/AuthoringCoachPanel.tsx → [CSS] ../learning/coach.css (deduped)
        │   ├── learn/LessonCoachPanel.tsx
        │   ├── learn/guidedAuthoring.ts
        │   └── learn/lessonV2.ts → ghost/logic.ts
        │
        ├── [LAZY] bot/PlayVsFritz.tsx
        │   └── [CSS] PlayVsFritz.css (708 lines)
        │       └── @import Montserrat + Outfit + Rajdhani + Space Grotesk (REDUNDANT)
        │
        ├── [LAZY] practice/NoBrainerLabScreen.tsx
        │   └── [CSS] noBrainerLab.css
        │
        ├── [LAZY] ghost/GhostSetupScreen.tsx
        │   └── [CSS] ghostMode.css
        │
        ├── [LAZY] dailyPuzzle/DailyPuzzleScreen.tsx
        │   └── [CSS] dailyPuzzle.css
        │   ├── dailyPuzzle/DailyPuzzleLadderScreen.tsx
        │   │   └── ui/LeaderboardPageShell → [CSS] leaderboardPage.css
        │   └── ui/LeaderboardPageShell (deduped)
        │
        ├── [LAZY] dailyPuzzle/DailyPuzzleAdminScreen.tsx
        │   └── [CSS] dailyPuzzle.css (deduped)
        │
        ├── [LAZY] dailyFritz/DailyFritzScreen.tsx
        │   └── [CSS] dailyFritz.css
        │   ├── dailyFritz/DailyFritzLeaderboard.tsx
        │   └── ui/LeaderboardPageShell → [CSS] leaderboardPage.css (deduped)
        │
        ├── [LAZY] league/LeagueScreen.tsx
        │   └── [CSS] league.css
        │   └── league/LeagueHistoryScreen.tsx
        │
        ├── [LAZY] ranking/RatingHistoryPage.tsx
        ├── [LAZY] analyzer/GameReviewer.tsx
        ├── [LAZY] auth/AuthModal.tsx → [CSS] authModal.css
        ├── [LAZY] auth/UsernameModal.tsx → [CSS] authModal.css (deduped)
        ├── [LAZY] stats/StatsScreen.tsx → [CSS] statsScreen.css
        ├── [LAZY] friends/FriendsScreen.tsx → [CSS] friendsScreen.css
        ├── [LAZY] learn/LearnHome + LearnPlayer (gated by LEARN_MODE_VISIBLE flag)
        └── [LAZY] learn/... (full learn/ system)
```

---

## NOT In Production Build (Confirmed Dead)

```
DEAD DIRECTORIES:
  src/ui-walnut/                         ← entry is walnut-preview.tsx (not in build)
  src/experimental/claudeRedesign/       ← 0 inbound imports from prod
  src/puzzle/                            ← 0 inbound imports (dailyPuzzle/ is active)

DEAD TYPESCRIPT FILES:
  src/walnut-preview.tsx
  src/probe2.ts
  src/analyzer/AnalyzerModal.tsx

DEAD CSS FILES (not imported anywhere, not in build):
  src/styles/felt-green.css              ← 719 lines (casino green — WRONG direction)
  src/styles/gameTheme.css               ← 463 lines
  src/styles/premium-polish.css          ← 0 imports
  src/styles/premium-polish.DISABLED.css ← explicitly disabled
  src/cinematic.css                      ← 91 lines
  src/force-ui-debug.css                 ← 116 lines
  src/ui/claudeUtilityPanels.css         ← 0 imports

BACKUP FILES (not TS-compiled, not in build):
  18 × .bak* files listed in Safe Deletion section
```

---

## Summary Table

| Category | Status | Action |
|---|---|---|
| `styles/felt-green.css` | DEAD — 0 imports | **Safe delete** |
| `styles/gameTheme.css` | DEAD — 0 imports | **Safe delete** |
| `styles/premium-polish.css` | DEAD — 0 imports | **Safe delete** |
| `styles/premium-polish.DISABLED.css` | DEAD — disabled | **Safe delete** |
| `cinematic.css` | DEAD — 0 imports | **Safe delete** |
| `force-ui-debug.css` | DEAD — 0 imports | **Safe delete** |
| `ui/claudeUtilityPanels.css` | DEAD — 0 imports | **Safe delete** |
| `ui-walnut/` directory | DEAD — only walnut-preview.tsx | **Safe delete directory** |
| `experimental/claudeRedesign/` | DEAD — 0 prod imports | **Safe delete directory** |
| `puzzle/` directory | DEAD — 0 imports | **Safe delete directory** |
| `walnut-preview.tsx` | DEAD — not in build | **Safe delete** |
| `probe2.ts` | DEAD — 0 imports | **Safe delete** |
| `analyzer/AnalyzerModal.tsx` | DEAD — 0 imports | **Safe delete** |
| All 18 `.bak*` files | DEAD — not TS/Vite | **Safe delete** |
| `styles/walnut-live.css` | LIVE globally (unscoped rules active) | **Investigate before touch** |
| `learning/` directory | LIVE — BotMatchScreen active | **Do not delete** |
| `learn/` directory | LIVE — App.tsx + BotMatchScreen | **Do not delete** |
| `experimental/RacehorseHomeScreen.tsx` | LIVE production code | **Do not delete — relocate** |
| `experimental/SinglePlayerHubScreen.tsx` | LIVE production code | **Do not delete — relocate** |
| `experimental/homeDailySummaryApi.ts` | LIVE — used by HomeScreen | **Do not delete — relocate** |
| `debug/renderProfiler.ts` | LIVE — DEV-gated, no prod overhead | **Keep** |
| `debug/globalErrors.ts` | LIVE — window error handler | **Keep** |

---

*Phase 0 complete. All findings are based on static import analysis. No files were modified.*
