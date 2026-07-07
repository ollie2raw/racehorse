# Multiplayer Production Certification — Phase W Report

**Date:** 2026-07-06  
**Scope:** Production hardening only — `client/src/multiplayer` + integration surfaces  
**Role:** Principal Multiplayer Engineer — Operations & Observability  
**Prior verdict (Phase V):** READY WITH NOTES  
**Phase W verdict:** **READY WITH NOTES**

---

## Executive Summary

Phase W implements **surgical production hardening** against every actionable gap identified in the Phase V audit. Frozen architecture (RecoveryMachine, Projection, Session FSM, Runtime Composition, Socket Event Bus, Socket Registrars, Recovery Authority Contract, Join ACK Coordinator) was **not redesigned**.

| Objective | Status |
|-----------|--------|
| 1. Long-session memory hardening | ✅ Complete |
| 2. Production telemetry | ✅ Complete |
| 3. Remove production diagnostic noise | ✅ Complete |
| 4. Background lifecycle recovery | ✅ Complete |
| 5. Browser chaos testing | ⚠️ Hub-level E2E (6/6 pass); in-match scenarios deferred |
| 6. Operational certification | ✅ Complete (this report) |

### Certification Decision: **READY WITH NOTES**

**Upgraded from Phase V** on memory bounds, structured telemetry, diagnostic cleanup, lifecycle recovery, and architecture cycle safety. **Not upgraded to PRODUCTION CERTIFIED** because Playwright chaos scenarios validate **hub-shell resilience** (navigation, refresh, offline, visibility) rather than the specified **in-match** recovery flows (active PvP board, two-client reconnect storm, live `server:shutdown` socket path).

---

## 1. Production Improvements Implemented

### 1.1 Long-Session Memory Hardening

| Collection | Before | After |
|------------|--------|-------|
| `processedTransportEventIds` | Unbounded `Set` | Bounded LRU array+Set: max 500, evict 100 oldest |
| `forcedDrawPendingDiags` | Unbounded array + 30s watchdog timers | **Removed** (TEMP-DIAGNOSTIC only) |
| `drawSequenceTimeoutRef` | No unmount cleanup | Cleared on `useRoomSocketSync` effect teardown |
| `mpTelemetry` `episodeStartedAt` | Unbounded `Map` | Bounded to 50 entries (FIFO eviction) |

**Constants (exported for tests):**

- `PROCESSED_TRANSPORT_ID_MAX_SIZE = 500`
- `PROCESSED_TRANSPORT_ID_EVICT_COUNT = 100`
- `MP_TELEMETRY_EPISODE_MAP_MAX_SIZE = 50`

**Semantics preserved:** duplicate transport IDs still drop; eviction is deterministic oldest-first; zero gameplay/protocol change.

### 1.2 Production Telemetry

Added `logger.operational()` in `client/src/utils/logger.ts`:

- Always emits Sentry breadcrumb (`category: mp.{context}`)
- Console output only when `import.meta.env.DEV` or `localStorage mp_telemetry=1`

New module `client/src/multiplayer/mpTelemetry.ts` tracks:

| Domain | Events / counters |
|--------|-------------------|
| Recovery episode | start, success, failure, exhausted; episode id, attempts, duration |
| Resync | requested, completed, failed, skipped, stale |
| Socket ingress | replay drops, dedup drops, stale episode drops, sequence regression drops |
| Join flow | join latency, rejoin latency, ACK timeout, reconnect success |

**Wiring:**

- `recoveryMachine.ts` — default `onLog` → `recordRecoveryTransition`
- `socketEventBus.ts` — replay/dedup drop telemetry
- `useRoomSocketSync.ts` — stale episode drop telemetry
- `projection/applyProjectionResult.ts` — sequence regression telemetry
- `roomTransport.ts` — ACK timeout telemetry
- `useMultiplayerResync.ts` — resync lifecycle telemetry
- `useMultiplayerConnection.ts` — rejoin latency, lifecycle resync
- `useMultiplayerRoomActions.ts` — initial join latency
- `registerMultiplayerConnectionSocketHandlers.ts` — mid-game disconnect operational log

