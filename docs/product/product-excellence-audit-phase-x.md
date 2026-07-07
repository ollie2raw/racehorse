# Racehorse Product Excellence Audit — Phase X

**Date:** 2026-07-06  
**Role:** Principal Product Engineer · Principal UX Designer · Staff Frontend Engineer  
**Scope:** Entire user-facing product — read-only, repository evidence only  
**Reference bar:** Chess.com, Lichess, Riot Client, Discord, Supercell, Apple HIG, Material Design  
**Policy:** No code changes. Architecture assumed production-grade.

---

## 1. Executive Summary

Racehorse Dominoes is **not a prototype**. Flagship surfaces — **Daily Fritz**, **Daily Puzzle Ladder**, **Play vs Fritz setup**, **matchmaking arena**, and **Journey map** — reach **commercial-grade polish** in layout, motion, and competitive framing. The in-match experience (score race track, ivory tiles, sound design) supports a premium strategy identity aligned with `docs/agent-skills/racehorse-design-source-of-truth.md`.

The product **does not yet feel like one unified world-class application end-to-end**. Evidence shows **parallel design systems** (`tokens.css` vs `App.css` vs `walnut-live.css`), **orphaned onboarding** (welcome modal on unreachable legacy home), **missing Settings**, **placeholder competitive data** in match-found, **weaker social surfaces** (global leaderboard, stats-as-account), and **inconsistent guest CTAs**. A first-time player can play quickly via home daily cards, but **retention loops, progression, and account trust** lag Chess.com-class products.

### Chess.com litmus test

| Question | Verdict | Evidence |
|----------|---------|----------|
| Would a first-time player immediately understand what to do? | **Mostly yes** on new home | `HomeScreen.tsx` — hero daily cards + bottom mode tabs |
| Would a returning player feel rewarded? | **Partial** | Streak strip + weekly goal (`HomeScreen.tsx`); no achievements; learning profile stub (`profileProgress.ts` L6) |
| Would a competitive player keep playing? | **Yes in dailies/PvP** | Ladder hub, rated matchmaking, Glicko in nav; **no** deep match history/review for all modes |
| Would someone recommend to friends? | **Maybe** | Friends screen polished; match-found shows **fake stats** (`MatchFoundOverlay.tsx` L15–23) |
| Does every screen feel like the same app? | **No** | PVF/daily vs `rh-lb-*` / `stats-page-*` / `friends-page-*` |
| Anything feel like an internal tool? | **Yes, pockets** | Ghost diagnostics copy (`GhostSetupScreen.tsx`); bot malformed state; guided debug APIs in bundle |

### Final Verdict: **Commercial Quality**

**Not** Chess.com Quality or AAA Product Quality holistically. **Above** Indie Release Ready due to flagship mode polish. Suitable for **paid-feeling niche launch** with disclosed gaps; not yet a seamless global consumer platform.

---

## 2. Overall Product Score

### **72 / 100**

---

## 3. Category Scores

| Category | Score | Summary |
|----------|-------|---------|
| **UX Score** | **74** | Strong mode hubs; weak settings/account; silent API failures on home |
| **Visual Design Score** | **76** | PVF matte/neon reference executed well in dailies/bot; social stats diverge |
| **Accessibility Score** | **58** | Partial ARIA; clickable divs; uneven live regions; limited `prefers-reduced-motion` |
| **Mobile Score** | **70** | `RotateOverlay`, breakpoints in PVF/daily CSS; safe-area only in pockets |
| **First-Time User Score** | **62** | Welcome modal orphaned; username onboarding snoozable; How-to-Play exists but not default path |
| **Competitive Experience Score** | **75** | Rated queue, race track, pivotal review (bot); placeholder match-found stats |
| **Retention Score** | **68** | Daily streaks, weekly goal; no achievements; journey placeholders |

---

## 4. Design System Assessment

### Declared source of truth

