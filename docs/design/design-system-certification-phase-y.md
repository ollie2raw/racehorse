# Racehorse Design System Certification — Phase Y

**Audit type:** Repository-wide, read-only design system certification  
**Scope:** UI platform only (screens, components, CSS, tokens, primitives, interaction patterns)  
**Excluded:** Gameplay logic, networking, multiplayer architecture  
**Date:** 2026-07-06  
**Architecture status:** Frozen — no code changes made during this audit

---

## 1. Executive Summary

Racehorse Dominoes has a **declared** design system (`tokens.css`, four React primitives, agent design docs) and a **strong product visual direction** (Play vs Fritz matte/neon, documented in `docs/agent-skills/racehorse-design-source-of-truth.md`). What it does **not** yet have is an **enterprise-grade, certifiable design system** capable of supporting 100+ screens over five years without compounding drift.

Repository evidence shows a **dual-stack UI platform**:

1. **Emerging system layer** — `client/src/styles/tokens.css`, `client/src/components/primitives/` (`Button`, `Modal`, `GlassCard`, `StatValue`), hub scaffold (`components/hub/`, `hubDesignTokens.css`), and PVF layout tokens (`styles/_pvf-layout.css`).
2. **Legacy / parallel stacks** — `App.css` (4,718 lines), globally loaded `walnut-live.css` (2,559 lines, 273 `!important` rules), feature monoliths (`dailyFritz.css` 5,598 lines, `learnPlayer.css` 1,632 lines, `claudeMode.css` 1,399 lines), and screen-local button/modal/card implementations.

**Quantified platform scale:**

| Metric | Evidence |
|--------|----------|
| CSS files | 103 under `client/src/` |
| Total CSS lines | ~58,714 |
| TSX files | 195 |
| Declared primitives | 4 (`Button`, `Modal`, `GlassCard`, `StatValue`) |
| TSX files importing primitives | 20 (almost all for `Button`; `Modal` only in Journey) |
| Master design doc | `docs/design-system/DESIGN_SYSTEM_MASTER.md` — **empty** |
| Canonical visual doc | `docs/agent-skills/racehorse-design-source-of-truth.md` — populated |

**Critical finding:** `tokens.css` line 1–2 declares *"Single Source of Truth"* and *"Never hardcode hex elsewhere,"* but `App.css` `:root` (lines 20–60) **redefines** the same variables with conflicting values (`--radius-sm` 4px vs 8px, `--bg-card` `#2d3548` vs `#0d121f`, `--text-primary` `#ffffff` vs `#f8fafc`, different shadow scales). Because `App.css` loads via `App.tsx` after `main.tsx` global imports, the token layer is **not authoritative at runtime**.

**Button fragmentation:** At least **14 distinct button implementations** coexist (primitive `rh-btn` plus `.btn`, `mode-inline-btn`, PVF, walnut-live, claude-mode, daily puzzle collision classes, leave modal overrides, game-over, daily Fritz, private lobby, learn academy, back button, overlay CTAs, raw `<button>`).

**Modal fragmentation:** At least **9 overlay/modal families** with **non-layered z-index** values spanning 1000 → 10070 (primitive modal at 1000; auth/leave at 1900; daily puzzle at 2400; friend challenge at 2000; rotate-phone at 3000; reactions at 9999; pivotal review at 10055–10065; GameReviewer at 10070).

**Primitive adoption:** Partial and uneven. `Button` appears on ~20 surfaces (home, solo hub, daily Fritz hub, ladder hub, journey, matchmaking shell, multiplayer control panel, leave/game-over modals, No Brainer Lab). `Modal` is **Journey-only** (4 journey modals + `InteractivePuzzleModal`). `GlassCard` has **one consumer** (`Modal.tsx`). `StatValue` has **zero product consumers**.

**Verdict:** The product is visually converging toward PVF matte/neon in newer hubs, but the **design system infrastructure is not certified** for long-horizon enterprise maintenance.

### Final certification

# **NOT READY**

Racehorse does not presently qualify as a Production, World-Class, or enterprise-grade design system. It qualifies as a **product UI with emerging primitives and documented visual intent**, requiring systematic consolidation before five-year scale certification.

---

## 2. Scorecard

| Dimension | Score | Rationale (evidence) |
|-----------|------:|---------------------|
| **Design System Score** | **41 / 100** | Tokens + 4 primitives exist; empty master doc; 14+ button systems; 9+ modal stacks; 103 CSS files |
| **Primitive Adoption Score** | **17 / 100** | 20/195 TSX files use primitives; Modal ~5% of overlays; GlassCard/StatValue near-zero |
| **Token Adoption Score** | **33 / 100** | `tokens.css` strong but overridden by `App.css`; parallel hub/social token scopes; widespread hardcoded hex |
| **CSS Architecture Score** | **26 / 100** | No global layering contract; 4.7k-line `App.css`; deprecated `walnut-live` globally loaded; feature silos |
| **Component Consistency Score** | **30 / 100** | Hub primitives started; most screens use bespoke class stacks |
| **Interaction Consistency Score** | **36 / 100** | `Button.css` has full states; majority of buttons lack `focus-visible` / disabled parity |
| **Visual Consistency Score** | **44 / 100** | PVF direction documented and visible in hubs; walnut/claude/learn immersive parallel aesthetics |
| **Accessibility Consistency Score** | **38 / 100** | Good `aria-*` on newer screens; primitive Modal has `role="dialog"`; no systematic focus trap; `prefers-reduced-motion` rare (3 matches) |
| **Responsive Consistency Score** | **39 / 100** | 57 CSS files use `@media`; breakpoints 380/600/768/900px without shared tokens |
| **Animation Consistency Score** | **34 / 100** | `--ease-premium` in tokens; per-feature keyframes dominate |
| **Technical CSS Debt Score** | **24 / 100** | ~58.7k CSS lines; 273 `!important` in walnut-live alone; naming collisions (`rh-btn` in daily puzzle ≠ primitive) |

---

## 3. Platform Inventory

### 3.1 CSS load order (`main.tsx` lines 17–30)

```
tokens.css → index.css → premium-theme.css → App.tsx imports App.css
walnut-live.css (global)
rh-glow-underline.css, game-interactions.css, match-hud-polish.css
match-board-architecture.css, match-standard-live-board.css
gameLayoutLayers.css, racehorse-background.css, rh-image-surface.css
styles/board/index.css
```