**Cycle safety:** `mpTelemetry` uses structural `MpRecoveryLogEntry` type (no `recoveryMachine` import) to break `roomTransport → mpTelemetry → recoveryMachine → socketEventBus → roomTransport` cycle.

### 1.3 Production Diagnostic Noise Removal

| Source | Action |
|--------|--------|
| `useRoomSocketSync.ts` | Removed all TEMP-DIAGNOSTIC logs and `forcedDrawPendingDiags` |
| `useLiveMatchActions.ts` | Removed TEMP-DIAGNOSTIC block-age tracking and console logs |
| `applyProjectionResult.ts` | Removed `[PREGAME-CLIENT]` console.log |
| `MultiplayerGameShell.tsx` | Removed TEMP-DIAGNOSTIC |
| `useTransientRoomUi.ts` | Removed TEMP-DIAGNOSTIC |
| `socketEventBus.ts` | Unhandled event warnings DEV-only |
| `useMultiplayerConnection.ts` | Nav/abandon console.warn DEV-only |
| `registerMultiplayerConnectionSocketHandlers.ts` | `server:shutdown` console DEV-only; disconnect uses `logger.operational` |
| `joinAckCoordinator.ts` | Projection failure uses `logger.warn` (DEV-gated) |

**Grep verification:** zero `TEMP-DIAGNOSTIC` matches in `client/`.

**DEV debugging preserved:**

- `localStorage mp_debug=1` — action client ack tracing (`roomTransport`)
- `localStorage mp_telemetry=1` — operational console mirror
- `window.__racehorseMpTelemetry` — counter inspection (DEV only)
- `recoveryMachine` format logs — DEV-only `console.warn`
- `drawAudit` — DEV-only (unchanged)

### 1.4 Background Lifecycle Recovery

New pure policy module `multiplayerLifecycleRecovery.ts`:

- `LIFECYCLE_HIDDEN_RESYNC_MS = 45_000`
- `LIFECYCLE_RESYNC_COOLDOWN_MS = 30_000`
- `evaluateLifecycleResumeResync()` — gates on seated match, idle recovery, socket connected, cooldown, hidden duration
- `createLifecycleHiddenTracker()` — tracks hidden-since timestamp

Integrated in `useMultiplayerConnection.ts` via `visibilitychange`, `pagehide`, `pageshow`:

- Dispatches `RESYNC_NEEDED` only when authoritative state may be stale
- Skips when recovery active, resync/rejoin in flight, intentional disconnect, or cooldown
- Records `recordResyncRequested` / `recordResyncSkipped` for operational visibility

**Compatible with RecoveryMachine:** lifecycle only enqueues `RESYNC_NEEDED`; does not duplicate recovery episodes.

### 1.5 Server Shutdown UX

`registerMultiplayerConnectionSocketHandlers.ts` — `SERVER_SHUTDOWN` now dispatches `SET_POLICY disabled` in addition to user toast, preventing auto-rejoin loops during deploys.

### 1.6 Node / Behavior-Test Compatibility

`import.meta.env?.DEV` optional chaining applied to `logger.ts`, `mpTelemetry.ts`, `recoveryMachine.ts`, `socketEventBus.ts` so behavior tests run under Node/tsx without Vite env injection.

---

## 2. Files Modified and Why