`docs/agent-skills/racehorse-design-source-of-truth.md` — Play vs Fritz matte/neon panels, mode accent colors (gold Fritz, blue multiplayer, green learn).

### Reality in repository

| Layer | File | Coherence |
|-------|------|-----------|
| Tokens | `styles/tokens.css` | Declared canonical; **overridden** by `App.css` `:root` (radius, colors) |
| Primitives | `components/primitives/Button.tsx`, `Modal.tsx` | **~18** Button imports; Modal **Journey-only** |
| Legacy shell | `styles/walnut-live.css` | **Globally loaded** `main.tsx` L21 — structural, not visual direction |
| Feature CSS | 50+ mode stylesheets | Parallel button/modal families (**14+ button**, **9+ modal** patterns per audit) |
| Tailwind | `index.css` | Sporadic; not integrated with tokens |

### Consistency verdict: **Needs Polish → Needs Redesign (system layer)**

- **Colors:** Mode accents consistent in `GlobalNav.tsx` `TAB_COLORS`; **home Social tab** `#B8C7DA` vs nav `#0ea5e9` (`HomeScreen.tsx` vs `GlobalNav.tsx`)
- **Typography:** `tokens.css` Barlow/Outfit; **Avenir** on match routes via `walnut-live.css`
- **Buttons:** `rh-btn` primitive vs `.btn`, `pvf-start-btn`, `rh-btn-home` (daily puzzle — **not** primitive)
- **Modals:** `LeaveGameModal`, `GameOverModal`, `auth-modal`, `rh-modal-overlay`, Journey `Modal` — **no single dialog primitive adoption**
- **Loading:** Excellent duplicated screens (`DailyFritzLoadingScreen`, `DailyPuzzleLoadingScreen`); no shared `Loading` primitive
- **Cards:** `mode-option`, `pvf-*`, `claude-mode-panel`, `rh-glass-card` — parallel

`docs/design-system/DESIGN_SYSTEM_MASTER.md` is **empty** — no master doc beyond agent skill.

---

## 5. Screen-by-Screen Audit

Legend: **Production Ready** · **Needs Polish** · **Needs Redesign** · **Missing**