**Implication:** Twelve global stylesheets load before any route-specific CSS. There is no documented cascade priority or `@layer` strategy.

### 3.2 Token layers (competing authorities)

| File | Scope | Role |
|------|-------|------|
| `styles/tokens.css` | `:root` | Declared SSOT — tiers, glass, typography, match board, image treatments |
| `App.css` | `:root` | **Overrides** tokens — spacing scale, legacy bg/text/shadow/radius |
| `components/hub/hubDesignTokens.css` | `.rh-hub-page` | Parallel hub palette (`--hub-gold`, `--hub-space-*`, `--hub-radius-*`) |
| `social/hub/socialHubTokens.css` | Hub social scope | Third hub token dialect |
| `premium-theme.css` | Screen overrides | Home/lobby `!important` overrides referencing some token vars |
| `styles/walnut-live.css` | `.walnut-live` + `body` font | Legacy match shell tokens (`--wl-gold`, `--wl-mint`) |
| `styles/_pvf-layout.css` | PVF shell | PVF panel/button layout tokens |

### 3.3 Primitives (`components/primitives/`)

| Primitive | CSS | Adoption |
|-----------|-----|----------|
| `Button` | `Button.css` — 8 variants, 2 sizes, hover/focus/disabled/active | **20 TSX imports** |
| `Modal` | `Modal.css` — z-index 1000, Escape dismiss, `role="dialog"` | **Journey only** (4 modals + `InteractivePuzzleModal`) |
| `GlassCard` | `GlassCard.css` — glass surface, lifted shadow, accent borders | **Only `Modal.tsx`** |
| `StatValue` | `StatValue.css` | **Zero external TSX imports** |

### 3.4 Hub scaffold (partial second system)

| Component | CSS pair | Consumers |
|-----------|----------|-----------|
| `HubViewportPage` | `hubViewportPage.css`, `socialHubTokens.css` | Limited |
| `HubPageHero` | `hubPageHero.css` | Leaderboard/social patterns |
| `SideRailCard` | `sideRailCard.css` | Hub layouts |
| `FilterPillRow` | `filterPillRow.css` | Leaderboard screens |
| `PlayerInitialsAvatar` | `playerInitialsAvatar.css` | Hub avatars |

Hub tokens imported by: `DailyFritzLeaderboardScreen`, `DailyPuzzleLadderLeaderboardScreen`, `ActivityFeedScreen` (partial).

### 3.5 Route surfaces audited (`AppRoutes.tsx` `appMode` branches)

| Surface | Primary styling | Uses primitives? |
|---------|-----------------|------------------|
| `home` | `RacehorseHomeArt.css`, `premium-theme.css`, `App.css` | **Button** |
| `singlePlayerHub` | `SinglePlayerModes.css` | **Button** |
| `dailyFritz` | `dailyFritz.css` (5,598 lines) | **Button** (hub); match uses walnut-live |
| `daily` | `dailyPuzzle.css` | **Button** (ladder hub only); legacy uses `rh-btn-*` collision classes |
| `botSetup` / `bot` | `PlayVsFritz.css`, `_pvf-layout.css`, `botMatch.css`, `walnut-live.css` | **No** — `pvf-start-btn`, `wl-control-btn` |
| `ghostSetup` / `ghost` | `ghostMode.css` | **No** |
| `learn` + sub-routes | `learn.css`, `learnPlayer.css`, `learnAcademy.css`, 8+ learn CSS files | **Partial** — `LearnHowToPlayRacehorse` uses Button; `LearnActionButton` is separate |
| `journey` | `racehorseJourney.css` | **Button + Modal** |
| `multiplayer` | `privateMatchLobby.css`, `matchmakingScreen.css`, `multiplayerHub*.css` | **Partial** — control panel only |
| `tournament` | `tournamentHub.css`, `tournamentBracket.css`, `tournamentResult.css` | **No** |
| `friends` | `friendsScreen.css` | **No** |
| `stats` / `weeklyStats` | `statsScreen.css` | **No** — `.btn` patterns |
| `leaderboard` / `feed` / `profile` | `leaderboard.css`, `activityFeed*.css`, `publicProfile.css`, hub CSS | **No** |
| `noBrainer` | `noBrainerLab.css` | **Button** |
| `ratingHistory` | `leaderboardPage.css` | **No** |
| Auth overlays | `authModal.css` | **No** — bespoke `auth-modal-*` |
| Leave / hand-over / game-over | `leaveGameModal.css`, `handOverModal.css`, `GameOverModal.css`, `App.css` | **Mixed** — Leave/GameOver use Button inside custom shells |
| Training / analyzer | `pivotalReview/*.css`, `GameReviewer.css` | **No** — z-index 10055–10070 stack |

**Screens bypassing primitives (majority):** Auth, Friends, Stats, Leaderboard, Learn player/home, Play vs Fritz, Ghost, Tournament, Live match, Daily Puzzle legacy/admin/overlays, Claude mode surfaces, bot in-game trays, social profile/feed, rating history, pivotal review, GameReviewer.

---

## 4. Fragmentation Analysis

### 4.1 Button implementations (14+ families)

| # | System | Location | Evidence |
|---|--------|----------|----------|
| 1 | `rh-btn` primitive | `components/primitives/Button.css` | 8 variants, `focus-visible`, disabled, active scale |
| 2 | `.btn` / `.btn.primary` | `App.css` | Global legacy button (~15 rules); used in stats, admin fallbacks |
| 3 | `mode-inline-btn` | `App.css` | Mode hub inline actions |
| 4 | `pvf-start-btn` / `pvf-back-btn` | `styles/_pvf-layout.css` | Play vs Fritz setup |
| 5 | `wl-control-btn` | `styles/walnut-live.css` | Live match controls |
| 6 | `claude-mode-primary` / `secondary` | `ui/claudeMode.css` (128 button-related rules) | Claude mode UI |
| 7 | `rh-btn-home` / `cancel` / `leave` | `dailyPuzzle/dailyPuzzle.css` | **Naming collision** with primitive `rh-btn` |
| 8 | `rh-leave-modal__btn` | `components/leaveGameModal.css` | Overrides primitive with `!important` |
| 9 | `rh-go-btn-*` | `components/GameOverModal.css` | Game-over CTA styling over primitive |
| 10 | `df-*` button overrides | `dailyFritz/dailyFritz.css` (38 `rh-btn` references, many overrides) | Daily Fritz feature scope |
| 11 | `pml-*` buttons | `multiplayer/privateMatchLobby.css` (25+ button rules) | Private lobby |
| 12 | `learn-intro-start` / `LearnActionButton` | `learn/*.css`, `learn/academy/LearnActionButton.tsx` | Learn academy parallel button component |
| 13 | `rh-back-button` | `App.css` | Global back navigation |
| 14 | Overlay CTAs | `bot/botMatch.css` (`daily-fritz-set-overlay-primary/secondary`) | Bot post-game overlays |
| 15 | Raw `<button>` + inline styles | `AppRoutes.tsx`, `DefaultErrorFallback.tsx`, admin screens | Unstyled escape hatches |

