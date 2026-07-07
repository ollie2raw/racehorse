# Phase 2 — Player vs Player Architecture Extraction Plan (Implementation-Ready)

**Document type:** Principal engineer implementation roadmap  
**Date:** 2026-07-04  
**Prerequisite:** [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md) (Phase 1)  
**Stance:** Targeted entanglement extractions only — not refactor-for-size, event buses, or DI  
**Contrast reference:** [bot-match-architecture.md](./bot-match-architecture.md)

---

## Executive Summary

This plan sequences architectural phases to bring PvP client architecture toward Bot Match standards. Every phase maps to a documented `ENTANGLEMENT` marker (E2–E11) or High issue (H-1–H-5) from the Phase 1 audit.

**Recommended execution:** Phases 0, A, B, H, and D only. Defer E, F, G until a dedicated multiplayer hardening sprint. Reject J, L, M and all size-only splits.

---

## Current State (Verified LOC)

| File | LOC | Role |
|------|-----|------|
| `App.tsx` | 1,589 | Integration kernel (E2–E11) |
| `useLiveMatchSession.ts` | 1,099 | Session god hook (H-2) |
| `MultiplayerGameShell.tsx` | 1,037 | Shell + analyzer + move log |
| `useTournamentMatchSession.ts` | 1,110 | Tournament attach (domain, not duplicate gameplay) |
| `useMultiplayerConnection.ts` | 840 | Socket + recovery wiring |
| `useRoomSocketSync.ts` | 723 | Socket handlers + draw animation |
| `recoveryMachine.ts` | 665 | FSM (well-tested) |
| `useMultiplayerRoomActions.ts` | 534 | Lobby room actions (**already extracted**, consumed via `useMultiplayerLobbyController`) |
| `useAppSessionRuntime.ts` | 207 | Ref bundling only (E11 — **not** ownership resolution) |

**Bot Match contrast:** `BotMatchScreen.tsx` is 8 LOC; runtime lives in `modules/*` with a thin `useBotMatchScreenController`. PvP has partial decomposition (`MultiplayerConnectionHost`, `AppRoutesGamePropsHost`, `multiplayerGameSnapshot`, `useMultiplayerLobbyHostProps`) but **authoritative orchestration still lives in `App.tsx`**.

---

## Phase 0 — PvP Client Test Harness (Prerequisite Gate)

| Field | Detail |
|-------|--------|
| **Objective** | Add automated coverage for the client paths that currently ship without CI signal (H-4). |
| **Why it exists** | Server has 15+ multiplayer test files; client has only `recoveryMachine.behaviorTests.ts` and `multiplayerRuntime.test.ts` (normalize players). Any extraction of `useLiveMatchSession` or `App.tsx` without this is reckless. |
| **Files touched** | **New:** `multiplayer/socketGuards.test.ts`, `multiplayer/boardSnapshotGuards.test.ts`. **Extend:** `recoveryMachine.behaviorTests.ts` (RESYNC_NEEDED while `joining` — test already exists at line 249, add integration-level caller test). **Optional:** `multiplayer/useMultiplayerResync.behaviorTests.ts` (written before Phase A merge). |
| **Estimated LOC moved** | 0 moved; ~180–250 new test LOC |
| **Expected risk** | Low |
| **Regression surface** | None (tests only) |
| **Tests required before merge** | New tests pass; `npm run test:all --prefix client` green |
| **Rollback strategy** | Delete new test files |
| **Dependencies** | None |
| **Runtime behavior change** | No |

---

## Phase A — Resync Ownership Extraction (E6 / H-3 structural)