| Screen / Experience | Verdict | Evidence |
|---------------------|---------|----------|
| **Home (live)** | Needs Polish | `screens/HomeScreen.tsx`, `RacehorseHomeArt.css` — strong hero; silent `getHomeDailySummary` failure; unused `fritzStreak` state |
| **Home (legacy accordion)** | Needs Redesign | `AppRoutes.tsx` L907+ — unreachable at `/` (L164 wins); hosts welcome modal |
| **Landing** | N/A (SPA) | Hash router; home is app shell |
| **Global navigation** | Needs Polish | `GlobalNav.tsx` — solid HUD; friends error → 0; avatar → stats not profile |
| **Authentication** | Production Ready | `AuthModal.tsx`, `authModal.css` — verify flow, timeouts, Supabase gate |
| **Username onboarding** | Needs Polish | `UsernameModal.tsx`; 24h dismiss via `username_onboarding_dismissed` (`App.tsx`) |
| **Settings** | **Missing** | No `SettingsScreen`; `UsernameModal` copy promises "account settings" |
| **Profile (public)** | Production Ready | `PublicProfileScreen.tsx` — hero, H2H, error state |
| **Stats** | Needs Polish | `StatsScreen.tsx` — custom chrome, no GlobalNav; guest empty body |
| **Friends** | Needs Polish | `FriendsScreen.tsx` — strong layout; remove friend **no confirm**; guest text-only CTA |
| **Activity feed** | Needs Polish | `ActivityFeedScreen.tsx` — sign-in block without button |
| **Leaderboard (global)** | Needs Redesign | `LeaderboardScreen.tsx` — no retry; signed-out shows empty ranked list |
| **Play Online / Matchmaking** | Production Ready | `MatchmakingScreen.tsx` — arena, connection states, timeout |
| **Match Found overlay** | Needs Redesign | `MatchFoundOverlay.tsx` L15–23 — **placeholder** form/record/streak |
| **Private lobby** | Needs Polish | `PrivateMatchLobbyScreen.tsx` — PVF bridge; "Coming soon" tiles (`PrivateMatchLobbyControlPanel.tsx`) |
| **Live match** | Needs Polish | `LiveMatchScreen.tsx` — strong board; inline reconnect banners; `walnut-live` shell |
| **Spectator** | Needs Polish | Server projection `applySpectateProjection`; no dedicated spectator UX screen found |
| **Bot setup (PVF)** | Production Ready | `PlayVsFritz.tsx`, `PlayVsFritz.css` — reference design |
| **Bot match** | Needs Polish | `BotMatchScreenView.tsx` — high polish; `BotMatchMalformedStateView.tsx` dev-style |
| **Daily Puzzle (ladder)** | Production Ready | `DailyPuzzleLadderHubView.tsx`, loading, overlays |
| **Daily Puzzle (legacy)** | Needs Redesign | `DailyPuzzleScreen.tsx` — `claudeMode` + dash lobby split from ladder |
| **Daily Fritz** | Production Ready | `DailyFritzHubView.tsx`, `DailyFritzLoadingScreen.tsx` — best loading UX |
| **Daily Fritz leaderboard** | Production Ready | `DailyFritzLeaderboardScreen.tsx` |
| **Learn hub** | Needs Polish | `LearnHome.tsx` — locked/coming soon cards; clickable sections without button semantics |
| **How to Play** | Production Ready | `learnHowToPlayRacehorse.css`, immersive pager — strong onboarding asset |
| **Guided match** | Needs Polish | 9× `console.log` per click path in `usePlayerPlacementHandler.ts` (product noise if visible) |
| **Journey** | Needs Polish | `RacehorseJourneyScreen.tsx` — strong map; chapters 2+ `placeholder` actions |
| **Ghost setup** | Needs Polish | `GhostSetupScreen.tsx` — PVF parity; hardcoded featured ghost `'oliver'`; diagnostics copy |
| **Tournament hub** | Needs Polish | `TournamentHubScreen.tsx` — strong; withdraw without confirm |
| **Tournament bracket** | Needs Polish | `TournamentBracketScreen.tsx` — waiting room; plain loading text |
| **Tournament result** | Needs Polish | `TournamentResultScreen.tsx` |
| **No Brainer Lab** | Production Ready | `NoBrainerLabScreen.tsx` — confetti celebration |
| **Single Player hub** | Needs Polish | `SinglePlayerHubScreen.tsx` — "More modes coming soon" |
| **Match history** | **Missing** | No dedicated match history screen; placeholders in match-found |
| **Achievements** | **Missing** | No achievement subsystem in `client/src` |
| **Progression / XP** | **Missing** | `profileProgress.ts` L6 — types only |
| **Replay (product)** | **Missing** | Engine/snapshot replay plumbing exists; no user-facing replay browser |
| **Notifications** | **Missing** | Toast-only (`App.tsx` `showToast`); no notification center |
| **Loading (route)** | Production Ready | `ScreenLoader.tsx` — `aria-live`, branded rail |
| **Loading (auth modals)** | Needs Polish | `Suspense fallback={null}` on auth chunks |
| **Errors (route)** | Needs Polish | `ErrorBoundary.tsx` — inconsistent fallbacks (`DefaultErrorFallback` inline styles) |
| **Empty states** | Needs Polish | Strong in dailies; weak for guests on social/stats/leaderboard |
| **Offline / reconnect** | Needs Polish | Multiplayer banners in `LiveMatchScreen.tsx`; lifecycle policy (engineering) — user copy basic |
| **Leave game modal** | Production Ready | `LeaveGameModal.tsx` + primitive Button |
| **Game over** | Production Ready | `GameOverModal.tsx` — confetti in multiplayer shell |
| **Sounds** | Production Ready | `utils/sound.ts` — Web Audio + samples, documented |
| **Animations** | Needs Polish | Shimmer loaders duplicated; `prefers-reduced-motion` in `dailyFritz.css` only (partial) |