### 4.2 Modal / overlay implementations (9+ families)

| # | System | z-index | Files |
|---|--------|--------:|-------|
| 1 | `rh-modal-backdrop` (primitive) | 1000 | `Modal.css`, Journey modals |
| 2 | `auth-modal-overlay` / `auth-modal-card` | 1900–1901 | `authModal.css`, `AuthModal.tsx`, `UsernameModal.tsx`, `ChangePasswordModal.tsx` |
| 3 | `rh-leave-overlay` / `rh-leave-card` | 1900 | `leaveGameModal.css`, `LeaveGameModal.tsx` |
| 4 | `game-over-overlay` | App.css stack | `App.css`, bot/game-over modals, pivotal review |
| 5 | Daily puzzle overlays | 2400 | `dailyPuzzle.css`, `DailyPuzzleLadderOverlays.tsx` |
| 6 | `friend-challenge` overlay | 2000 | `friendChallenge.css` |
| 7 | `rotate-phone-overlay` | 3000 | `App.css`, `RotateOverlay.tsx` |
| 8 | `room-reactions` / match-found | 9999 | `roomReactions.css`, `matchFoundOverlay.css` |
| 9 | Pivotal review stack | 10055–10065 | `postGameReviewPrompt.css`, `pivotalTurnReviewCard.css`, `pivotalReviewSummary.css` |
| 10 | `GameReviewer` overlay | 10070 | `GameReviewer.css` |
| 11 | `HandOverModal` | local stacking | `handOverModal.css` (74 hand-over rules) |
| 12 | Claude mode overlays | varies | `claudeMode.css` |

**No z-index token scale exists.** Stacking is emergent per feature.

### 4.3 Card / panel systems (10+ parallel families)

| # | System | Location |
|---|--------|----------|
| 1 | `rh-glass-card` | Primitive — **underused** |
| 2 | `mode-option` / home cards | `premium-theme.css`, `RacehorseHomeArt.css` |
| 3 | `pvf-control-panel` | `styles/_pvf-layout.css` |
| 4 | `claude-mode` cards | `ui/claudeMode.css` |
| 5 | Hub panel tokens | `hubDesignTokens.css`, `sideRailCard.css` |
| 6 | `.layout-screen` card vars | `App.css` (`--card-radius`, `--card-bg` gradients) |
| 7 | `df-*` cards | `dailyFritz.css` (129 card/panel pattern matches) |
| 8 | Daily puzzle cards | `dailyPuzzle.css` (43 card/panel matches) |
| 9 | Tournament cards | `tournamentBracket.css`, `tournamentHub.css` |
| 10 | Walnut-live panels | `walnut-live.css` (`--wl-panel`, `--wl-card`) |
| 11 | `rh-image-surface` treatments | `styles/rh-image-surface.css` |

### 4.4 Typography

| Source | Fonts declared |
|--------|----------------|
| `tokens.css` | `--font-display: Barlow Condensed`, `--font-body: Outfit` |
| `index.css` | `system-ui, -apple-system, …` on `body` |
| `premium-theme.css` | Forces `var(--font-body)` on home |
| `walnut-live.css` | `body { font-family: Avenir Next, Trebuchet MS, … }` **globally** |

**Three body font stacks compete at runtime.**

### 4.5 Spacing

| Source | Scale |
|--------|-------|
| `tokens.css` | No `--space-*` scale |
| `App.css` | `--space-xs` 8px → `--space-xl` 64px |
| `hubDesignTokens.css` | `--hub-space-1` 8px → `--hub-space-4` 32px |
| Per-feature | `clamp()`, arbitrary padding in feature CSS |

### 4.6 Styling paradigms (hidden duplicate systems)

1. **Custom CSS class stacks** — dominant (~58k lines)
2. **Tailwind** — `index.css` declares `@tailwind`; ~27 TSX files use utility-like class strings (HomeScreen 55 matches) — **no documented policy**
3. **Inline styles** — error fallbacks, admin tooling
4. **Feature `!important` wars** — `premium-theme.css` (74), `dailyPuzzle.css` (75), `walnut-live.css` (273)

---

## 5. State & Interaction Audit

### 5.1 Loading states

| Pattern | Location | Primitive? |
|---------|----------|------------|
| `ScreenLoader` | `ui/ScreenLoader.tsx` + `App.css` (lines 4609–4711) | Shared component; styles live in `App.css` monolith |
| Feature spinners | `DailyFritzLoadingScreen`, `DailyPuzzleLoadingScreen` | Bespoke per mode |
| Suspense fallback | `AppRoutes.tsx` → `ScreenLoader` | **Yes** (single shared loader) |

### 5.2 Empty states

No shared `EmptyState` primitive. Implemented ad hoc in Friends, Leaderboard, Activity Feed, Tournament, Ghost setup (grep: feature-local copy + CSS).

### 5.3 Error states

| Pattern | Location |
|---------|----------|
| `ErrorBoundary` / `DefaultErrorFallback` | `components/ErrorBoundary.tsx` — raw buttons |
| `BotMatchGuidedV2BootErrorView` | Bot view layer — bespoke |
| Feature error banners | `dailyPuzzle.css`, `dailyFritz.css`, multiplayer shells |

### 5.4 Interaction states coverage