| Field | Detail |
|-------|--------|
| **Objective** | Move `fetchGameState`, resync refs (`resyncInFlightRef`, `resyncCooldownUntilRef`, `resyncBufferedUpdateRef`, `resyncFlushRef`, `fetchGameStateRef`), and quick-match stall watchdog (App.tsx ~930–940) into `multiplayer/useMultiplayerResync.ts`. |
| **Why it exists** | E6: resync requires `socketRef` + `roomIdentityRef` + live auth identity. Today `App.tsx` owns this; `useRoomSocketSync` calls `fetchGameState('sequence_regression')` etc. through App-injected callbacks. Ownership is untestable and entangled with unrelated App concerns. |
| **Files touched** | **New:** `multiplayer/useMultiplayerResync.ts` (~110–130 LOC). **Modify:** `App.tsx` (−~75 LOC), `multiplayer/multiplayerRuntime.ts` (resync runtime types), `multiplayer/useMultiplayerConnectionHostParams.ts`, `multiplayer/MultiplayerGameShell.tsx` (ref plumbing), `match/session/liveMatchSessionTypes.ts` |
| **Estimated LOC moved** | ~90–110 out of App |
| **Expected risk** | Medium |
| **Regression surface** | Reconnect resync (`recovery_machine` path), sequence regression → resync, `quick_match_stall` watchdog, `resyncFlush` after join ack |
| **Tests required before merge** | Phase 0 tests; manual: disconnect → reconnect mid-lobby |
| **Rollback strategy** | Revert `useMultiplayerResync.ts`; restore inline `fetchGameState` in App |
| **Dependencies** | Phase 0 |
| **Runtime behavior change** | **No** — structural move only; preserve current indirect `RESYNC_NEEDED` dispatch for `reason !== 'recovery_machine'` |

---

## Phase B — Resync Queue Correctness Fix (H-3)

| Field | Detail |
|-------|--------|
| **Objective** | Fix the documented no-op: when `fetchGameState(reason)` dispatches `RESYNC_NEEDED` while recovery machine `state !== 'idle'`, the event is dropped (`recoveryMachine.ts:395–398`, already tested in `testResyncNeededOnlyFromIdle`). Queue pending resync requests and flush when machine returns to `idle`, or bypass machine for direct resync when `resyncInFlightRef` is set. |
| **Why it exists** | H-3 is the only proven client correctness hazard. `useRoomSocketSync` has 8 `fetchGameState` call sites; callers receive `true` from indirect path even when resync was dropped. |
| **Files touched** | `multiplayer/useMultiplayerResync.ts`, `multiplayer/recoveryMachine.ts` OR resync coordinator in connection layer, `multiplayer/useMultiplayerConnection.ts` (effect handler for queued resync) |
| **Estimated LOC moved** | ~35–55 new logic LOC |
| **Expected risk** | Medium–High |
| **Regression surface** | Stale `state:update` during `joining`/`resyncing`, hand-identity mismatch during reconnect, double-resync |
| **Tests required before merge** | Behavior test: `fetchGameState('sequence_regression')` while machine in `joining` → resync eventually executes. Existing `resyncBufferedUpdateRef` path must still work. |
| **Rollback strategy** | Revert queue logic; keep Phase A extraction |
| **Dependencies** | Phase A |
| **Runtime behavior change** | **Yes** — intentional correctness fix |

---

## Phase C — Shell Bridge Pending-Update Queue (H-5)

| Field | Detail |
|-------|--------|
| **Objective** | Prevent dropped updates when `gameShellBridgeRef.current` is null during early connection / pre-mount window. `useMultiplayerShellDelegates` uses optional chaining on every setter (`shellBridgeRef.current?.setState`). |
| **Why it exists** | H-5: connection layer can call `shellSetState` before `MultiplayerGameShell` mounts bridge (`MultiplayerGameShell.tsx:1002–1007`). Conditional render: shell only mounts when `joinedRoom` is truthy (`App.tsx:1501`), but connection recovery can fire before join completes. |
| **Files touched** | `multiplayer/useMultiplayerShellDelegates.ts`, `multiplayer/MultiplayerGameShell.tsx`, possibly `multiplayer/shellBridgeQueue.ts` (~40 LOC) |
| **Estimated LOC moved** | ~50–70 |
| **Expected risk** | Medium |
| **Regression surface** | Join handshake state projection, reconnect setState before remount, rematch state |
| **Tests required before merge** | Unit test: delegate called before bridge attach → flushed on attach. No duplicate state application. |
| **Rollback strategy** | Revert queue; restore optional-chaining delegates |
| **Dependencies** | Phase 0 |
| **Runtime behavior change** | **Yes** — edge-case fix (arguably correctness, not cosmetic) |