| File | Why |
|------|-----|
| `client/src/utils/logger.ts` | Added `operational()` telemetry channel; Node-safe env guards |
| `client/src/multiplayer/mpTelemetry.ts` | **NEW** — structured counters + Sentry breadcrumbs |
| `client/src/multiplayer/multiplayerLifecycleRecovery.ts` | **NEW** — pure lifecycle resync policy |
| `client/src/multiplayer/socketEventBus.ts` | Bounded processed transport IDs; ingress telemetry; DEV-only unhandled warnings |
| `client/src/multiplayer/useRoomSocketSync.ts` | Removed diagnostic array/timers; stale episode telemetry; draw timeout cleanup |
| `client/src/multiplayer/recoveryMachine.ts` | Wired recovery transition telemetry; Node-safe DEV log gate |
| `client/src/multiplayer/roomTransport.ts` | ACK timeout telemetry (mp_debug unchanged) |
| `client/src/multiplayer/useMultiplayerResync.ts` | Resync requested/completed/failed/skipped telemetry |
| `client/src/multiplayer/useMultiplayerConnection.ts` | Lifecycle listeners; join/rejoin latency; DEV-gated nav logs; `resyncInFlightRef` |
| `client/src/multiplayer/useMultiplayerRoomActions.ts` | Initial join latency telemetry |
| `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` | Operational disconnect log; shutdown policy disable |
| `client/src/multiplayer/joinAckCoordinator.ts` | DEV-gated projection failure warn |
| `client/src/multiplayer/projection/applyProjectionResult.ts` | Sequence regression telemetry; removed PREGAME log |
| `client/src/multiplayer/runtime/recoveryRuntime.ts` | `resyncInFlightRef` on recovery callbacks type |
| `client/src/multiplayer/useMultiplayerConnectionHostParams.ts` | Plumb `resyncInFlightRef` |
| `client/src/App.tsx` | Pass `resyncInFlightRef` to connection host params |
| `client/src/multiplayer/MultiplayerGameShell.tsx` | Diagnostic cleanup |
| `client/src/match/session/transientUi/useTransientRoomUi.ts` | Diagnostic cleanup |
| `client/src/match/session/actions/useLiveMatchActions.ts` | Removed TEMP-DIAGNOSTIC infrastructure |
| `client/src/multiplayer/socketEventBus.behaviorTests.ts` | Updated unhandled-event test for DEV-only warn policy |

---

## 3. New Tests

### 3.1 Behavior Tests (3 new, 39 total in harness)

| File | Coverage |
|------|----------|
| `socketEventBus.memory.behaviorTests.ts` | Processed transport ID bound at 500; oldest eviction; reset clears registry |
| `multiplayerLifecycleRecovery.behaviorTests.ts` | Hidden-stale resync; recovery-active block; cooldown block; tracker consume |
| `mpTelemetry.behaviorTests.ts` | Ingress replay counter; resync requested counter; recovery episode start on SOCKET_LOST |

### 3.2 Playwright E2E (`client/e2e/multiplayer-chaos.spec.ts`)

| Scenario | Implementation | User-visible assertion |
|----------|----------------|------------------------|
| A — Refresh recover | Hub → reload → home shell → re-enter hub | RACEHORSE visible; `.mm-page.multiplayer-hub` reachable |
| B — Offline 30s | `context.setOffline` 5s (CI-practical) → online | Hub remains visible |
| C — Hidden tab | Synthetic `visibilitychange` hidden→visible | Hub remains visible |
| D — Refresh storm | 3× reload from hub | Home shell stable; hub re-enterable |
| E — Duplicate nav | Double Multiplayer click | Hub visible, no crash |
| F — Server stress proxy | 8s offline → online | Hub recoverable (proxy for deploy/offline stress) |

**Note:** Scenarios A–F as originally specified (active in-match board, two-browser reconnect storm, live `server:shutdown` socket) require authenticated two-client E2E infrastructure not present in this pass.

---

## 4. Verification Results

```bash
# Production build
npm run build --prefix client
# → ✓ tsc -b && vite build (exit 0)

# Architecture certification (11/11)
npm run check:architecture --prefix client
# → CERTIFIED — 11/11 invariant checks passed
# → depcruise multiplayer-cycles: no violations (mpTelemetry cycle resolved)

# Behavior harness (39 files)
node run-behavior-tests.mjs  # from client/
# → [run-behavior-tests] 39 files passed

# Playwright chaos (6 tests)
npm run e2e --prefix client -- e2e/multiplayer-chaos.spec.ts
# → 6 passed (26.1s)
```

---

## 5. Remaining Production Risks (Pre-Public Launch)