| State | Primitive Button | Rest of platform |
|-------|------------------|------------------|
| Hover | ✅ `Button.css` | Inconsistent — many CSS files omit hover |
| Focus | ✅ `focus-visible` | Only ~15 CSS files define `focus-visible` / `:focus` |
| Disabled | ✅ opacity + `pointer-events: none` | Feature-local patterns |
| Pressed / active | ✅ `scale(0.97)` | Sparse elsewhere |
| `prefers-reduced-motion` | ❌ | 3 total matches (`App.css`, `dailyFritz.css`) |

### 5.5 Responsive breakpoints (inconsistent)

| Breakpoint | Where used |
|------------|------------|
| `380px` (`--very-small-w`) | `App.css` |
| `600px` (`--mobile-w`) | `App.css`, many screens |
| `768px` | `walnut-live.css`, learn CSS |
| `900px` landscape | `walnut-live.css` tray height |

No `--breakpoint-*` tokens in `tokens.css`.

---

## 6. Declared vs. Actual Design Language

**Declared** (`racehorse-design-source-of-truth.md`):

- Matte/near-black shell, restrained neon, thin borders, no gradients, PVF as canonical
- Walnut naming deprecated; do not infer visual direction from `walnut-live`

**Violations found in repository:**

| Violation | Evidence |
|-----------|----------|
| Global walnut-live load | `main.tsx` line 21 |
| Gradients on buttons | `Button.css` tier variants use `linear-gradient` (lines 103–157) — conflicts with Agents.md "matte solid surfaces" |
| Gradients on cards/layout | `App.css` `--card-bg` gradient; 40+ CSS files with `linear-gradient`/`radial-gradient` |
| Legacy brown tile tokens | `App.css` `--tile-border: #8b7355` |
| Brown/walnut class naming active | `walnut-live.css` 2,559 lines, `.walnut-live` on match screens |
| Empty master doc | `DESIGN_SYSTEM_MASTER.md` zero bytes |

---

## 7. Architecture Questions (Evidence-Based Answers)

### Should `App.css` exist?

**Current role:** 4,718-line global monolith — shell layout (`.app`, `.layout-screen`), legacy `:root` overrides, `.btn`, match overlays, screen loader, rotate overlay, game-over overlay, home art hooks.

**Certification answer:** Not as a token authority or primitive host. It functions as an **undecomposed legacy global stylesheet**. At 4,718 lines it will not scale to 100+ screens without continued override conflicts. Evidence: token overrides lines 20–60; `rh-screen-loader` buried at line 4609.

### Should `walnut-live.css` exist?

**Current role:** Globally imported; sets alternate `body` font; defines `.walnut-live` match shell (2,559 lines, 273 `!important`).

**Certification answer:** **Not as a global stylesheet.** Design source of truth explicitly deprecates walnut as visual direction (lines 74–87 of `racehorse-design-source-of-truth.md`). It is a **hidden parallel match design system** loaded on every page.

### Should feature CSS be consolidated?

**Evidence:** Top feature CSS by line count:

| File | Lines |
|------|------:|
| `dailyFritz.css` | 5,598 |
| `App.css` | 4,718 |
| `journey/racehorseJourney.css` | ~2,500+ |
| `walnut-live.css` | 2,559 |
| `learn/learnPlayer.css` | 1,632 |
| `ui/claudeMode.css` | 1,399 |

Feature silos grow independently. Without a shared primitive import contract, consolidation is **required** for five-year maintainability — not optional.

### Are primitives actually being adopted?

**Partially.** `Button` ~25% of interactive surfaces. `Modal` ~10% of overlays. `GlassCard` and `StatValue` effectively **unadopted**.

### Are there hidden duplicate design systems?

**Yes — at least five:**

1. PVF matte/neon (`_pvf-layout.css`, `_fritz-screen-shell.css`)
2. Walnut-live match (`walnut-live.css`)
3. Claude mode (`claudeMode.css` + `claudeMode.tsx`)
4. Learn immersive/academy (`learnPlayer.css`, `learnAcademy.css`, `learnHowToPlayImmersive.css`)
5. Hub/social mockup tokens (`hubDesignTokens.css`, `socialHubTokens.css`)

### Will CSS architecture scale to 100+ screens?

**No — not without structural change.** Evidence:

- 103 CSS files / ~58.7k lines today with ~35 route surfaces
- Linear extrapolation → ~170 CSS files at 100 screens if current pattern continues
- No `@layer`, no enforced import boundaries, no lint for token usage
- `dependency-cruiser` configs exist for multiplayer architecture but **not for design system invariants**

---

## 8. Top 50 Design System Problems