**Alternative (reject if no repro):** Document invariant "shell mounts before `ROOM_JOIN_OK` effects run" and skip Phase C. Only justified if Sentry shows no pre-mount drops.

---

## Phase D — Join Ack Coordinator (E5 + player:ready)

| Field | Detail |
|-------|--------|
| **Objective** | Extract `applyJoinedRoomResponse` (~75 LOC), `schedulePlayerReady` (~25 LOC), `trySchedulePlayerReady` (~15 LOC), `applyRoomEventMeta` (~15 LOC), `emitCreateRoom` (~30 LOC) from App into `multiplayer/useMultiplayerJoinCoordinator.ts`. App retains thin injected callbacks: `onShellProject`, `onTournamentAttach`, `dispatchRecovery`. |
| **Why it exists** | E5: join ack projects roster + shell bridge + tournament metadata in one callback. This is the highest-frequency multiplayer code path and the reason `useMultiplayerRoomActions` (already 534 LOC) cannot absorb it — it lacks shell/tournament ports. |
| **Files touched** | **New:** `multiplayer/useMultiplayerJoinCoordinator.ts` (~170–190 LOC). **Modify:** `App.tsx` (−~170), `useMultiplayerConnection.ts`, `useMultiplayerLobbyHostProps.ts`, `match/session/useTournamentMatchSession.ts` (refs) |
| **Estimated LOC moved** | ~170–190 |
| **Expected risk** | High |
| **Regression surface** | Room create/join, invite deep-link, tournament attach on join, `player:ready` quick-match 2-player gate, hand-identity mismatch resync trigger |
| **Tests required before merge** | Coordinator unit tests with mocked `MultiplayerGameShellBridge` + tournament attach callback. Server join tests as backstop. |
| **Rollback strategy** | Revert coordinator; inline callbacks in App |
| **Dependencies** | Phase A (resync from join), Phase C recommended |
| **Runtime behavior change** | No |

---

## Phase E — Room Teardown Coordinator (E4)

| Field | Detail |
|-------|--------|
| **Objective** | Extract `resetMultiplayerRoomState`, `resetClientGameSession`, `clearRecoverableRoomState`, `resetRoomRecoveryState` into `multiplayer/useMultiplayerRoomTeardown.ts`. Preserve atomic teardown contract: room + tournament match + shell bridge + sequence refs clear together. |
| **Why it exists** | E4: partial extraction already caused bugs per comment — "Moving room reset without shell/tournament setters leaves stale match UI." Six consumers use `resetMultiplayerRoomStateRef` (`useTournamentMatchSession` alone has 10 call sites). |
| **Files touched** | **New:** `multiplayer/useMultiplayerRoomTeardown.ts` (~90 LOC). **Modify:** `App.tsx` (−~80), `useTournamentMatchSession.ts`, `useAppSessionRuntime.ts`, `multiplayerRuntime.ts` |
| **Estimated LOC moved** | ~80–90 |
| **Expected risk** | High |
| **Regression surface** | Post-game, abandon, sign-out (`App.tsx:1325–1340`), tournament terminal exit, rematch reset |
| **Tests required before merge** | Unit test: teardown clears all ref targets; tournament attach refs cleared. Manual abandon + tournament bracket return. |
| **Rollback strategy** | Revert teardown module |
| **Dependencies** | Phase D (shared coordinator context) |
| **Runtime behavior change** | No |

---

## Phase F — Match Exit Orchestration (E8)

