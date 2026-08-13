# Engineering Baseline - v1.0

This document defines the certified production engineering baseline for the Racehorse Dominoes platform. 

---

## 1. Current Architecture & Design Decisions

### Package Workspaces
The repository is structured as a unified monorepo utilizing npm workspaces:
- `client`: React single page application, Vite, Playwright browser test runner.
- `server`: Express, Socket.IO, TypeScript backend runtime.
- `packages/match-protocol`: Shared type definitions and protocol structures to enforce strong contracts across the boundary.

### Gameplay Engine
- **Single Threaded Event Bus**: The server processes actions sequentially.
- **Server Authority**: All move placements, score updates, and extra turn chaining calculations are executed and verified on the server.
- **Branching System**: Supports crossed double hubs with up to 2 branch arms. Calculated deterministically.

### State & Connection Recovery
- **Event Bus Deduplication**: A deduplication layer guards client state mutations against duplicate network packets.
- **Recovery Finite State Machine**: Handles client connection lifecycle states and triggers resync operations dynamically.
- **Disconnect Grace Period**: Active rooms are cached in-memory during brief network dropouts.

---

## 2. Why the Architecture is Frozen

The core architecture is **frozen** to safeguard gameplay integrity and prevent regressions before public launch. 

### What Should NOT Be Refactored:
1. **Match State Management & Invariants**: The core engine rule validation in `server/src/game/` is fully verified and must not be restructured.
2. **Connection Lifecycle**: The client `RecoveryMachine` and event bus deduplication logic are verified through rigorous behavior tests and must remain unmodified.
3. **Supabase Schema / RLS**: DB layouts, user profiles, and attempt persistence tables.
4. **Shared Package Boundary**: `@racehorse/match-protocol` structures.

---

## 3. Engineering Guarantees

### Testing Guarantees
- Every gameplay state invariant, score calculation, extra-turn chain, and hand-end condition is verified by the Vitest suite (82 server test suites, 73 client test suites).
- Network race conditions, reconnect scenarios, and bot matches are verified via custom script behavior tests (39 scenarios).

### CI Guarantees
- Every pull request and push to the `main` branch undergoes automated typechecking, linting (TS/JS/CSS), dependency boundary validation, unit/behavior tests, Playwright browser runs, and production build checks.

### Performance Guarantees
- **Payload footprints**: Network payloads are optimized, ensuring spectator snapshots and socket updates are highly compact.
- **Memory Footprint**: In-memory room cleanup removes inactive match states.

### Production Guarantees
- **Server-Authoritative Timing**: Prevents timing manipulation on Daily Puzzles by computing durations from server database timestamps.
- **Brute-Force Protection**: Restricts room-scanning exploits via failed lookup rate-limiting.
- **Fail-Fast Configuration**: Server validates required parameters and credentials at startup under production mode.

---

## 4. Intentionally Deferred Items

To maintain a focused scope for v1.0, the following items are intentionally deferred:
1. **Redis Scaling**: Multi-node server scalability using a Redis adapter is deferred. Currently, active socket connections are managed within single-node memory.
2. **Durable Room Persistence**: Cold room storage / server crash survival (persisting live matches in DB) is deferred. Active match states exist in the server's memory space and utilize standard persistence grace cycles.

---

## 5. Rules for Future Development

New engineering efforts must comply with the following development constraints:

1. **Prioritize Product Features**: Focus development on delivering user-facing features, daily puzzles, and UI enhancements.
2. **No Architectural Rewrites**: Architectural rewrites are prohibited unless a measurable production defect or scalability bottleneck is identified and verified.
3. **Preserve Engine Invariants**: Core rules, scoring systems, and validation pipelines must be maintained.
4. **Maintain Test Coverage**: Any new feature or module must be supported by automated vitest unit tests.