| # | Problem | Evidence |
|---|---------|----------|
| 1 | `tokens.css` SSOT claim falsified by `App.css` `:root` override | `tokens.css` L1–2 vs `App.css` L20–60 |
| 2 | `DESIGN_SYSTEM_MASTER.md` is empty | 0 bytes |
| 3 | Only 4 primitives for entire platform | `components/primitives/` |
| 4 | `StatValue` primitive has zero consumers | grep: only `StatValue.tsx` |
| 5 | `GlassCard` only used inside `Modal.tsx` | grep |
| 6 | `Modal` primitive limited to Journey | 5 TSX files in `journey/` |
| 7 | 14+ parallel button implementations | Section 4.1 |
| 8 | `rh-btn` naming collision in daily puzzle | `dailyPuzzle.css` `rh-btn-home` vs primitive `rh-btn` |
| 9 | 9+ modal families with conflicting z-index | Section 4.2 |
| 10 | No z-index token scale | ad hoc 1000–10070 |
| 11 | `walnut-live.css` globally loaded despite deprecation | `main.tsx` L21; design doc L74–87 |
| 12 | `walnut-live.css` has 273 `!important` rules | grep count |
| 13 | `body` font overridden by walnut-live | `walnut-live.css` L14–16 |
| 14 | Three competing font stacks | tokens / index / walnut |
| 15 | `App.css` is 4,718-line undecomposed monolith | `wc -l` |
| 16 | `dailyFritz.css` is 5,598-line feature monolith | `wc -l` |
| 17 | 103 CSS files without layering policy | `find *.css` |
| 18 | ~58,714 total CSS lines | `wc` aggregate |
| 19 | `premium-theme.css` uses 74 `!important` overrides | grep |
| 20 | Parallel hub token scopes | `hubDesignTokens.css`, `socialHubTokens.css` |
| 21 | No `--space-*` in canonical tokens | `tokens.css` lacks spacing scale |
| 22 | Spacing defined separately in App + hub | `App.css` L21–25, hub L32–35 |
| 23 | `--radius-sm` 8px in tokens, 4px in App | conflicting values |
| 24 | `--bg-card` `#0d121f` in tokens, `#2d3548` in App | conflicting values |
| 25 | Hardcoded hex in TSX widespread | e.g. `HomeScreen.tsx` 49 hex matches |
| 26 | Tailwind present without adoption policy | `index.css` L1–3; mixed TSX usage |
| 27 | No shared `EmptyState` primitive | ad hoc per screen |
| 28 | No shared form field primitives | auth uses bespoke inputs |
| 29 | `leaveGameModal.css` overrides Button with `!important` | L80+ region |
| 30 | `GameOverModal.css` parallel CTA classes over primitive | `rh-go-btn-*` |
| 31 | Auth modals duplicate leave modal shell | `authModal.css` mirrors `leaveGameModal.css` |
| 32 | `HandOverModal` is separate 74-rule modal system | `handOverModal.css` |
| 33 | Pivotal review overlays use 10055+ z-index | training CSS |
| 34 | `GameReviewer` at z-index 10070 | `GameReviewer.css` L2 |
| 35 | `prefers-reduced-motion` barely implemented | 3 repo matches |
| 36 | Focus states missing on majority of buttons | ~15 CSS files vs 103 |
| 37 | Primitive Modal lacks focus trap | `Modal.tsx` — Escape only |
| 38 | Tier button variants use gradients | `Button.css` L103–157 vs matte rule |
| 39 | Legacy brown tile tokens in App | `--tile-border: #8b7355` |
| 40 | `layout-screen` uses `min-height: 100dvh` + `overflow-y: auto` | `App.css` L105–113 — conflicts with viewport-locked shell rule in Agents.md |
| 41 | `ScreenLoader` styles trapped in `App.css` tail | L4609+ |
| 42 | Learn has 10+ separate CSS files | `learn/` directory |
| 43 | `LearnActionButton` parallel to primitive Button | `learn/academy/LearnActionButton.tsx` |
| 44 | `claudeMode.css` is 1,399-line parallel UI system | `wc -l` |
| 45 | No design-system lint / invariant scripts | multiplayer has `checkArchitectureInvariants.ts`; nothing equivalent for UI tokens |
| 46 | `mode-option` cards diverge from `rh-glass-card` | `premium-theme.css` |
| 47 | Match board has separate CSS aggregator | `styles/board/index.css` stub + 10 board files |
| 48 | Image surface tokens overly specific in global tokens | `tokens.css` L73–127 — 50+ vars for image treatments |
| 49 | Hub components not adopted on Friends/Stats screens | grep `import.*hub/` — 4 files only |
| 50 | Inconsistent breakpoint tokens | 380/600/768/900px |

---

## 9. Top 100 Highest-ROI Design System Improvements

Prioritized by **impact ÷ effort**, grounded in repository evidence. Impact = reduces fragmentation, enables scale. Effort = relative migration cost.