| Field | Detail |
|-------|--------|
| **Objective** | Move `handlePostGame` and `abandonCurrentMatch` (~90 LOC combined) out of App. Tournament session owns exit routing; room layer owns `emitRoomAbandonMatch` transport. |
| **Why it exists** | E8: branches on `currentTournamentContext` while calling `disconnect` / `resetMultiplayerRoomState`. Order matters: "reset room state before transport so shell unmounts cleanly." |
| **Files touched** | `match/session/useTournamentMatchSession.ts` (extend) OR **new** `multiplayer/useMultiplayerMatchExit.ts` (~100 LOC). **Modify:** `App.tsx` (−~90), `AppRoutesGamePropsHost.tsx` prop source |
| **Estimated LOC moved** | ~90–100 |
| **Expected risk** | High |
| **Regression surface** | Tournament bracket return after abandon, casual multiplayer abandon, double-leave, post-game disconnect to home |
| **Tests required before merge** | Server abandon tests + manual tournament + casual paths |
| **Rollback strategy** | Revert exit module |
| **Dependencies** | Phase E |
| **Runtime behavior change** | No |

---

## Phase G — Multiplayer App Host (H-1 / Bot Match Parity)

| Field | Detail |
|-------|--------|
| **Objective** | Create `multiplayer/useMultiplayerAppHost.ts` — single composition hook that owns multiplayer refs, wires `MultiplayerConnectionHost`, join coordinator, teardown, match exit, and shell delegates. `App.tsx` calls it like `useBotMatchScreenController`. Target: App PvP block drops from ~600 LOC to ~80 LOC delegation. |
| **Why it exists** | H-1: App is the integration kernel. Partial extractions (Phases A–F) reduce LOC but don't establish a **composition boundary** equivalent to Bot Match's 8-line root. |
| **Files touched** | **New:** `multiplayer/useMultiplayerAppHost.ts` (~350–420 LOC). **Modify:** `App.tsx` (−~400), possibly collapse `useMultiplayerConnectionHostParams.ts` into host |
| **Estimated LOC moved** | ~350–450 out of App |
| **Expected risk** | **Very High** |
| **Regression surface** | Entire PvP client: connect, lobby, match, tournament-in-match, reconnect, rematch, navigation |
| **Tests required before merge** | All Phase 0 tests + Phases A–F tests + full manual PvP QA matrix + existing e2e (`client/e2e/match.spec.ts` — currently only checks lobby loads) |
| **Rollback strategy** | Revert host hook; restore inline App wiring (Phases A–F modules can remain) |
| **Dependencies** | Phases A, D, E, F minimum; B and C strongly recommended |
| **Runtime behavior change** | No |

---

## Phase H — CI Boundary Rules (Build Guardrails)

| Field | Detail |
|-------|--------|
| **Objective** | Add dependency-cruiser rules for PvP folder boundaries (audit recommended). |
| **Why it exists** | `client/.dependency-cruiser.json` has only 4 generic rules. No `multiplayer/* ↛ App`, no `LiveMatchScreen ↛ roomTransport` enforcement. Bot Match has documented forbidden edges; PvP does not. |
| **Files touched** | `client/.dependency-cruiser.json`, possibly `client-ci.yml` if not already running dep-cruiser on PvP paths |
| **Estimated LOC moved** | ~30 config LOC |
| **Expected risk** | Low (may surface existing violations) |
| **Regression surface** | CI only |
| **Tests required before merge** | `dependency-cruiser` passes; client build green |
| **Rollback strategy** | Remove new rules |
| **Dependencies** | None (can run parallel to Phase 0) |
| **Runtime behavior change** | No |

Suggested rules:

- `multiplayer/*` and `match/session/*` must not import `App.tsx`
- `match/LiveMatchScreen` must not import `multiplayer/roomTransport`
- No `multiplayer` ↔ `match/session` circular deps

---

## Phase I — Live Match Actions Extraction (H-2, gameplay emit layer)

