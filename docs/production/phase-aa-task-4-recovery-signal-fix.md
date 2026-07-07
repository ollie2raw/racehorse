# Phase AA — Task 4: Fix Server Recovery Signal Regression

**Date:** 2026-07-06  
**Scope:** Resolve failing `clientRecoverySignals.test.ts` from Phase Z production certification  
**Architecture:** Frozen — no gameplay, protocol, or production behavior changes

---

## 1. Problem

Phase Z certification reported **1 failing server test**:

```
scheduledTournament/clientRecoverySignals.test.ts
Expected: recovery signal called 2 times
Actual:   recovery signal called 1 time
```

Server suite: **512/513 pass** with this single failure.

---

## 2. Root cause

The test was **stale** relative to an intentional tournament socket refactor (documented in `docs/tournament-socket-registrar-report.md`).

### What the test asserted

`bindTournamentRecoverySignals` should call `onRecover` when:

1. Socket reconnects (`connect`)
2. Document visibility returns to `visible`

### What production does today

Recovery signaling was **split across two modules** (no behavior loss):

| Trigger | Owner | Mechanism |
|---------|-------|-----------|
| Socket `connect` | `registerTournamentSocketHandlers.ts` | Registers `SOCKET_EVENTS.CONNECT` on the socket event bus → `hub.onRecover()` |
| Tab visibility regain | `recoverySignals.ts` | `visibilitychange` listener → `onRecover()` |

`bindTournamentRecoverySignals` **no longer accepts a `socket` parameter** and only handles document visibility. The test still passed a mock socket and expected connect recovery from that function — so only the visibility path fired (1 call).

Production wiring in `useTournament.ts` is correct:

- `useRegisterTournamentSocketHandlers` → connect recovery via hub delegate
- `bindTournamentRecoverySignals` → visibility recovery

**Conclusion:** Missing signal was in the **test**, not production. Restoring `socket.on('connect')` inside `recoverySignals.ts` would duplicate connect recovery and risk double `recover()` calls.

---

## 3. Fix

Updated `server/src/scheduledTournament/clientRecoverySignals.test.ts` to assert the **full tournament recovery contract** across both owners:

1. Register tournament socket handlers with a hub delegate sharing `onRecover`
2. Fire connect via `interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, …)` (same bus path as production)
3. Bind visibility recovery via `bindTournamentRecoverySignals`
4. Fire `triggerVisible()` on the mock document
5. Assert `onRecover` called **exactly 2 times**
6. `resetSocketEventBusForTests()` in `beforeEach` for isolation

No production code changes.

---

## 4. Files changed

| File | Change |
|------|--------|
| `server/src/scheduledTournament/clientRecoverySignals.test.ts` | Align test with split recovery architecture (registrar + visibility) |

---

## 5. Behavioral impact

| Area | Impact |
|------|--------|
| Tournament recovery on socket reconnect | **Unchanged** — still via `registerTournamentSocketHandlers` |
| Tournament recovery on tab visible | **Unchanged** — still via `bindTournamentRecoverySignals` |
| Idempotency / duplicate signals | **No new connect listeners** — avoids double-recover regression |
| Client runtime | **None** — test-only fix |
| Multiplayer protocol | **None** |

---

## 6. Before/after test results

### Before

```
FAIL  clientRecoverySignals.test.ts
  expected onRecover to be called 2 times, but got 1 time

Server: 512 passed | 1 failed (513 total)
```

### After

```
✓ clientRecoverySignals.test.ts (1 test)

Server: 513 passed (513 total)
```

---

## 7. Risk assessment

| Risk | Severity | Notes |
|------|----------|-------|
| Test no longer matches production if recovery is re-merged | Low | Test now documents the two-owner contract explicitly |
| Cross-package import (server test → client modules) | Info | Pre-existing pattern; unchanged |
| False confidence if registrar connect path breaks | Low | Test now exercises real `interpretRawSocketEvent` bus dispatch |

**Overall:** Very low risk. Test-only change; production recovery behavior preserved.

---

## 8. Verification commands

| Command | Result |
|---------|--------|
| `npm run test --prefix server` | **Pass** — 513/513 |
| `npm run build --prefix client` | **Pass** |
| `npm run typecheck --prefix client` | **Pass** |

---

## 9. Related references

- `client/src/tournament/recoverySignals.ts` — visibility-only binding
- `client/src/tournament/registerTournamentSocketHandlers.ts` — `CONNECT` → `hub.onRecover()`
- `client/src/tournament/useTournament.ts` — wires both paths to `recover()`
- `docs/tournament-socket-registrar-report.md` — refactor rationale