---

## 6. Biggest Product Weaknesses

1. **No unified account Settings** — users expect Chess.com-style account, audio, notifications, privacy (`UsernameModal` overpromises).
2. **Design system fragmentation** — 14+ button families; `App.css` clobbers tokens; `walnut-live` global legacy shell.
3. **Dual home / orphaned welcome** — production path skips first-run welcome (`AppRoutes.tsx` L164 vs L907).
4. **Placeholder competitive data in match-found** — undermines trust (`MatchFoundOverlay.tsx` L15–23, L251 "coming soon").
5. **Guest dead-ends** — Social, Friends, Stats, Leaderboard lack sign-in CTAs (`ActivityFeedScreen`, `FriendsScreen`, `LeaderboardScreen.tsx` L121).
6. **Social surface tier gap** — global leaderboard/stats not at Daily Fritz leaderboard polish tier.
7. **No achievements or long-term progression UI** — retention relies on dailies + streak only.
8. **Destructive actions without confirm** — friend remove, tournament withdraw.
9. **Accessibility gaps on primary CTAs** — PVF tier cards, Learn mode cards as `<div onClick>`.
10. **Internal-tool residue** — Ghost diagnostics, bot malformed view, guided debug APIs.

---

## 7. Highest ROI Improvements

| Rank | Improvement | Impact | Effort | Evidence driver |
|------|-------------|--------|--------|-----------------|
| 1 | Wire real stats to Match Found overlay | Trust | M | `MatchFoundOverlay.tsx` placeholders |
| 2 | Add Settings screen (audio, account, legal) | Trust / retention | M | No settings screen |
| 3 | Unify guest empty states with Sign In CTA | Conversion | S | Social/friends/stats/leaderboard |
| 4 | Move welcome onboarding to live home | FTUE | S | Orphaned `welcome-modal` branch |
| 5 | Consolidate modal primitive (leave, game over, auth) | Consistency | L | 9 modal families |
| 6 | Fix home API error surfacing (streak) | Trust | S | `HomeScreen.tsx` silent catch |
| 7 | Remove placeholder / dev copy from Ghost setup | Premium feel | S | `GhostSetupScreen.tsx` |
| 8 | Confirm dialogs for remove friend / withdraw | Safety | S | `FriendsScreen`, tournament screens |
| 9 | Adopt `Button` primitive on PVF tier/deal cards + a11y | A11y + consistency | M | `PlayVsFritz.tsx` |
| 10 | Retire legacy daily puzzle lobby path or restyle to ladder | Consistency | L | `DailyPuzzleScreen` claude dash |

---

## 8. Missing Features Compared to Chess.com

| Chess.com feature | Racehorse status | Evidence |
|-------------------|------------------|----------|
| Unified account & settings | **Missing** | No Settings screen |
| Game review for all rated games | **Partial** | Pivotal review (bot); analyzer exists; no universal history UI |
| Match history timeline | **Missing** | Placeholder in match-found only |
| Puzzles daily + archive | **Present** | Daily Puzzle Ladder + archive modal |
| Daily bot/challenge | **Present** | Daily Fritz |
| Ratings + leaderboards | **Present** | Glicko, multiple leaderboard screens |
| Friends + challenges | **Present** | `FriendsScreen`, private lobby, invites |
| Tournaments | **Present** | Scheduled tournament stack |
| Achievements / badges | **Missing** | No subsystem |
| Lessons / learn | **Present** | Learn hub, How to Play, guided |
| Spectator mode | **Partial** | Server spectate projection; no spectator product shell |
| Notifications center | **Missing** | Toast only |
| Mobile app | **Web only** | PWA not evidenced as first-class |
| Opening explorer / database | **N/A** | Dominoes-specific gap |
| Fair-play / report | **Missing** | No report flow found |
| Premium subscription UX | **Missing** | No paywall/subscription UI in repo |

