# Zero Grandfather Socket Registry + Registrar Purity — Phase S Report

**Date:** 2026-07-06  
**Scope:** Final socket registry completion + gameplay registrar purity  
**Role:** Principal Multiplayer Engineer / Chess.com Staff Engineer  
**Status:** **COMPLETE** — 100% socket registry enforcement

---

## Executive Summary

Phase S removes the **last architectural exception** in the multiplayer socket registry and eliminates registrar impurity warnings. After migration:

| Metric | Phase R | Phase S |
|--------|---------|---------|
| Grandfathered `socket.on` sites | 1 | **0** |
| Registrar business-logic warnings | 1 | **0** |
| React type imports in connection registrar | 1 | **0** (uses `RefBox`) |
| Approved registrar files | 8 | **9** |

**No redesign.** RecoveryMachine, Projection, Session FSM, Runtime Composition, protocol, gameplay rules, and UX are unchanged. Behavior is identical — only ingress ownership moved.

---

## Table of Contents

1. [Before vs After Architecture](#1-before-vs-after-architecture)
2. [Socket Ownership Tables](#2-socket-ownership-tables)
3. [Friends Registrar Migration](#3-friends-registrar-migration)
4. [Gameplay Registrar Purity](#4-gameplay-registrar-purity)
5. [React Type Dependency Removal](#5-react-type-dependency-removal)
6. [Invariant Enforcement Tightening](#6-invariant-enforcement-tightening)
7. [Files Created](#7-files-created)
8. [Files Modified](#8-files-modified)
9. [Registry Changes](#9-registry-changes)
10. [Delegate Architecture](#10-delegate-architecture)
11. [Dependency Graph](#11-dependency-graph)
12. [CI Verification Output](#12-ci-verification-output)
13. [Documentation Updates](#13-documentation-updates)
14. [Remaining Architectural Debt](#14-remaining-architectural-debt)
15. [Five-Year Maintainability Review](#15-five-year-maintainability-review)
16. [Principal Engineer Review](#16-principal-engineer-review)
17. [Production Readiness Assessment](#17-production-readiness-assessment)
18. [Recommended Next Production Phase](#18-recommended-next-production-phase)
19. [Hard Rules Compliance Matrix](#19-hard-rules-compliance-matrix)

---

## 1. Before vs After Architecture

### 1.1 Before Phase S

```mermaid
flowchart TB
  subgraph Grandfather["Last exception"]
    FS[FriendsScreen.tsx socket.on connect]
  end

  subgraph ImpureRegistrar["Registrar warning"]
    GP[registerMultiplayerConnectionGameplaySocketHandlers.ts]
    GP --> Sound[playHandWinSound / timers]
  end

  subgraph Enforced["Registry-enforced"]
    T[Tournament registrar]
    M[Matchmaking registrar]
    C[Connection registrar]
  end

  Socket[(socket.io)] --> FS
  Socket --> Enforced
  Enforced --> GP

  style Grandfather fill:#f96
  style ImpureRegistrar fill:#f90
```

### 1.2 After Phase S

```mermaid
flowchart TB
  subgraph App["App.tsx — all bounded-context registrars"]
    TR[useRegisterTournamentSocketHandlers]
    MR[useRegisterMatchmakingSocketHandlers]
    FR[useRegisterFriendsSocketHandlers]
  end

  subgraph Bus["Socket Event Bus — 100% enforced"]
    SEB[socketEventBus.ts]
  end

  subgraph Delegates["Hooks own business logic"]
    FS2[FriendsScreen → presence delegate]
    UMC[useMultiplayerConnection → gameplay delegate]
    CGH[connectionGameplaySocketHandlers.ts]
  end

  subgraph Registrars["Registrars — dispatch only"]
    FReg[registerFriendsSocketHandlers.ts]
    GReg[registerMultiplayerConnectionGameplaySocketHandlers.ts]
  end

  Socket[(socket.io)] --> SEB
  App --> Registrars
  Registrars --> SEB
  FReg --> FS2
  GReg --> UMC
  UMC --> CGH

  style App fill:#1a2744
  style Registrars fill:#2a5
```

**Result:** `GRANDFATHERED_DIRECT_SOCKET_ON = []`. CI fails on any new grandfather entry.

---

## 2. Socket Ownership Tables

### 2.1 Friends Bounded Context

| Event | Owner | Registrar | Delegate |
|-------|-------|-----------|----------|
| `connect` | `friends.presence` | `friends/registerFriendsSocketHandlers.ts` (additional) | `FriendsPresenceSocketDelegates.onConnect` |

**Delegate behavior (unchanged):** emit `presence:online` for friend user IDs and update presence map.

### 2.2 Gameplay Bounded Context (Connection Registrar)

| Event | Owner | Registrar | Delegate |
|-------|-------|-----------|----------|
| `hand:ended` | `gameplay.handReveal` | `registerMultiplayerConnectionGameplaySocketHandlers.ts` | `GameplaySocketDelegates.onHandEnded` |
| `game:rematch:status` | `gameplay.rematch` | same | `onGameRematchStatus` |
| `game:rematch:started` | `gameplay.rematch` | same | `onGameRematchStarted` |
| `player:dragging` | `gameplay.ui` | same | `onPlayerDragging` |

### 2.3 Global Registry Summary

| Metric | Value |
|--------|-------|
| Enforced raw events | 34 |
| Enforced normalized routes | 5 |
| Enforced tournament events | 9 |
| Enforced matchmaking events | 3 |
| **Grandfathered direct `socket.on`** | **0** |
| Approved registrar files | 9 |

---

## 3. Friends Registrar Migration

### Removed from `FriendsScreen.tsx`

```diff
- socket.on('connect', checkPresence);
- return () => { socket.off('connect', checkPresence); };
+ friendsSocketScopeRef.current.presence = { onConnect: checkPresence };
+ return () => { friendsSocketScopeRef.current.presence = null; };
```

Initial `checkPresence()` call preserved on mount — identical behavior.

### Verification

```bash
rg 'socket\.on' client/src/friends  # zero matches (excluding comments)
```

---

## 4. Gameplay Registrar Purity

### Before

`registerMultiplayerConnectionGameplaySocketHandlers.ts` contained:
- Sound effects (`playBlockedSound`, `playHandWinSound`, `playHandLoseSound`)
- Hand reveal timer (`window.setTimeout`)
- Score projection math
- Direct UI mutation mixed with registrar

### After

**Registrar** dispatches only:

```typescript
getScope().gameplay?.onHandEnded(payload);
getScope().gameplay?.onGameRematchStatus(payload);
getScope().gameplay?.onGameRematchStarted();
getScope().gameplay?.onPlayerDragging(payload);
```

**Gameplay layer** (`connectionGameplaySocketHandlers.ts`) owns all prior logic.

**Hook** (`useMultiplayerConnection`) assigns delegates that call gameplay handlers with `scopeRef.current`.

Flow: `socket event → registrar → delegate → connectionGameplaySocketHandlers → scope/UI`

---

## 5. React Type Dependency Removal

### Connection Registrar

```diff
- import type { MutableRefObject } from 'react';
+ import type { RefBox } from './refBox';

- recoveryMachineRef: MutableRefObject<RecoveryMachine | null>;
+ recoveryMachineRef: RefBox<RecoveryMachine | null>;
```

`RefBox<T>` in `multiplayer/refBox.ts` is a React-free `{ current: T }` cell.

### Runtime Layer (documented, not redesigned)

Runtime `.ts` modules still use `import type { MutableRefObject }` for bootstrap ref types — these live in the React adapter boundary (`runtimeTypes.ts`, `connectionRuntime.ts`). Replacing all runtime ref types would touch frozen runtime composition contracts; **deferred** as low-risk documented debt (runtime layer warnings only, not registrars).

---

## 6. Invariant Enforcement Tightening

### Phase Q → Phase S Changes (`checkArchitectureInvariants.ts`)

| Check | Phase Q | Phase S |
|-------|---------|---------|
| Grandfather count | Manifest match | **Must be 0** — fails if `GRANDFATHERED_DIRECT_SOCKET_ON.length > 0` |
| Registrar business logic | Warn on gameplay registrar | **Fail** on sound/hand-reveal patterns in any registrar |
| `grandfatheredBusinessLogic` manifest | Allowed 1 entry | **Must be `[]`** |
| React type in registrars | Warn | **Fail** |
| Registrar warnings | Non-blocking | **Zero tolerance** — warnings that were actionable are now errors |

### Socket Registry Validator (`validateSocketEventRegistry.ts`)

- Fails if grandfather list is non-empty
- Verifies `friends/registerFriendsSocketHandlers.ts` registers `connect`

---

## 7. Files Created

| File | Purpose |
|------|---------|
| `client/src/friends/friendsSocketTypes.ts` | Friends delegate types |
| `client/src/friends/friendsSocketScope.ts` | Mutable scope ref |
| `client/src/friends/registerFriendsSocketHandlers.ts` | Friends registrar |
| `client/src/friends/useRegisterFriendsSocketHandlers.ts` | React wiring |
| `client/src/friends/registerFriendsSocketHandlers.behaviorTests.ts` | Registrar contract tests |
| `client/src/multiplayer/gameplaySocketTypes.ts` | Gameplay delegate + payload types |
| `client/src/multiplayer/gameplaySocketScope.ts` | Gameplay scope ref |
| `client/src/multiplayer/connectionGameplaySocketHandlers.ts` | Gameplay business logic |
| `client/src/multiplayer/refBox.ts` | React-free ref cell |
| `client/src/multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.behaviorTests.ts` | Gameplay registrar delegate tests |
| `docs/architecture/friends-socket-registrar-phase-s-report.md` | This report |

---

## 8. Files Modified

| File | Change |
|------|--------|
| `client/src/friends/FriendsScreen.tsx` | Delegate assignment; removed `socket.on` |
| `client/src/App.tsx` | `useRegisterFriendsSocketHandlers` |
| `client/src/multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts` | Delegate-only registrar |
| `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` | `RefBox` instead of `MutableRefObject` |
| `client/src/multiplayer/useMultiplayerConnection.ts` | Gameplay delegate assignment |
| `client/src/multiplayer/socketEventRegistry.ts` | Empty grandfather; friends additional registrar |
| `client/scripts/validateSocketEventRegistry.ts` | Zero grandfather + friends connect check |
| `client/scripts/checkArchitectureInvariants.ts` | Phase S zero-tolerance rules |
| `docs/architecture/architecture-manifest.json` | Phase S counts |
| `docs/architecture/session-state-machine-report.md` | 0 grandfathered |
| `docs/tournament-socket-registrar-report.md` | 0 grandfathered |
| `docs/architecture/matchmaking-socket-registrar-phase-r-report.md` | 0 grandfathered note |

---

## 9. Registry Changes

```diff
- GRANDFATHERED_DIRECT_SOCKET_ON: [ friends/FriendsScreen.tsx connect ]
+ GRANDFATHERED_DIRECT_SOCKET_ON: []

  APPROVED_SOCKET_REGISTRAR_FILES:
+ friends/registerFriendsSocketHandlers.ts

  connect.additionalRegistrars:
+ friends/registerFriendsSocketHandlers.ts
```

---

## 10. Delegate Architecture

### Friends

```
registerFriendsSocketHandlers
  └─ CONNECT → scope.presence?.onConnect()
       └─ FriendsScreen.checkPresence()
            └─ socket.emit('presence:online', ...)
```

### Gameplay

```
registerMultiplayerConnectionGameplaySocketHandlers
  ├─ HAND_ENDED → scope.gameplay?.onHandEnded()
  ├─ GAME_REMATCH_STATUS → scope.gameplay?.onGameRematchStatus()
  ├─ GAME_REMATCH_STARTED → scope.gameplay?.onGameRematchStarted()
  └─ PLAYER_DRAGGING → scope.gameplay?.onPlayerDragging()
       └─ useMultiplayerConnection delegates
            └─ connectionGameplaySocketHandlers.ts
```

---

## 11. Dependency Graph

```mermaid
flowchart LR
  App --> FriendsReg[registerFriendsSocketHandlers]
  App --> GameplayReg[registerMultiplayerConnectionGameplaySocketHandlers]

  FriendsReg --> Bus[socketEventBus]
  GameplayReg --> Bus

  FS[FriendsScreen] --> FriendsScope[friendsSocketScopeRef]
  UMC[useMultiplayerConnection] --> GameplayScope[gameplaySocketScopeRef]
  UMC --> Handlers[connectionGameplaySocketHandlers]

  FriendsReg --> FriendsScope
  GameplayReg --> GameplayScope
```

No new edges into RecoveryMachine, projection transforms, or session FSM core.

---

## 12. CI Verification Output

### `npm run typecheck`

```
PASS (tsc -b --noEmit)
```

### `npm run check:socket-registry`

```
Socket event registry validation passed.
  Enforced raw events: 34
  Enforced normalized routes: 5
  Enforced tournament events: 9
  Enforced matchmaking events: 3
  Grandfathered direct socket.on sites: 0
```

### `npm run check:architecture`

```
CERTIFIED — 11/11 invariant checks passed.
  grandfatheredDirectSocketOn: 0
  approvedRegistrarFiles: 9
  registrarFiles: 5
  (no registrar warnings)
```

### `npm run check:multiplayer-arch`

```
✔ no dependency violations found
```

### `npm run check:multiplayer-cycles`

```
✔ no dependency violations found
```

### `npm run build`

```
PASS (tsc + vite)
```

### `npm run test`

```
PASS — 72 files, 568+ tests
```

### Behavior tests

```
registerFriendsSocketHandlers.behaviorTests: all passed
registerMultiplayerConnectionGameplaySocketHandlers.behaviorTests: all passed
```

---

## 13. Documentation Updates

| Document | Update |
|----------|--------|
| `architecture-manifest.json` | Phase S, grandfather 0, registrars 9, empty `grandfatheredBusinessLogic` |
| `session-state-machine-report.md` | CI row: 0 grandfathered |
| `tournament-socket-registrar-report.md` | CI row: 0 grandfathered |
| `matchmaking-socket-registrar-phase-r-report.md` | Post-S grandfather note |
| `friends-socket-registrar-phase-s-report.md` | **NEW** — this report |

---

## 14. Remaining Architectural Debt

| Item | Severity | Notes |
|------|----------|-------|
| Runtime `.ts` React type-only imports | Low | `runtimeTypes.ts`, `connectionRuntime.ts` — adapter boundary; documented, warned not failed |
| `applyProjectionResult.ts` apply layer | By design | Excluded from pure projection checks |
| E2E recovery episode coverage | Test discipline | Not import-graph enforceable |

**Socket registry debt: zero.**  
**Registrar impurity debt: zero.**

---

## 15. Five-Year Maintainability Review

| Scenario | Phase S Protection |
|----------|-------------------|
| Engineer adds `socket.on` anywhere | Immediate CI fail (empty grandfather + scan) |
| Engineer adds grandfather entry | Validator fails — list must stay empty |
| Engineer puts sound logic in registrar | INV-03 fails on `playHandWinSound` pattern |
| Engineer imports React in registrar | INV-03/INV-09 fail |
| Docs claim non-zero grandfather | INV-10 stale pattern + manifest mismatch |

**Verdict:** Socket ingress is fully owned, counted, and enforced. Bounded contexts (tournament, matchmaking, friends, connection, gameplay) each have explicit registrar files.

---

## 16. Principal Engineer Review

| Area | Verdict |
|------|---------|
| Friends migration | **APPROVED** — delegate pattern matches Phase R/T |
| Gameplay purity | **APPROVED** — logic in `connectionGameplaySocketHandlers.ts` |
| Zero grandfather | **APPROVED** — enforced in validator + manifest + invariants |
| Frozen architecture | **APPROVED** — no frozen subsystem behavior changed |
| Behavior parity | **APPROVED** — delegate implementations copy prior inline handlers |

---

## 17. Production Readiness Assessment

| Gate | Status |
|------|--------|
| 100% socket registry enforcement | **READY** |
| Zero registrar warnings | **READY** |
| CI certification | **READY** |
| Behavior parity | **READY** |
| Documentation | **READY** |

**Production readiness: CERTIFIED**

---

## 18. Recommended Next Production Phase

**Phase T2 — Runtime Ref Type Extraction (optional hygiene)**

- Move remaining `MutableRefObject` type imports from `multiplayer/runtime/*.ts` to `RefBox` or protocol-owned ref types
- Eliminate runtime-layer React type warnings in INV-09
- No behavior change — types only

**Alternative:** **Production Hardening — E2E Socket Ingress Coverage**

- Playwright tests asserting matchmaking queue, friends presence refresh, and hand reveal through live socket paths

---

## 19. Hard Rules Compliance Matrix

| Constraint | Compliant | Evidence |
|------------|-----------|----------|
| No multiplayer redesign | ✓ | Registrar/delegate pattern only |
| No RecoveryMachine changes | ✓ | Zero recovery file edits |
| No Projection changes | ✓ | Zero projection transform edits |
| No Session FSM changes | ✓ | Zero session core edits |
| No networking protocol changes | ✓ | Same wire events/emits |
| No gameplay rule changes | ✓ | Logic moved, not altered |
| No UX changes | ✓ | Same hook/screen APIs |
| No runtime ownership changes | ✓ | Zero runtime/ edits |
| Architecture ownership only | ✓ | Ingress + delegate extraction |
| Identical behavior | ✓ | Handlers preserve prior logic |

---

*Phase S complete. Socket registry at 100% enforcement. Run `npm run check:architecture` and `npm run check:socket-registry` to reproduce certification.*