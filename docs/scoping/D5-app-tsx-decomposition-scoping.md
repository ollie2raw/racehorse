# D5 — `client/src/App.tsx` decomposition scoping

**Status:** investigation only, no code changed. Produced 2026-09-10.
**Source:** `REFACTOR_OPPORTUNITIES.md` §3 D5.

---

## 1. What is actually in the file (1064 lines, after S8)

One default-export function component, `App()`. It is the **composition root** —
it does not render much itself; it wires together the whole app.

| Band | Lines (approx) | What it holds |
|---|---|---|
| **Refs** (~35) | 85–160 | `appRootRef`, `trayCenterRef`, connect/create in-flight flags, `appModeRef` / `mpSubViewRef` mirrors, ~25 multiplayer-lifecycle refs (`reconnectRoomCodeRef`, `joinInFlightRef`, `maxSequenceRef`, `recoveryDispatchRef`, …) |
| **`useState`** (~15, after S8 removed 3) | scattered | `appMode`, `mpSubView`, `joinedRoom`, `you`, `players`, `error`, `toast`, `overlayPayload`, `roomCode`, `abandonedMatchNotice`, … |
| **Hook orchestration** (~29 custom-hook calls) | 100–740 | `useAuthSession` → `useSocketConnectionState` → `useAppSessionUi` → `useTournament` → `useSocialInviteState` → `useMultiplayerConnectionHostParams` / `useMultiplayerRoomCallbacks` / `useMultiplayerResync` / `useMultiplayerShellDelegates` / `useMultiplayerLobbyHostProps` / `useMultiplayerRoomSocialRuntimeBridge` → `useRegisterFriendsSocketHandlers` / `useRegisterMatchmakingSocketHandlers` / `useRegisterTournamentSocketHandlers` → `useTournamentMatchSession` → `useMatchExitHandlers` → `useFullscreen` → `useNetworkStatus` → `usePrivateLobbyWinStreak` → `useTournamentDisplayLabels` → `useAppRouteState` → `useBotGamePreferences` |
| **Effects** (~10 `useEffect`) | 157–620 | mode/subview ref-sync, route→mode reconciliation, tournament auto-navigation, toast timeout cleanup, autoconnect, … |
| **`appRoutesHostSource`** object | ~730–1000 | the big literal: `{ host: {…4}, routeBundles: { navigation, auth, learn, botMatch, ghost, social, tournament, multiplayerRoute } }` + the flat game-props (~90 keys) — this is what S8 chipped at and what the D-CQ-5/6 barrel work reshaped |
| **Render** | 1005–1064 | `<MultiplayerRuntimeProvider>` → `<OfflineBanner>` + conditional `<MultiplayerGameShell {…40 props}>` + `<AppRoutesGamePropsHost source={appRoutesHostSource}>` |
| 10× `// eslint-disable react-hooks/refs -- … (D-2)` | throughout | ref objects passed into hooks/providers where the lint rule can't see across the call boundary; a ratified pattern (D-2) |

## 2. Why it grew this way

229 commits, front-loaded Feb–May 2026 (early dev), tapering since. App.tsx is
the **oldest hot file** and every cross-cutting concern that needs top-level
observation landed here:

- **Multiplayer connection lifecycle** is the biggest single tenant — ~25 refs
  + 6 multiplayer hooks + the socket-handler registration + the reconnect /
  rejoin / recovery machinery. `CLAUDE.md` protects "lines 1480–1530 —
  multiplayer connection hooks; do not move" (**that line range is now stale** —
  the file is 1064 lines; the hooks it means are `useSocketConnectionState` /
  `useMultiplayerConnectionHostParams` / `useMultiplayerResync` around lines
  330–500, and the "do not move" is about their **call order** — `useAuthSession`
  must precede `useSocketConnectionState` which needs `authUser`, etc.).