---

## 9. Polish Opportunities

- **Micro-interactions:** Matchmaking search pulse exists; extend to hub card hovers consistently.
- **Success feedback:** Confetti in lab + multiplayer; standardize win moments across bot/daily/PvP.
- **Skeleton loaders:** Shimmer only on daily loading screens — add to leaderboard/profile lists.
- **Terminology:** "Racehorse" scoring vs "points" vs "pips" — audit copy consistency across modes.
- **Focus management:** Modal focus trap — primitive `Modal.tsx` exists but rarely used.
- **Safe area:** Extend `env(safe-area-inset-*)` beyond `App.css` and private lobby to all fixed footers.
- **Rotate overlay:** Hardcoded `#3d8eff` — align to mode tokens (`RotateOverlay` + `App.css`).
- **Toast system:** Single bottom toast (`App.tsx`) — no queue, no action buttons, no priority levels.
- **Weekly stats overlay:** Dead feature (`weeklyStatsOpen` never opened) — wire or remove.
- **Stats page:** Integrate `GlobalNav` for wayfinding parity.

---

## 10. Five-Year Product Assessment

**Strengths that age well**

- Clear mode identity (daily competitive loops are differentiated).
- Documented design direction (PVF as north star).
- Hub viewport / `100dvh` shell contract (`Agents.md` §6).
- Sound module isolation (`sound.ts`).
- Journey + Learn as long-term education moat.

**Risks over five years**

- CSS debt (`App.css` ~4.7k lines) will block velocity without primitive adoption mandate.
- `walnut-live` naming/structure confuses every new designer/engineer.
- Fragmented social tier will feel increasingly "bolted on" vs dailies.
- Placeholder/product debt (match-found) compounds brand distrust if not fixed pre-scale.
- Learning profile types without implementation (`profileProgress.ts`) — missed retention flywheel.

**Maintainability (product design):** Senior designer can extend **Daily Fritz / PVF** patterns today; **social/settings** require net-new system work.

---

## 11. Retention & Motivation Assessment

| Mechanism | Status | Evidence |
|-----------|--------|----------|
| Daily Fritz | **Strong** | Fixed daily set, leaderboard, streak on home |
| Daily Puzzle | **Strong** | Ladder slots, archive, competitive copy |
| Streak / weekly goal | **Present** | `HomeScreen.tsx` streak strip, `currentStreakCount` |
| Achievements | **Missing** | — |
| Journey progression | **Partial** | Map UX strong; content placeholders |
| Learning profile | **Missing** | `profileProgress.ts` L6 |
| Rated multiplayer | **Present** | Matchmaking, Glicko in nav |
| Friend rivalry | **Present** | H2H on friends/profile |
| Celebration | **Partial** | Confetti (lab, MP game over); not universal |
| Failure fairness | **Moderate** | Coach panels (bot/learn); sparse in PvP copy |

**Would players return tomorrow?** **Yes** for daily puzzle/Fritz habitués. **Uncertain** for pure PvP users without match history/progression depth.

---

## 12. Onboarding Assessment

| Step | Friction | Evidence |
|------|----------|----------|
| Land on product | Low | Home daily cards visible immediately |
| Understand dominoes | Medium-low | How to Play exists (`learnHowToPlay*` CSS); not auto-shown on live home |
| First match | Low–medium | PVF one tap; rated MP requires auth + queue |
| Account creation | Medium | Sign up → verify email → username modal (dismissible 24h) |
| Competitive rules | Medium | Racehorse scoring taught in Learn; not gated before rated play |

**Time to first match:** **< 2 minutes** (Play vs Fritz or Daily Puzzle guest paths). **Rated online:** auth + queue adds friction.

---

## 13. Premium Feel Assessment

**Feels like a professional studio:** Daily Fritz hub, PVF setup, Puzzle ladder hub, Matchmaking arena, Journey map, Friends split-pane, branded loading screens.

