# D5 follow-up — finishing the `multiplayer/runtime` migration

**Status:** investigation only, no code changed. `client/src/multiplayer/` is
CLAUDE.md-protected ("socket lifecycle code; do not restructure") — nothing
here touches it. Produced 2026-09-10 as the named next step after PR-5 (the
`useMultiplayerConnectionLifecycle` hook) was found to be a no-go — see
`consolidated-open-backlog-2026-09-10.md` row 20 and
`D5-app-tsx-decomposition-scoping.md`.

---

## 1. What already exists

`D5-app-tsx-decomposition-scoping.md` assumed App.tsx's ~25 multiplayer refs
were scattered raw state with no consolidation. That's stale. There is already
a full runtime-composition layer at `client/src/multiplayer/runtime/`:

- **`createMultiplayerRuntime(bootstrap)`** (`createMultiplayerRuntime.ts`) —
  the composition root. Takes one `MultiplayerRuntimeBootstrap` object (App.tsx's
  refs, gathered into one literal) and returns one frozen `MultiplayerRuntime`
  object, built exactly once per app session (throws if called twice).
- **`runtimeComposition.ts`** — ~13 `create*Runtime(bootstrap)` functions, each
  a pure re-grouping: `createRoomRuntime(bootstrap)` returns
  `{ roomIdentityRef: bootstrap.roomIdentityRef, roomPlayersRef: bootstrap.roomPlayersRef, ... }`
  — **the same ref objects by identity**, just organized by concern (room,
  reconnect, auth, joinFlight, recovery, gameplay, socket, navigation,
  tournament-attach).
- **`runtimeTypes.ts`** — typed slices for every concern
  (`MultiplayerRoomRuntime`, `MultiplayerReconnectRuntime`,
  `MultiplayerAuthRuntime`, `MultiplayerGameplayRefsRuntime`, …), plus narrower
  `Pick<...>` types for specific consumers
  (`MultiplayerConnectionRoomRuntime`, `MultiplayerConnectionReconnectRuntime`,
  `MultiplayerLiveMatchRoomRuntime`) — the "consumer reads a typed slice, not a
  flat prop bag" pattern is already designed in, just not universally adopted.
- **`runtimeProvider.tsx`** — `MultiplayerRuntimeProvider` + `useMultiplayerRuntime()`
  context hook, wrapping the whole render tree from App.tsx.
- **`useAppSessionRuntime.ts`** — marked `@deprecated`: *"Runtime slices are
  composed once in createMultiplayerRuntime — this hook only selects. Prefer
  useMultiplayerRuntime() + runtimeSelectors for new code."* **Nobody calls it**
  (grepped — zero call sites outside its own file). Dead code; a one-line
  deletion whenever someone's in the area, unrelated to the rest of this doc.

**The team already wrote the migration guidance.** This isn't a new idea —
it's finishing a direction the codebase states explicitly.

## 2. What "not migrated" actually means

App.tsx builds the bootstrap, calls `createMultiplayerRuntime`, and gets back
`multiplayerRuntime`. But **five consumer hooks, still called directly from
App.tsx, take individual raw refs as separate named params instead of a
runtime slice**:

| Hook | Where | Ref-shaped params (approx.) | Slice(s) that already cover them |
|---|---|---|---|
| `useMultiplayerResync` | `multiplayer/` (protected) | `socketRef`, `sessionRef`+`dispatchSession`, `roomIdentityRef`, `rejoinInFlightRef`, `applyJoinedRoomResponseRef`, `trySchedulePlayerReadyRef`, `roomOperationEpochRef` | `socket`, `session`, `room`, `controller.reconnect`, `recovery`, `gameplay` — **all exist** |
| `useMultiplayerRoomCallbacks` | `multiplayer/` (protected) | `pendingCreateResolversRef`, `maxSequenceRef`, `maxEventSequenceRef`, `roomMatchIdRef`, `roomOperationEpochRef`, `resyncBufferedUpdateRef`, `shellDelegatesRef`, `autoJoinAttemptedRef`, `appModeRef`, `joinedRoomResponseRef`, `roomPlayersRef`, `roomIdentityRef`, `youRef`, `socketRef`, `sessionRef`, … (biggest of the five) | Mostly `room` / `joinFlight` / `recovery` / `socket` / `session` — **but `maxEventSequenceRef`, `roomMatchIdRef`, `shellDelegatesRef`, `appModeRef` are App-local, in no runtime slice** |
| `useMultiplayerShellDelegates` | `multiplayer/` (protected) | `shellDelegatesRef` | not in the runtime — App-local |
| `useRegisterMatchmakingSocketHandlers` | `matchmaking/` (unprotected) | subset of room/reconnect refs | mostly covered |
| `useRegisterFriendsSocketHandlers` | `friends/` (unprotected) | small ref subset | mostly covered |
| `useRegisterTournamentSocketHandlers` | `tournament/` (unprotected) | small ref subset + `tournamentAttach` | `tournamentAttach` slice exists |

`useMultiplayerConnectionHostParams` is **not** part of this — it takes plain
values (booleans, strings, the live socket instance) and assembles `useMemo`d
config/state objects; it isn't a raw-ref consumer and doesn't need touching.