| Rank | Improvement | Impact | Effort | Evidence basis |
|------|-------------|--------|--------|----------------|
| 1 | Remove `App.css` `:root` token overrides; make `tokens.css` sole `:root` authority | Critical | Low | `App.css` L20–60 conflicts |
| 2 | Populate `DESIGN_SYSTEM_MASTER.md` with token primitive contracts | Critical | Low | File empty |
| 3 | Add `scripts/checkDesignTokenInvariants.ts` — fail CI on `:root` redefinition outside `tokens.css` | Critical | Medium | Pattern exists: `checkArchitectureInvariants.ts` |
| 4 | Define z-index scale in `tokens.css` (`--z-modal`, `--z-toast`, etc.) | Critical | Low | 1000–10070 chaos |
| 5 | Migrate auth modals to `Modal` primitive | High | Medium | Duplicate of leave modal shell |
| 6 | Migrate `LeaveGameModal` shell to `Modal` primitive | High | Low | Already uses `Button` |
| 7 | Migrate `GameOverModal` / `HandOverModal` to `Modal` primitive | High | Medium | Parallel overlay stacks |
| 8 | Deprecate `rh-go-btn-*` and `rh-leave-modal__btn` override classes | High | Low | Override primitive |
| 9 | Rename daily puzzle `rh-btn-home` → `dp-btn-home` to end collision | High | Low | Naming conflict |
| 10 | Unload `walnut-live.css` from global `main.tsx`; scope to legacy match routes only | Critical | Medium | `main.tsx` L21 |
| 11 | Extract match shell vars from walnut into `tokens.css` `--rh-match-*` | High | High | walnut vars L40–55 |
| 12 | Split `App.css` — extract `rh-screen-loader` to `components/ScreenLoader.css` | High | Low | L4609 buried |
| 13 | Split `App.css` — extract shell layout to `styles/app-shell.css` | High | Medium | 4,718 lines |
| 14 | Delete or migrate `.btn` / `.btn.primary` to `Button` primitive | High | Medium | `App.css` |
| 15 | Adopt `Button` on Friends screen | High | Low | 12 raw `<button>` |
| 16 | Adopt `Button` on Stats screens | High | Low | uses `.btn` |
| 17 | Adopt `Button` on Play vs Fritz setup | High | Medium | `pvf-start-btn` |
| 18 | Adopt `Button` on Ghost setup | Medium | Low | `ghostMode.css` |
| 19 | Adopt `Button` on Tournament hub/bracket/result | High | Medium | no primitive imports |
| 20 | Adopt `Button` on Daily Puzzle legacy/admin | High | Medium | 15+ raw buttons |
| 21 | Consolidate `LearnActionButton` into `Button` variants | High | Medium | parallel component |
| 22 | Map learn green accent to `tier-rookie` or new `variant="learn"` | Medium | Low | design doc accent rules |
| 23 | Add `Button variant="destructive"` using `--accent-red` | Medium | Low | tokens L20 |
| 24 | Export `Modal` with `initialFocusRef` + focus trap | High | Medium | a11y gap |
| 25 | Add `Modal size` prop (`sm`/`md`/`lg`/`fullscreen`) | Medium | Low | per-screen `maxWidth` hacks |
| 26 | Promote `GlassCard` to hub cards, side rails, mode options | High | Medium | 1 consumer today |
| 27 | Wire `StatValue` into score headers, leaderboards, hub stats | Medium | Low | zero adoption |
| 28 | Create `EmptyState` primitive (icon + title + body + CTA slot) | High | Medium | ad hoc empties |
| 29 | Create `LoadingState` primitive; move `ScreenLoader` CSS out of App | High | Low | single loader exists |
| 30 | Create `ErrorState` primitive for `DefaultErrorFallback` | Medium | Low | raw buttons today |
| 31 | Create `TextField` / `FormField` primitives for auth | High | Medium | bespoke auth inputs |
| 32 | Merge `authModal.css` + `leaveGameModal.css` shared shell into `Modal` skin | High | Medium | near-identical CSS |
| 33 | Merge hub tokens — `hubDesignTokens` + `socialHubTokens` → `tokens.css` `--hub-*` | High | Medium | parallel scopes |
| 34 | Add spacing scale to `tokens.css` (`--space-1`…`--space-8`) | High | Low | missing from SSOT |
| 35 | Add breakpoint tokens to `tokens.css` | High | Low | 4 ad hoc breakpoints |
| 36 | Document CSS load order contract in `DESIGN_SYSTEM_MASTER.md` | High | Low | 12 global imports |
| 37 | Introduce CSS `@layer` — tokens, primitives, features, overrides | Critical | High | no layering |
| 38 | Cap feature CSS file size via CI warning (e.g. 800 lines) | Medium | Low | dailyFritz 5,598 |
| 39 | Extract `dailyFritz.css` into hub / match / overlay modules | High | High | monolith |
| 40 | Extract `learnPlayer.css` into lesson / board / chrome modules | High | High | 1,632 lines |
| 41 | Migrate `claudeMode` to primitives or isolate behind dev flag | Medium | High | 1,399 lines |
| 42 | Adopt hub `HubViewportPage` on Friends + Stats | High | Medium | 4 importers only |
| 43 | Adopt `FilterPillRow` consistently across filter UIs | Medium | Low | duplicate filter pills |
| 44 | Standardize back navigation on `Button variant="ghost"` + icon | Medium | Low | `rh-back-button` |
| 45 | Remove `mode-inline-btn` in favor of `Button size="sm"` | Medium | Low | `App.css` |
| 46 | Replace `wl-control-btn` with board control primitive | High | High | walnut-live |
| 47 | Create `OverlayPortal` primitive wrapping z-index scale | High | Medium | `GameOverlayPortal.tsx` exists |
| 48 | Normalize pivotal review z-index to token scale | Medium | Low | 10055+ |
| 49 | Normalize `room-reactions` z-index 9999 to token | Medium | Low | `roomReactions.css` |
| 50 | Add `prefers-reduced-motion` to all primitive animations | High | Low | 3 matches total |
| 51 | Add global `focus-visible` baseline in `index.css` | High | Low | sparse focus |
| 52 | Remove `body` font override from `walnut-live.css` | High | Low | L14–16 |
| 53 | Align `index.css` body font to `var(--font-body)` | Medium | Low | system-ui default |
| 54 | Remove tier button gradients for matte solid rule | Medium | Low | `Button.css` + Agents.md |
| 55 | Audit `--tile-border` brown legacy; align to ivory tile spec | Medium | Low | `App.css` L45 |
| 56 | Consolidate `premium-theme.css` into token-driven home layout | Medium | Medium | 74 `!important` |
| 57 | Replace home `!important` height rules with flex shell contract | High | Medium | `premium-theme.css` L16–22 |
| 58 | Create `Card` primitive wrapping `GlassCard` + image surface slots | High | Medium | 10 card systems |
| 59 | Create `Badge` / `Pill` primitives from hub filter patterns | Medium | Medium | `FilterPillRow` |
| 60 | Create `Avatar` primitive from `PlayerInitialsAvatar` | Medium | Low | hub component exists |
| 61 | Document mode color identity in token semantic aliases | High | Low | design doc + tiers |
| 62 | Add `--color-mode-fritz`, `--color-mode-puzzle`, etc. | Medium | Low | Agents.md mode colors |
| 63 | Lint: no hex in TSX outside token fallback file | High | Medium | 49+ hex in HomeScreen |
| 64 | Lint: no new `!important` without exemption comment | Medium | Medium | 273 in walnut |
| 65 | Add Storybook or Ladle for primitives | High | Medium | no component catalog found |
| 66 | Add visual regression for Button/Modal variants | High | High | no design CI |
| 67 | Migrate daily puzzle ladder overlays to `Modal` | High | Medium | `DailyPuzzleLadderOverlays.tsx` |
| 68 | Migrate friend challenge card overlay to `Modal` | Medium | Low | `friendChallenge.css` |
| 69 | Migrate `MatchFoundOverlay` to shared overlay primitive | Medium | Medium | z-index 9999 family |
| 70 | Unify game-over overlays under `Modal variant="game-over"` | High | Medium | `App.css` `.game-over-overlay` |
| 71 | Extract `rotate-phone-overlay` to `RotateOverlay.css` | Low | Low | in App monolith |
| 72 | Create `IconButton` primitive (32×32 close, tray controls) | High | Medium | duplicated close buttons |
| 73 | Standardize modal close on `IconButton` | Medium | Low | `rh-modal-close` |
| 74 | Add `aria-labelledby` to all modals | Medium | Low | primitive uses `aria-label` only |
| 75 | Add live region primitive for toasts | Medium | Medium | toast patterns vary |
| 76 | Create `PageHeader` primitive from `HubPageHero` / `layout-screen-header` | High | Medium | duplicate heroes |
| 77 | Create `NavBar` contract doc from `GlobalNav.tsx` | Medium | Low | 18 aria matches |
| 78 | Reduce `racehorseJourney.css` duplication with journey sub-modules | Medium | High | 2,500+ lines |
| 79 | Align tournament CSS to PVF panel grammar | Medium | High | separate aesthetic |
| 80 | Align friends CSS to hub tokens | High | Medium | `friendsScreen.css` isolated |
| 81 | Align stats CSS to hub tokens | High | Medium | `statsScreen.css` z-index 1900 |
| 82 | Remove duplicate stats/friends page-shell z-index 1900 pattern | Medium | Low | same as auth |
| 83 | Document elevation/shadow usage — `--shadow-sm/md/lg` only | Medium | Low | multiple shadow dialects |
| 84 | Add `--radius-*` semantic aliases (`--radius-button`, `--radius-modal`) | Medium | Low | mixed 8/10/12/20px |
| 85 | Standardize modal radius 20px vs `--radius-card` 24px | Low | Low | auth/leave 20px |
| 86 | Create transition token scale beyond `--duration-fast` | Medium | Low | tokens L65–67 |
| 87 | Map `App.css` `--transition-fast/normal` to token motion | Low | Low | duplicate motion vars |
| 88 | Evaluate Tailwind — adopt fully or remove from `index.css` | Medium | Medium | hybrid confusion |
| 89 | If keeping Tailwind, restrict to layout utilities only | Medium | Medium | HomeScreen 55 utility matches |
| 90 | Add `rh-hub-page` wrapper to all social hub routes | High | Medium | partial adoption |
| 91 | Migrate `LeaderboardPageShell` to hub primitives | Medium | Medium | `ui/leaderboardPage.css` |
| 92 | Migrate `RatingHistoryPage` to hub primitives | Medium | Low | no primitive imports |
| 93 | Consolidate `multiplayerHubShell.css` + `multiplayerHubFeatures.css` tokens | Medium | Medium | separate files |
| 94 | Create board CSS import boundary — match screens only | High | Medium | global board index |
| 95 | Rename `walnut-live` classes to `rh-match-shell` (behavior preserved) | Medium | High | legacy naming debt |
| 96 | Add design-system exemption list for match/board CSS during migration | Low | Low | pragmatic rollout |
| 97 | Phase Y re-certification gate: Button primitive >60% adoption | High | Low | measurable |
| 98 | Phase Y re-certification gate: Modal primitive >50% adoption | High | Low | measurable |
| 99 | Phase Y re-certification gate: zero `:root` overrides outside tokens | Critical | Low | measurable |
| 100 | Schedule quarterly design-system audit with automated metrics dashboard | High | Medium | no recurring process |