**Feels like indie prototype:** Global social leaderboard, bot malformed error, Ghost diagnostics block, legacy accordion home, match-found fake stats, stats page modal chrome, Learn completion modal with orphaned CSS classes (`LearnPlayer.tsx` / missing `rh-modal__*`).

**Premium identity alignment:** Strong where PVF grammar applied; weak where `claude-mode` / `rh-lb` / inline styles persist.

---

## 14. Accessibility Snapshot

| Criterion | Status | Evidence |
|-----------|--------|----------|
| ARIA labels | Partial | ~80 files with `aria-label`/`role=`; gaps on PVF cards, leaderboard rows |
| Keyboard | Partial | Ghost opponent picker, PVF slider; not Learn/PVF tier cards |
| Focus visible | Sparse | `Button.css`, some lobby CSS; not global |
| Live regions | Partial | `ScreenLoader`, Daily Fritz loading, matchmaking search; not reconnect banners |
| Reduced motion | Partial | `dailyFritz.css`; not app-wide |
| Color contrast | Generally good on PVF/dark shells | Not formally audited in repo |
| Touch targets | Generally adequate on hubs | Private lobby dense on small breakpoints |

**Accessibility Score rationale:** 58 — effort visible in flagship modes; not systematic.

---

## 15. Mobile & Responsive Snapshot

| Pattern | Evidence |
|---------|----------|
| Viewport-locked shell | `Agents.md` §6 — `100dvh`, overflow hidden |
| Breakpoints | `_pvf-layout.css` 1100/640; `dailyPuzzle.css` extensive; `botMatch.css` down to 380px |
| Landscape guard | `RotateOverlay` on match screens |
| Safe area | `App.css`, `privateMatchLobby.css` — not universal |
| Hand tile scaling | `useResponsiveHandTileSize.ts` (daily puzzle) |

**Mobile Score rationale:** 70 — playable; competitive layout work invested; not Apple HIG-level consistency.

---

## 16. Final Verdict

# **Commercial Quality**

Racehorse is ready to **ship as a commercial niche strategy product** with flagship daily and bot experiences that justify premium positioning. It is **not** Chess.com Quality: unified account UX, universal game review, achievements, notifications, and social/competitive trust details remain gaps.

**Upgrade path to Chess.com Quality:** Settings + real competitive data everywhere + single design system + FTUE on live home + guest conversion fixes + achievements/progression + match history.

---

## 17. Prioritized Roadmap — Top 100 Product Improvements

Ranked by **impact ÷ effort** (1 = highest ROI). Effort: **S** ≤2 days, **M** ≤2 weeks, **L** >2 weeks.

### Tier 1 — Critical trust & conversion (1–15)

| # | Improvement | I | E |
|---|-------------|---|---|
| 1 | Replace Match Found placeholder stats with live API data | H | M |
| 2 | Add Settings screen (audio/mute, account, password, sign out, legal) | H | M |
| 3 | Add Sign In CTA buttons on guest empty states (feed, friends, stats, leaderboard) | H | S |
| 4 | Surface welcome / product tour on live `RacehorseHomeScreen` | H | S |
| 5 | Show error + retry when home daily summary API fails | H | S |
| 6 | Remove Ghost "diagnostics" dev copy from player UI | H | S |
| 7 | Confirm modal before friend remove | H | S |
| 8 | Confirm modal before tournament withdraw | H | S |
| 9 | Fix leaderboard signed-out empty state → sign-in prompt | H | S |
| 10 | Stop GlobalNav showing 0 friends on API error (show retry/unknown) | M | S |
| 11 | Align Social tab color home vs GlobalNav | M | S |
| 12 | Remove or wire `weeklyStatsOpen` dead feature | M | S |
| 13 | Delete unreachable legacy accordion home or redirect to one home | M | M |
| 14 | Replace featured ghost hardcode `'oliver'` with dynamic/curated list | M | S |
| 15 | Add `aria-label` + keyboard to PVF tier/deal selection cards | M | M |