| Field | Detail |
|-------|--------|
| **Objective** | Extract `draw`, `pass`, `play`, `startGame`, `requestRematch`, `handleTileTap`, `isGameplayActionBlocked`, `emitDraggingState` (~280 LOC) from `useLiveMatchSession` into `match/session/useLiveMatchActions.ts`. Shared `stateRef` + `pendingGameplayActionRef` contract unchanged. |
| **Why it exists** | H-2: god hook mixes gameplay emits, animation staging, hand reveal timers, rematch, move-log hooks, and socket sync params. The **emit layer** is the most bug-prone and least testable section. |
| **Files touched** | **New:** `match/session/useLiveMatchActions.ts` (~280 LOC). **Modify:** `useLiveMatchSession.ts` (−~280), `liveMatchSessionTypes.ts` |
| **Estimated LOC moved** | ~280 |
| **Expected risk** | **Very High** |
| **Regression surface** | All player actions, `pendingUiAction` locks, auto-draw/pass effect (lines 896–949), draw audit, mpPerf markers |
| **Tests required before merge** | Action integration tests with mocked socket + `roomTransport`; cannot merge without Phase 0 harness |
| **Rollback strategy** | Revert actions module |
| **Dependencies** | Phase 0; Phase G recommended (stable injection surface) |
| **Runtime behavior change** | No |

---

## Phase J — Draw Presentation Extraction (H-2 partial)

| Field | Detail |
|-------|--------|
| **Objective** | Move draw animation state (`drawStepMyHand`, `drawSequenceActive`, `flyingTiles`, `boneyardDisplayCount`, etc.) out of `useLiveMatchSession` into dedicated hook, aligning with `useRoomSocketSync` which already owns forced-draw socket choreography. |
| **Why it exists** | Animation state in session hook blocks isolated testing of gameplay guards. |
| **Files touched** | `useLiveMatchSession.ts` (−~200), `useRoomSocketSync.ts` or new `useLiveMatchDrawPresentation.ts`, `MultiplayerGameShell.tsx` |
| **Estimated LOC moved** | ~180–220 |
| **Expected risk** | **Very High** |
| **Regression surface** | Forced-draw UX, auto-turn during draw sequence, hand reveal interaction |
| **Tests required before merge** | Socket sync integration tests; forced-draw timeout cleanup on unmount |
| **Dependencies** | Phase I |
| **Runtime behavior change** | No |

**Critical judgment: REJECT unless forced by production bugs.** `useRoomSocketSync` already owns the socket-side draw choreography; splitting session presentation further is high-risk/low-ownership-gain. M-2 is "acceptable domain coupling."

---

## Phase K — Room Persistence Policy (E3)

| Field | Detail |
|-------|--------|
| **Objective** | Extract `shouldPersistLastRoomCode` gating (App.tsx:543–557) into explicit policy function consumed by room recovery helper. |
| **Why it exists** | E3: persistence gates on `liveGameOver` + terminal tournament match. |
| **Files touched** | `match/recovery/matchRecovery.ts` (+~20), `App.tsx` (−~15) |
| **Estimated LOC moved** | ~20 |
| **Expected risk** | Low–Medium |
| **Regression surface** | localStorage room code after game over, tournament terminal reconnect |
| **Runtime behavior change** | No |

---

## Phase L — Feed Connect Policy (E2)

| Field | Detail |
|-------|--------|
| **Objective** | Extract 4-line feed-mode connect effect (App.tsx:1011–1014). |
| **Why it exists** | E2 documents auth-gated lazy connect for feed mode. |
| **LOC moved** | ~10 |
| **Risk** | Low |

**REJECT:** No ownership problem — 4 lines in App. Moving it adds indirection without parallel-work benefit.

---

## Phase M — Legacy Recovery Ref Shim Removal (M-3)

| Field | Detail |
|-------|--------|
| **Objective** | Migrate `useMultiplayerRoomActions`, App, tournament session off `reconnectShouldJoinRef` / `preventAutoRejoinRef`; consume `recoveryMachine` snapshot directly. |
| **Why it exists** | M-3: dual API (FSM + legacy refs) risks drift. |
| **LOC moved** | ~80 across 4 files |
| **Risk** | Medium–High |