---

## 10. Five-Year Maintainability Assessment

### Year 0 (today)

- **Strengths:** Clear PVF visual north star; `tokens.css` has mature match-board and image-treatment vars; `Button` primitive is production-quality; Journey proves Modal+GlassCard workflow; hub scaffold exists; `ScreenLoader` provides one shared suspense pattern.
- **Weaknesses:** Empty master doc; token authority broken; 5 parallel design dialects; 58k CSS lines for ~35 surfaces; no component catalog; no design CI; primitives adopted on minority of screens.

### Year 1 projection (status quo)

- Each new mode adds 1–3 CSS files (observed: daily Fritz, daily puzzle ladder, private lobby each added 1k+ lines).
- Button/modal duplication grows linearly with features.
- z-index incidents increase as overlay features stack (pivotal review already at 10070).
- Onboarding cost for UI engineers: **high** — must read design doc + guess which stack a screen uses.

### Year 3 projection (status quo)

- ~150+ CSS files, ~90k+ lines.
- Primitive adoption stagnates without enforcement — `Button` remains "the new screens button" while match/social/learn stay legacy.
- Visual drift between hubs (token-based) and match (walnut-based) becomes product-quality risk.
- Refactors require touching multiple CSS monoliths per screen change.

### Year 5 projection (status quo)

- **Unmaintainable without dedicated design-system team.**
- Any global token change requires auditing 100+ files for hardcoded overrides.
- New engineers cannot determine canonical patterns from code alone.
- Certification would remain **NOT READY**.

### Year 5 projection (if Top 20 improvements executed)

- Single token authority, z-index scale, Modal/Button majority adoption, walnut scoped/renamed, `App.css` decomposed, CI token lint.
- Estimated maintainability: **PRODUCTION DESIGN SYSTEM** candidate — still below World-Class without Storybook, visual regression, and full primitive coverage.

---

## 11. Comparison Against Reference Design Systems

Evidence-based gap analysis. Racehorse is compared on **system properties**, not product polish.

### Chess.com

| Dimension | Chess.com expectation | Racehorse evidence |
|-----------|----------------------|-------------------|
| Component catalog | Documented pieces (buttons, panels, modals) | 4 primitives; no Storybook |
| Token discipline | Consistent theme across game + lobby | `App.css` overrides `tokens.css` |
| Mode theming | Board vs lobby separation | walnut vs PVF vs hub — **unbounded** |
| **Gap** | Enterprise component library | Fragmented CSS families |

### Apple HIG

| Dimension | HIG expectation | Racehorse evidence |
|-----------|----------------|-------------------|
| Typography scale | Systematic dynamic type | 3 body font stacks |
| Motion accessibility | `prefers-reduced-motion` | 3 repo matches |
| Focus visibility | Consistent keyboard nav | ~15 CSS files with focus rules |
| Spatial rhythm | 8pt grid | `--space-*` only in App.css, not tokens |
| **Gap** | Accessibility + typographic system | Partial on newest screens only |

### Material Design 3

| Dimension | MD3 expectation | Racehorse evidence |
|-----------|----------------|-------------------|
| Semantic tokens | `on-surface`, `primary-container`, etc. | Tier vars exist; no semantic elevation/surface roles |
| Elevation levels | 0–5 dp scale | Ad hoc shadows per feature |
| State layers | Hover/focus/pressed opacities | Button primitive yes; elsewhere inconsistent |
| **Gap** | Semantic token taxonomy | Tier accents only |

### Stripe

| Dimension | Stripe expectation | Racehorse evidence |
|-----------|-------------------|-------------------|
| Minimal global CSS | Small core + components | 58.7k lines, 12 global imports |
| Form primitives | Unified inputs | Auth bespoke |
| Dashboard density discipline | Consistent spacing | Feature `clamp()` sprawl |
| **Gap** | Restrained global surface | CSS volume + `!important` density |

### Linear

| Dimension | Linear expectation | Racehorse evidence |
|-----------|-------------------|-------------------|
| Single aesthetic dialect | One visual language | 5+ parallel dialects |
| Fast iteration via components | High primitive reuse | 17% TSX primitive adoption |
| Subtle motion system | Unified easing | `--ease-premium` exists but not enforced |
| **Gap** | Cohesion at scale | Hub vs match vs learn divergence |