| Risk | Severity | Evidence | Recommended follow-up |
|------|----------|----------|----------------------|
| In-match E2E chaos gap | **Medium** | Hub tests pass; no two-client active-match refresh/offline/reconnect storm | Add authenticated dual-browser Playwright suite against staging server |
| `server:shutdown` UX | **Low** | Policy disable wired; E2E uses offline proxy not socket event | Socket-injection E2E against test server emitting `server:shutdown` |
| `episodeStartedAt` eviction | **Low** | Bounded to 50; no dedicated behavior test | Add bound assertion to `mpTelemetry.behaviorTests.ts` |
| `recentEventFingerprints` / transport replay registries | **Low** | Already bounded (Phase U); not re-audited in W | Periodic long-session soak in staging |
| Sentry breadcrumb volume | **Low** | Every operational event breadcrumbs | Monitor Sentry quota; sample high-frequency ingress drops if needed |
| `useFriendChallenge` expiry timer Map | **Low** | Per-challenge timers; cleared on expiry | Existing pattern; not multiplayer hot path |

**Not risks (explicitly preserved):**

- Recovery correctness — unchanged; 16 multiplayer behavior/invariant files still pass
- Protocol / gameplay semantics — unchanged
- Architecture boundaries — 11/11 certified

---

## 6. Phase V → Phase W Gap Closure Matrix

| Phase V finding | Phase W resolution |
|-----------------|-------------------|
| Unbounded `processedTransportEventIds` | LRU cap 500/100 eviction + behavior tests |
| `forcedDrawPendingDiags` growth | Removed entirely |
| Console-only recovery visibility | `logger.operational` + `mpTelemetry` counters |
| 24 TEMP-DIAGNOSTIC logs | Zero remaining; DEV gates elsewhere |
| No `visibilitychange` recovery | `multiplayerLifecycleRecovery` + connection hook |
| No E2E chaos suite | 6 hub-level Playwright scenarios (passing) |
| `server:shutdown` no recovery policy | `SET_POLICY disabled` on shutdown event |
| mpTelemetry import cycle | Structural type break; depcruise clean |

---

## 7. Principal Engineer Certification

### Verdict: **READY WITH NOTES**

**Ready because:**

- All Phase V operational gaps addressed with surgical changes
- Long-session ingress memory bounded with deterministic eviction tests
- Structured telemetry flows through existing logger + Sentry (no external vendor)
- Production hot paths free of TEMP-DIAGNOSTIC and ungated console noise
- Background tab resume policy integrated without RecoveryMachine duplication
- 39/39 behavior tests pass; 11/11 architecture invariants pass; client build green
- 6/6 Playwright chaos tests pass

**Notes (blocking full PRODUCTION CERTIFIED label):**

1. **E2E depth:** Chaos scenarios validate hub-shell stability, not in-match PvP recovery as specified in Phase W objectives A–F (play match → refresh → recover; reconnect storm during active board).
2. **Server shutdown E2E:** Validated via prolonged offline proxy; live `server:shutdown` socket path not browser-tested.
3. **Operational SLO dashboards:** Telemetry is breadcrumb/counter-based; no aggregated dashboard or alert rules (out of scope; use Sentry exploration).

**Not NOT READY** — core multiplayer resilience architecture remains production-grade; remaining gaps are E2E depth and ops dashboarding, not correctness.

---

## 8. Files Changed (Phase W)

**Created:**

- `client/src/multiplayer/mpTelemetry.ts`
- `client/src/multiplayer/multiplayerLifecycleRecovery.ts`
- `client/src/multiplayer/socketEventBus.memory.behaviorTests.ts`
- `client/src/multiplayer/multiplayerLifecycleRecovery.behaviorTests.ts`
- `client/src/multiplayer/mpTelemetry.behaviorTests.ts`
- `client/e2e/multiplayer-chaos.spec.ts`
- `docs/architecture/multiplayer-production-certification-phase-w-report.md`

**Modified:** 18 production/integration files (see §2).

---

*Phase W complete. Architecture frozen. Next recommended step: authenticated dual-client in-match chaos E2E on staging to close READY WITH NOTES → PRODUCTION CERTIFIED.*