**Confirmed gaps** — refs referenced directly in App.tsx that exist in *no*
runtime slice today: `recoveryDispatchRef`, `maxEventSequenceRef`,
`roomMatchIdRef`, `applyRoomEventMetaRef`, `shellDelegatesRef`, `appModeRef`
(the last is really "App.tsx's own state mirror," arguably correct to keep
local). Migrating the hooks that touch these means either (a) leaving that one
param as an individual pass-through alongside the new slice param — fine, not
everything has to move — or (b) adding a field to `MultiplayerRuntimeBootstrap`
/ the relevant `*Runtime` type, which **is** a change to the protected module
and should be called out explicitly in whichever PR needs it, not slipped in.

## 3. Is this small-reviewable-commits, or all-or-nothing?

**Small-reviewable-commits, genuinely** — this is the opposite shape from
PR-5. Each hook conversion is independent:

1. Change the hook's param type from N individual `XRef` fields to a slice
   param (e.g. `{ room: MultiplayerRoomRuntime, reconnect: MultiplayerReconnectRuntime, ... }`,
   or just accept `MultiplayerRuntime` and destructure inside — either works,
   pick per-hook based on how many slices it needs).
2. Change the hook's internal body to read `room.roomIdentityRef` instead of a
   bare `roomIdentityRef` — same object identity, so **no runtime behavior
   changes**; this is a rename, not a rewire.
3. Update the one App.tsx call site to pass `multiplayerRuntime.room` (etc.)
   instead of spreading individual refs.
4. TypeScript proves the ref identities line up. The hook's own existing tests
   (if any — check per-hook) plus the relevant e2e (below) prove behavior is
   unchanged.

No hook-call-order change, no new effects, no change to
`MultiplayerRuntimeProvider`'s construction or `createMultiplayerRuntime`'s
singleton behavior. Each PR touches exactly one hook + its one call site.

**Suggested order (easiest / most isolated first):**

1. `useMultiplayerShellDelegates` — single ref, but it's App-local
   (`shellDelegatesRef` not in the runtime) — actually **skip this one**, moving
   a single already-local ref into a slice-shaped param has no payoff. Listed
   here to explain why it's excluded, not as a PR.
2. `useRegisterFriendsSocketHandlers`, `useRegisterMatchmakingSocketHandlers`,
   `useRegisterTournamentSocketHandlers` — smallest ref counts, live **outside**
   `client/src/multiplayer/` (in `friends/` / `matchmaking/` / `tournament/`),
   so these three don't even touch the protected directory. Good warm-up PRs.
3. `useMultiplayerResync` — moderate size, every ref it needs already has a
   home in an existing slice (no protected-module additions required). One PR.
4. `useMultiplayerRoomCallbacks` — the big one. Needs a decision per orphan ref
   (`maxEventSequenceRef`, `roomMatchIdRef`) — pass individually or add to the
   runtime. Do this last, once the pattern is proven on the smaller three.
5. Delete the dead `useAppSessionRuntime()` — one-line, unrelated, do whenever.

## 4. What could break / what to gate on

- **Ref identity must be preserved exactly.** A conversion must pass the same
  `MutableRefObject` instances through the slice, not copies — TypeScript
  won't catch a mistaken `{ ...current }` spread of a ref object; a manual
  identity check (or a one-line runtime assertion in dev) per converted hook is
  worth adding.
- **`client/src/multiplayer/` is CLAUDE.md-protected** — the 2 hooks that live
  there (`useMultiplayerResync`, `useMultiplayerRoomCallbacks`) still count as
  "restructuring" even though the change is mechanical; each PR should say so
  explicitly and get the same scrutiny as any other protected-dir change.
- **Coverage to gate on** (same as PR-5 would have needed):
  `multiplayer-in-match-reconnect.spec.ts` (5 two-seat scenarios) +
  `multiplayer-chaos.spec.ts` (6 resilience scenarios) + the MP Private
  Authority Soak job (2 waves) — all three already run on every PR and are
  green on main today. Green before/after each of the 4 real PRs is the bar.
- **`check:multiplayer-arch` / `check:multiplayer-cycles`** must stay clean —
  a slice param could in principle change the module import graph (e.g. if a
  hook outside `multiplayer/` starts importing a `runtimeTypes.ts` type it
  didn't before); low risk since the types already flow that direction, but
  verify per PR.
- **Net effect on App.tsx line count is small** — this is a legibility/
  consistency win (App.tsx call sites shrink from N named ref args to 1–2
  slice args), not a line-count win. It does NOT reduce the ~25 `useRef`
  declarations in App.tsx itself — those still have to exist and get bundled
  into `runtimeBootstrapRef.current`, because `createMultiplayerRuntime` still
  needs raw refs to build the runtime from. The payoff is entirely at the
  *consumer* call sites, not at the declaration site.

## 5. Recommendation

**Worth doing**, on the strength of "small, mechanical, TS-proven, real
coverage exists" — a genuinely different risk profile from PR-5. Not urgent:
it's a consistency cleanup finishing an already-declared direction, not a bug
fix or a blocker. Suggested scope if greenlit: PRs 2–3 from §3 (the three
register-handlers hooks + `useMultiplayerResync`) as a batch of small PRs,
report back, then a judgment call on whether `useMultiplayerRoomCallbacks`
(§3 step 4) is worth its extra orphan-ref decision-making or better left alone
given it's the one PR that still touches the protected directory with any real
size.