**REJECT for now:** `syncRecoveryLegacyRefs` is 38 LOC, tested, and transitional by design. Removing it touches every reconnect path for marginal ownership gain.

---

## Intentionally Rejected Proposals

| Proposal | Why rejected |
|----------|--------------|
| Split `PrivateMatchLobbyScreen` (1,203 LOC) | M-4 UI surface debt; no runtime ownership violation |
| Split `registerRoomSessionHandlers.ts` (1,580 LOC) | M-5; server tests are strong; team-scaling concern only |
| Split `LiveMatchScreen` by LOC | L-2; presentational; props are the view-model |
| Split `useTournamentMatchSession` | M-7; domain complexity, not accidental gameplay duplication |
| Further `useAppSessionRuntime` slicing (E11) | Ref bundling without ownership; doesn't remove App kernel |
| PvP `MatchEventBus` | Bot Match has one; PvP has no proven pub/sub ownership problem |
| `createMultiplayerViewModel` layer | Premature until runtime host (Phase G) stabilizes |
| Extract analyzer/move-log from `MultiplayerGameShell` | M-1; presentation mixing, not blocking parallel work |
| Gate `console.log` at M-6 | 15-minute hygiene, not an architecture phase |

---

## Roadmap Summary

| Phase | Goal | Files | Risk | Difficulty | Value | Est. time |
|-------|------|-------|------|------------|-------|-----------|
| **0** | Client test harness (H-4) | `socketGuards.test.ts`, `boardSnapshotGuards.test.ts`, extend behavior tests | Low | Low | **Critical** | 2–3 days |
| **A** | Resync ownership extraction (E6) | `useMultiplayerResync.ts`, `App.tsx`, runtime types | Medium | Medium | High | 1 day |
| **B** | Resync queue fix (H-3) | `useMultiplayerResync.ts`, `recoveryMachine.ts` | Med–High | Medium | **Critical** | 0.5–1 day |
| **C** | Shell bridge queue (H-5) | `useMultiplayerShellDelegates.ts`, `MultiplayerGameShell.tsx` | Medium | Medium | Medium | 0.5–1 day |
| **D** | Join ack coordinator (E5) | `useMultiplayerJoinCoordinator.ts`, `App.tsx` | High | High | High | 2–3 days |
| **E** | Room teardown (E4) | `useMultiplayerRoomTeardown.ts`, tournament session | High | High | High | 1–2 days |
| **F** | Match exit orchestration (E8) | `useMultiplayerMatchExit.ts` or tournament session | High | High | Medium | 1–2 days |
| **G** | Multiplayer app host (H-1) | `useMultiplayerAppHost.ts`, `App.tsx` | **Very High** | **Very High** | **Critical** (parity) | 3–5 days |
| **H** | CI boundary rules | `.dependency-cruiser.json` | Low | Low | High | 0.5 day |
| **I** | Live match actions (H-2) | `useLiveMatchActions.ts`, `useLiveMatchSession.ts` | **Very High** | High | Medium | 3–4 days |
| **J** | Draw presentation split | session + socket sync | **Very High** | High | Low | 3–5 days |
| **K** | Room persistence policy (E3) | `matchRecovery.ts` | Low–Med | Low | Low | 0.5 day |
| **L** | Feed connect (E2) | — | — | — | **Skip** | — |
| **M** | Legacy ref shim (M-3) | recovery bridge | Med–High | Med | Low | **Skip** | — |

**Total for recommended path (0, A, B, H, D):** ~8–12 engineering days  
**Total for Bot Match parity (+ G):** ~12–18 engineering days  
**Total if including I (session split):** ~16–24 engineering days

---

## Critical Answers

### 1. Which phase MUST happen first?

**Phase 0 (test harness)** must gate every extraction merge.

**Phase A (resync ownership)** is the first code move — it addresses the only documented client correctness ownership problem (E6) with the smallest blast radius and unblocks testable resync logic.

Phase 0 and Phase H can start in parallel on day one.