### Tier 2 — Design system unification (16–35)

| # | Improvement | I | E |
|---|-------------|---|---|
| 16 | Namespace or remove `App.css` `:root` token overrides | H | M |
| 17 | Adopt `Button` primitive across top 10 screens | H | L |
| 18 | Unify leave/abandon overlay (reuse `LeaveGameModal` in `MultiplayerModeController`) | M | S |
| 19 | Single `Dialog` primitive for auth, leave, game over, daily overlays | H | L |
| 20 | Extract shared `LoadingScreen` from Fritz/Puzzle loaders | M | M |
| 21 | Document design system in non-empty `DESIGN_SYSTEM_MASTER.md` | M | S |
| 22 | Rename/document `walnut-live` as layout-only shell | M | S |
| 23 | Consolidate global leaderboard onto `LeaderboardPageShell` | H | M |
| 24 | Add `GlobalNav` to Stats screen | M | S |
| 25 | Fix Learn completion modal missing `rh-modal__*` styles | M | S |
| 26 | Unify error fallbacks to one `ErrorFallback` component | M | M |
| 27 | Deprecate `.btn` / `mode-inline-btn` in favor of `rh-btn` | M | L |
| 28 | Standardize back button component | M | M |
| 29 | Unify toast into accessible live region component | M | M |
| 30 | Z-index token scale for overlays | M | S |
| 31 | Typography: enforce Outfit/Barlow; remove Avenir override on match routes | M | M |
| 32 | Radius/spacing: single token source | M | M |
| 33 | Restyle legacy Daily Puzzle lobby to ladder PVF grammar | H | L |
| 34 | Bot malformed state → branded error card | M | S |
| 35 | Rotate overlay colors from tokens | L | S |

### Tier 3 — First-time & learnability (36–50)

| # | Improvement | I | E |
|---|-------------|---|---|
| 36 | First-visit How to Play prompt on home (skippable) | H | M |
| 37 | Explain Daily Fritz auth requirement on card for guests | M | S |
| 38 | Reduce username onboarding steps (merge verify + handle where possible) | M | M |
| 39 | Add "Play your first match" guided path (bot default) | H | M |
| 40 | Dominoes basics tooltip on first board render | M | M |
| 41 | Racehorse scoring explainer before first rated match | H | M |
| 42 | Private lobby rules tooltip for new hosts | M | S |
| 43 | Tournament registration explainer modal | M | S |
| 44 | Journey ch.1 mandatory brief before map (already partial) — extend quality | M | M |
| 45 | Replace Journey placeholder chapters with real content or hide | M | L |
| 46 | Learn locked cards: clearer unlock requirements | M | S |
| 47 | Add keyboard navigation to Learn hub mode cards | M | M |
| 48 | Post-signup success screen with next action (Daily Fritz / Puzzle) | M | M |
| 49 | Supabase misconfig banner on live home (like legacy home) | M | S |
| 50 | Auth modal loading skeleton (not `null` suspense) | M | S |

### Tier 4 — Competitive & retention (51–70)

| # | Improvement | I | E |
|---|-------------|---|---|
| 51 | Match history screen (rated + daily) | H | L |
| 52 | Achievements system (daily complete, streak, first win, etc.) | H | L |
| 53 | Implement learning profile persistence (`profileProgress.ts`) | H | L |
| 54 | XP / level display on profile | M | L |
| 55 | Post-game "Play again" / "Daily tomorrow" retention CTAs | H | M |
| 56 | Streak loss warning before midnight | M | M |
| 57 | Weekly recap email/push (product spec + UI entry) | M | L |
| 58 | Friend challenge success celebration | M | M |
| 59 | Rated win streak display (real, not placeholder) | H | M |
| 60 | Pivotal review prompt on close bot losses | M | S |
| 61 | Extend pivotal review to live MP (where allowed) | M | L |
| 62 | Spectator mode UX shell | M | L |
| 63 | Replay viewer for completed bot/daily hands | M | L |
| 64 | Share card polish pass (mobile share QA) | M | M |
| 65 | Daily Puzzle perfect solve celebration | M | S |
| 66 | Daily Fritz set complete cinematic | M | M |
| 67 | Tournament placement ceremony screen | M | M |
| 68 | Rating change animation on profile after match | M | M |
| 69 | Hub "continue where you left off" card | H | M |
| 70 | Notification center (friend online, challenge, daily reminder) | H | L |

