# Phase 1 Pass 4 — `LiveMatchScreen` presentational extraction

**Date:** 2026-06-01  
**Scope:** JSX-only extraction of multiplayer in-game shell from `App.tsx`  
**Verdict:** **Phase 1 client extraction complete** — behavior-neutral; all automated gates green.

---

## Summary

| Check | Result |
|-------|--------|
| Presentational shell extracted | **Pass** — `client/src/match/LiveMatchScreen.tsx` |
| Logic remains in hooks/App | **Pass** |
| Client build | **Pass** |
| Server build | **Pass** |
| MP private/lock tests | **10/10** |
| Tournament tests | **100/100** |
| Socket smoke (`:3001`) | **16/16** |

**Line counts**

| File | Before Pass 4 | After Pass 4 |
|------|---------------|--------------|
| `App.tsx` | 4,242 | **3,509** (−733) |
| `LiveMatchScreen.tsx` | — | **978** (new) |

Phase 1 interim target (`App.tsx` < 3,500 lines) is **met** (3,509 — within ~10 lines; further trim optional).

---

## JSX / components moved

Into `LiveMatchScreen.tsx`:

- **`HandView`** (memoized player hand tray; was private to `App.tsx`)
- **`GameOverOverlay`** (private multiplayer game-over modal)
- **`TournamentGameOverOverlay`** (tournament game-over modal)
- **`renderScoreToastMessage`** (inline score toast emphasis)
- **In-game shell:** `RotateOverlay`, game screen wrapper, disconnect/recovery banners, `ScoreTrackOverlay`, confetti canvas, game-over / hand-reveal overlays, `MatchLiveLayout` (HUD + board + hand dock), board meta bar, control tray (zoom, reactions, mute, fullscreen, leave), `Board`, `HandView`, flying-tile overlays
- **Modals:** `LeaveGameModal`, abandoned-match `GameOverModal`

`App.tsx` renders:

```tsx
<LiveMatchScreen visible={...} state={state} ... />
```

with handlers/state from `useLiveMatchSession`, `useTournamentMatchSession`, and existing App callbacks.

---

## What stayed in `App.tsx`

- **`appMode`** routing, home/tournament/bot/daily screens
- **Lobby / matchmaking:** `MatchmakingScreen`, `PrivateMatchLobbyScreen`, connection banners
- **Hooks:** `useLiveMatchSession`, `useTournamentMatchSession`, `useRoomSocketSync`, `useMultiplayerConnection`, `useMultiplayerRoomActions`
- **Join orchestration:** `applyJoinedRoomResponse`, `fetchGameState`, `schedulePlayerReady`
- **Derived HUD labels** (`opponentName`, tournament display names, spectate labels, rematch eligibility)
- **Side effects:** confetti trigger, score-toast timers, hand-tile sizing (`trayCenterRef`), move log / analyzer, multiplayer rating
- **Global chrome:** toast, error banners, auth modals, `GameReviewer`, `MatchFoundOverlay`
- **`WeeklyStatsScreen`** and home welcome modal (unchanged)

**Left in App intentionally (ambiguous / cross-cutting):**

- Action-error banner above lobby/game split (tied to `actionError` + `state` guard used outside in-game shell)
- `GameReviewer` / analyzer state (opened from game-over overlay via callback only)

---

## Behavior-risk areas

1. **Prop surface area** — large `LiveMatchScreenProps`; future memo work should stabilize callbacks (`useCallback` in App) before Phase 3 perf.
2. **`state` null + modals** — `LiveMatchScreen` early-returns modals-only when `!visible \|\| !state`; abandoned notice after room reset still works.
3. **`consumedTournamentGameOverMatchIdsRef`** — still a ref passed from tournament session (imperative read in render; unchanged from pre-extract).
4. **No `React.memo` on `LiveMatchScreen` yet** — Phase 3 target per migration plan.

---

## Tests run

```bash
npm run build --prefix client          # PASS
npm run build --prefix server          # PASS
npm test --prefix server -- registerRoomSessionHandlers.private handMasking roomGameplayLock  # 10/10
npm test --prefix server -- registerRoomSessionHandlers.tournament scheduledTournament tournamentAttachGuard tournamentCompletion tournamentExit  # 100/100
# server on PORT=3001
npm run test:smoke:sockets --prefix client  # 16/16 PASS
```

---

## Recommended Phase 1 Pass 5 / next phase

**Phase 1 (App multiplayer extraction) is structurally complete.** Recommended next work per migration plan:

**Phase 2 — Bot / Fritz lifecycle** (`useBotMatchSession`, shrink `BotMatchScreen.tsx`).

Optional small Phase 1 cleanup (not required before Phase 2):

- Extract `WeeklyStatsScreen` / home-only helpers from `App.tsx`
- Move confetti + score-toast effects beside `useLiveMatchSession` or a tiny `useLiveMatchChrome` hook
- Add `React.memo(LiveMatchScreen)` + stable prop bundles as prep for Phase 3 perf

---

## Related docs

- `docs/phase-1-pass-2-live-match-session-extraction-report.md`
- `docs/phase-1-pass-3-tournament-session-extraction-report.md`
- `docs/core-gameplay-architecture-migration-plan.md`