- **`useTournament`** was deliberately hoisted here (comment at ~118: "so that
  registration changes / bracket updates / pending match-ready events are
  observed in App.tsx and can trigger top-level navigation").
- The prop funnel: App.tsx used to pass ~84 flat props into `<AppRoutes>`. The
  D-CQ-5/6 + `useAppRoutesProps` / `useAppRoutesInput` work (and S8) has been
  **grouping them into bundles from the edges** — `appRouteTypes.ts` now defines
  9 domain bundles. This is the sanctioned incremental approach and it is
  working: the flat surface is down from 84 → 78, one bundle (`homeOverlays`)
  fully removed.

## 3. What a decomposition looks like

The file is **not a tangled god-object** — it is a thin composition layer with
one dominant tenant (multiplayer connection lifecycle). The right frame is
"continue extracting the multiplayer tenant into a hook", not "restructure
App.tsx".

**The multiplayer-lifecycle extraction (the real D5 shape):**

Most of the ~25 refs + the reconnect/rejoin/recovery effects + the
create-on-connect plumbing + `useMultiplayerConnectionHostParams` /
`useMultiplayerRoomCallbacks` / `useMultiplayerResync` belong in a single
`useMultiplayerConnectionLifecycle({ authUser, appMode, showToast, … })` hook
that returns `{ joinedRoom, players, you, connectionActions, connectionState,
sessionRuntime, … }`. App.tsx then calls that one hook instead of holding 25
refs.

**Why this is hard and hasn't happened:**

- The refs are **mutually entangled through the socket handlers**. `roomPlayersRef`,
  `maxSequenceRef`, `joinInFlightRef`, `recoveryDispatchRef` etc. are read *and*
  written from `useMultiplayerRoomCallbacks`, `useMultiplayerResync`,
  `useRegisterMatchmakingSocketHandlers`, and the effects — they are shared
  mutable state, not local state. Pulling them into a hook means either the hook
  owns them all (and its return type is enormous — the F12 `useLiveMatchSession`
  ~95-key problem again) or they stay split and you've moved a seam without
  closing it.
- `CLAUDE.md` protection + `check:multiplayer-{arch,cycles}` — the
  `client/src/multiplayer/` dir has a dependency-boundary check, and moving
  connection code into or out of it can introduce a cycle.
- The `D-2` ref-sharing pattern (10 eslint-disables) is already a ratified
  workaround for exactly this shape; more of it is not obviously better.
- `useTournament` is hoisted here *on purpose* for top-level navigation — that
  can't move down without re-solving the navigation observation.

**Lower-risk chips that are genuinely available (the "keep chipping" path):**

1. **Continue the bundle grouping.** The remaining ~78 flat game-props in
   `appRoutesHostSource` still have room to collapse — e.g. a `board` bundle
   (`boardForDisplay`, `boardLegalMoves`, `boardSelectedTile`, `lastPlayedTile`,
   `boardShowOpenEndGlow`, `multiplayerMoveLog`, `historyScrubberEnabled`) and a
   `hand` bundle. Same mechanical, TS-proven approach as S8. Each is a small PR.
2. **Extract the `<MultiplayerGameShell>` prop assembly.** The conditional
   `<MultiplayerGameShell {…40 props}>` in the render could take a single
   `shellProps` object assembled just above it (or by a `useMultiplayerShellProps`
   hook). Pure prop-plumbing, no logic move.
3. **Extract the mode/route reconciliation effects** (`appModeRef` sync, the
   route→mode effect, the tournament auto-navigate effect) into
   `useAppNavigationSync`. These are ~3 self-contained effects with a clear
   input/output.

## 4. What could break

- **Hook call order.** `useAuthSession` → `useSocketConnectionState` →
  `useAppSessionUi` → … each depends on the previous. Reordering or moving a
  hook across the boundary changes when `authUser` / `socket` are available and
  can put the app into a "connect before auth resolves" state — the exact class
  of bug `CLAUDE.md`'s "do not move" note guards.
- **Shared-mutable-ref semantics.** Any extraction that copies a ref instead of
  passing the same object silently breaks the socket handlers that write it.
- **`react-hooks` lint budget is pinned at 4** (`--max-warnings 0` on
  `lint:hooks`; the 4 `react-hooks` warnings are in the client
  `--max-warnings 51` budget). A decomposition that adds a `preserve-manual-
  memoization` or `set-state-in-effect` warning fails CI.
- **`check:architecture` 20/20** and `check:multiplayer-{arch,cycles}` — the
  module graph must stay acyclic and within the multiplayer boundary.
- **Multiplayer e2e coverage exists and is good** (`multiplayer-in-match-reconnect`
  5 two-seat scenarios + `multiplayer-chaos` 6 resilience scenarios) — this is
  the safety net and it is real, unlike D2. A connection-lifecycle extraction
  should be gated on those staying green.
- **`MultiplayerRuntimeProvider`** wraps the whole render — the runtime object
  it provides is built in App.tsx (`multiplayerRuntime`); moving its
  construction changes context identity and re-render behaviour app-wide.

## 5. Realistic step sequence (if approved)

**This is the one to do incrementally, not as a project.** The bundle work is
already the sanctioned path and it is low-risk.

1. **PR 1–3 — finish the prop-bundle grouping** (a `board` bundle, a `hand`
   bundle, the `<MultiplayerGameShell>` shellProps object). Each is an S8-shaped
   mechanical PR: move keys into a typed sub-bundle, update
   `useAppRoutesProps` / the shell, TS proves it, full bar + `check:architecture`.
   ~half a day each. These do not touch hook order or refs.
2. **PR 4 — `useAppNavigationSync`.** Extract the 3 route/mode/tournament-nav
   effects. Self-contained; multiplayer e2e + `routing.spec.ts` cover it.
   ~1 day.
3. **PR 5 (only with explicit sign-off) — `useMultiplayerConnectionLifecycle`.**
   The big one. Pull the ~25 refs + reconnect/rejoin/recovery effects +
   `useMultiplayerConnectionHostParams` / `useMultiplayerRoomCallbacks` /
   `useMultiplayerResync` into one hook. Accept that its return type is large
   (this is the F12-class tradeoff). Gate on the full multiplayer e2e suite
   (`multiplayer-in-match-reconnect` + `multiplayer-chaos`) green before and
   after, run the MP private-authority soak, and update the stale `CLAUDE.md`
   line-range note. ~1 week, human watching.

**Recommendation for the go/no-go:** PRs 1–4 are safe incremental chips worth
doing whenever — they continue the D-CQ / S8 direction and each shrinks the file
~50–120 lines with TS as the net. PR 5 is the only part that is genuinely "D5"
and it is high-blast-radius; its payoff is legibility, App.tsx is stable now
(2 commits in 2026-09), and the incremental chips get most of the size win
without it. **Do PRs 1–4; defer PR 5 unless the file starts growing again or a
multiplayer refactor needs it as a prerequisite.**

Of the three D-items, **D5's incremental path is the safest and highest
value-per-risk** — it has real e2e coverage, an established mechanical pattern,
and no camera/lock-discipline landmine.