### Tier 5 — Social & community (71–82)

| # | Improvement | I | E |
|---|-------------|---|---|
| 71 | Report player flow | H | M |
| 72 | Block/mute from profile | H | M |
| 73 | Friend invite rate limit UX messaging | M | S |
| 74 | Activity feed sign-in CTA button | M | S |
| 75 | Profile → settings entry | M | S |
| 76 | Leaderboard retry on error | M | S |
| 77 | Leaderboard row aria-labels | M | S |
| 78 | Public profile share link | M | M |
| 79 | Club/team placeholder roadmap or hide | L | S |
| 80 | Emote/reaction tutorial in first MP match | M | S |
| 81 | Private lobby friend picker empty state polish | M | S |
| 82 | H2H stats prominence on friend preview | M | S |

### Tier 6 — Mobile, a11y, performance perception (83–92)

| # | Improvement | I | E |
|---|-------------|---|---|
| 83 | Global `prefers-reduced-motion` | M | M |
| 84 | Reconnect/disconnect banners as `role="status"` | M | S |
| 85 | Safe-area on all fixed bottom bars | M | M |
| 86 | Focus trap on all modals | M | M |
| 87 | Skeleton lists on friends/leaderboard loading | M | M |
| 88 | Matchmaking CTA `aria-busy` while connecting | M | S |
| 89 | Live match joining shell (not blank wait) | M | M |
| 90 | Reduce layout shift on GlobalNav rating load | M | S |
| 91 | Touch target audit on 640px breakpoints | M | M |
| 92 | PWA install prompt / add to home | M | L |

### Tier 7 — Polish & delight (93–100)

| # | Improvement | I | E |
|---|-------------|---|---|
| 93 | Standardize win confetti across bot/daily/MP | M | M |
| 94 | Tile place haptic (mobile vibrate) optional in settings | L | S |
| 95 | Page transition fade between hubs | M | M |
| 96 | Empty boneyard / pass micro-feedback | M | S |
| 97 | Opponent turn indicator polish in MP | M | M |
| 98 | Remove "coming soon" from private lobby or ship features | M | M |
| 99 | Match found "Per-match stats coming soon" → ship or hide | M | S |
| 100 | Rewrite root `README.md` for product onboarding (DX/product doc) | M | S |

---

## Verification Log

Read-only inspection of:

- `client/src/screens/`, `AppRoutes.tsx`, `App.tsx`, `GlobalNav.tsx`
- Mode directories: `bot/`, `dailyFritz/`, `dailyPuzzle/`, `matchmaking/`, `match/`, `tournament/`, `learn/`, `ghost/`, `journey/`, `social/`, `friends/`, `stats/`
- Design: `styles/tokens.css`, `App.css`, `premium-theme.css`, `walnut-live.css`, `components/primitives/`
- Docs: `racehorse-design-source-of-truth.md`, `DESIGN_SYSTEM_MASTER.md` (empty)
- Onboarding: welcome modal wiring, `profileProgress.ts`, `MatchFoundOverlay.tsx`

No production code modified.

---

## Files Changed (this pass)

| File | Change |
|------|--------|
| `docs/product/product-excellence-audit-phase-x.md` | **Created** — Phase X product excellence audit |

---

*Phase X complete. Verdict: **Commercial Quality** — flagship daily/bot/competitive surfaces are launch-grade; platform cohesion, account UX, social tier, and Chess.com-class retention systems require the roadmap above.*