### 2. Which phases could be skipped forever without harming architecture?

- **L** (feed connect) — 4 lines, no ownership win
- **M** (legacy ref shim) — transitional shim is tested and working
- **J** (draw presentation split) — unless production forced-draw bugs appear
- **K** (room persistence policy) — behavior already correct; extraction is documentation-only
- **Private lobby split, server handler split, view-model layer, analyzer extraction** — permanently skippable unless feature velocity demands them

Skipping **G** means PvP never reaches Bot Match composition parity, but Phases A–F still materially reduce App kernel risk.

### 3. Biggest difference toward AAA studio quality?

**Phase 0 + Phase G together.** Tests give CI confidence; `useMultiplayerAppHost` gives a composition boundary so multiplayer engineers can work without touching auth, bot, ghost, or learn wiring in `App.tsx`. That is the structural gap vs Bot Match's `BotMatchScreen.tsx` → `useBotMatchScreenController` pattern.

### 4. Highest regression risk?

**Phase G** (multiplayer app host) — touches the entire injection graph in one merge.

Runner-up: **Phase I** (gameplay actions extraction) — every player input path.

### 5. Best engineering ROI?

**Phases 0 + A + B + H** — ~4–5 days total:

- Fixes H-3 correctness hazard
- Establishes test net for future work
- Moves resync out of App kernel
- Adds CI guardrails at near-zero runtime risk

---

## Execution Order (DAG)

```
Phase 0 ──┬──► Phase A ──► Phase B
          │
          ├──► Phase C (optional, if H-5 repro exists)
          │
          └──► Phase H (parallel)

Phase A + B ──► Phase D ──► Phase E ──► Phase F ──► Phase G

Phase 0 + G ──► Phase I (only if gameplay velocity demands)

REJECT: J, L, M, lobby split, server split, view-model, event bus
```

---

## Conclusion

**If this were my codebase, I would execute only Phases 0, A, B, H, and D — and intentionally reject the remaining proposals because they do not justify their regression risk.**

Rationale:

- **0, A, B** fix the only proven correctness hazard (H-3) and make resync owned/testable.
- **H** is cheap insurance against dependency rot during future work.
- **D** removes the highest-traffic entanglement (E5 join ack) without requiring the big-bang Phase G merge.
- **C** only if Sentry/manual QA shows pre-mount bridge drops.
- **E, F, G** are correct end-state work but carry very-high regression cost; defer until product allocates a dedicated multiplayer hardening sprint.
- **I, J** on `useLiveMatchSession` are justified only after a bug forces it — the hook is large but **server authority + sequence guards** already prevent the worst failure modes.
- **E11 ref rebundling, feed connect extraction, legacy shim removal, lobby/server splits** are indirection without ownership benefit.

PvP would land at ~7/10 architectural maturity (up from ~5/10 today): resync owned, join path owned, tests + CI guards, App still kernel but ~15% smaller. Full Bot Match parity (Phase G + optional I) is a second sprint, not Phase 2.

---

## Related Documents

- [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md) — Phase 1 audit (ENTANGLEMENT E2–E11, H-1–H-5)
- [bot-match-architecture.md](./bot-match-architecture.md) — contrast reference for successful decomposition
- [multiplayer-socket-recovery.md](../agent-skills/multiplayer-socket-recovery.md) — operational recovery skill

---

## Files Inspected

`App.tsx`, `useLiveMatchSession.ts`, `MultiplayerGameShell.tsx`, `useMultiplayerConnection.ts`, `useRoomSocketSync.ts`, `recoveryMachine.ts`, `useMultiplayerShellDelegates.ts`, `useAppSessionRuntime.ts`, `useMultiplayerRoomActions.ts`, `MultiplayerConnectionHost.tsx`, `AppRoutesGamePropsHost.tsx`, `socketGuards.ts`, `boardSnapshotGuards.ts`, `BotMatchScreen.tsx`, `useBotMatchScreenController.ts`, `.dependency-cruiser.json`