### Discord

| Dimension | Discord expectation | Racehorse evidence |
|-----------|-------------------|-------------------|
| Z-index layering | Centralized elevation map | 1000–10070 ad hoc |
| Modal stack | One dialog system | 9+ families |
| Dark theme tokens | One `:root` theme | Competing `:root` + scoped hubs |
| **Gap** | Overlay architecture | Pivotal review / reactions / auth conflicts |

---

## 12. Primitive Adoption Detail

### Button — 20 importing files

`HomeScreen`, `SinglePlayerHubScreen`, `DailyFritzHubView`, `DailyFritzLoadingScreen`, `DailyFritzArenaTrack`, `DailyModeProgressDeck`, `DailyPuzzleLadderHubView`, `RacehorseJourneyScreen`, `JourneyHomeEntryCard`, Journey modals (4), `MatchmakingScreen`, `MultiplayerModeController`, `PrivateMatchLobbyControlPanel`, `NoBrainerLabScreen`, `LeaveGameModal`, `GameOverModal`, `LearnHowToPlayRacehorse`.

**Override risk:** `leaveGameModal.css`, `GameOverModal.css`, `dailyFritz.css` restyle primitive classes.

### Modal — 5 importing files (all Journey)

`JourneyBriefingModal`, `JourneyChapterCompleteModal`, `JourneyPuzzleModal`, `InteractivePuzzleModal` (+ `racehorseJourney.css` overrides for interactive puzzle).

### Screens with zero primitive imports (non-exhaustive)

`FriendsScreen`, `StatsScreen`, `WeeklyStatsScreen`, `LeaderboardScreen`, `ActivityFeedScreen`, `PublicProfileScreen`, `PlayVsFritz`, `GhostSetupScreen`, `TournamentHubScreen`, `TournamentBracketScreen`, `TournamentResultScreen`, `DailyPuzzleScreen`, `DailyPuzzleLegacyInPlayView`, `DailyPuzzleAdminScreen`, `AuthModal`, `LiveMatchScreen`, `RatingHistoryPage`, `GameReviewer`, pivotal review components, most bot in-game views.

---

## 13. CSS Files That Override Token Definitions

| File | Override type |
|------|---------------|
| `App.css` | `:root` — radius, bg, text, shadows, spacing, motion |
| `premium-theme.css` | Home screen colors/sizes with `!important` |
| `hubDesignTokens.css` | Scoped parallel palette on `.rh-hub-page` |
| `socialHubTokens.css` | Scoped social hub palette |
| `walnut-live.css` | `--match-board-*`, tray heights, `body` font |
| `dailyFritz.css` | Feature-local colors, button overrides |
| `dailyPuzzle.css` | Feature-local colors, `rh-btn-*` collision |
| `claudeMode.css` | Parallel theme |
| `learn-pvf-theme.css` | Learn scope overrides |
| `match-live-theme.css` | 172 `!important` match overrides |

---

## 14. Naming Convention Conflicts

| Pattern | Conflict |
|---------|----------|
| `rh-btn` | Primitive (`Button.css`) vs daily puzzle (`rh-btn-home`) |
| `rh-modal-*` | Primitive vs leave modal (`rh-leave-modal__*`) |
| `walnut-*` / `wl-*` | Deprecated visual name, active global CSS |
| `pvf-*` / `df-*` / `pml-*` / `dp-*` | Feature prefixes — no namespace registry |
| `mode-*` | Home/lobby (`premium-theme.css`) vs generic mode |
| `hub-*` / `rh-hub-*` | Two hub token prefixes |

---

## 15. Re-Certification Criteria

To move from **NOT READY** → **READY WITH NOTES**:

1. `tokens.css` is sole `:root` authority (CI enforced)
2. `DESIGN_SYSTEM_MASTER.md` documents tokens, primitives, z-index, load order
3. Button primitive adoption ≥ 60% of interactive surfaces
4. Modal primitive adoption ≥ 50% of overlays
5. `walnut-live.css` not globally loaded; match vars migrated to `--rh-match-*`
6. z-index token scale adopted; no value > `--z-max` without exemption
7. `App.css` decomposed to < 1,000 lines (shell only)

To move to **PRODUCTION DESIGN SYSTEM**:

8. Full primitive set: Button, Modal, Card, TextField, EmptyState, LoadingState, IconButton, Badge
9. Component catalog (Storybook/Ladle) with visual regression
10. `prefers-reduced-motion` + focus-visible on all primitives
11. Feature CSS modules < 800 lines or split
12. Design-system CI lint (hex, `!important`, `:root` redefinition)

To move to **WORLD-CLASS DESIGN SYSTEM**:

13. Semantic token taxonomy (surface/on-surface/elevated)
14. Theming API for mode accents without per-feature CSS
15. Documented migration playbook with automated codemods
16. Quarterly audit automation with adoption metrics dashboard

---

## 16. Audit Methodology

- Read-only repository scan of `client/src/**/*.css`, `client/src/**/*.tsx`
- Primitive import grep across TSX
- Token definition comparison (`tokens.css` vs `App.css`)
- CSS load order from `main.tsx` and `App.tsx`
- Line counts via `wc` / `find`
- `!important`, `z-index`, `@media`, `focus-visible`, `prefers-reduced-motion` grep counts
- Cross-reference with `docs/agent-skills/racehorse-design-source-of-truth.md` and `Agents.md`
- No gameplay, networking, or multiplayer logic evaluated

---

## 17. Certification Statement

**Racehorse Dominoes UI Platform — Phase Y Design System Certification**

| Field | Value |
|-------|-------|
| **Certification** | **NOT READY** |
| **Design System Score** | 41 / 100 |
| **Enterprise 5-year readiness** | Failed — requires token authority restoration, primitive expansion, CSS decomposition, and deprecation of parallel stacks |
| **Strongest asset** | Documented PVF matte/neon direction + quality `Button` primitive |
| **Highest risk** | Global `walnut-live.css` + `App.css` token overrides + 9 modal z-index families |
| **Recommended next phase** | Execute improvements Rank 1–20 (Section 9) before feature UI expansion |

---

*Report generated from repository evidence only. No code was modified during this certification audit.*