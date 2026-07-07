# Release Notes - v1.0

This release establishes the stable production engineering baseline for the Racehorse Dominoes platform.

---

## Technical Summary

### 1. Architecture Stabilization
- Finalized core gameplay rules engine, crossed-double branching structures, and scoring calculations.
- Locked gameplay invariants, ensuring deterministic calculations of board layouts, pip counts, and hand-end conditions.

### 2. Workspace Migration
- Migrated the codebase to **npm workspaces** containing `client`, `server`, and shared `packages/*`.
- Unified subfolder dependencies and lockfiles into a single root `package-lock.json` file.

### 3. Shared Protocol Extraction
- Extracted and isolated `@racehorse/match-protocol` package containing shared typescript schemas, socket payloads, and event schemas.

### 4. Recovery Machine
- Implemented client-side `RecoveryMachine` (finite state machine) to coordinate socket lifecycles, reconnects, state resyncs, and seat reclaims.

### 5. Multiplayer Stabilization
- Integrated Socket Event Bus with built-in deduplication mechanisms.
- Established server-side room disconnect grace caching to allow socket re-establishment.

### 6. Production Hardening
- **Server-Authoritative Daily Puzzle Timing**: Eliminated client-provided solve durations. All timing evaluations are computed using server database timestamps.
- **Brute-Force Protection**: Installed rate limit rules on socket lookups, blocking room-scanning attacks (max 5 failed room code lookups per 60 seconds).
- **Centralized Environment Validation**: Server validates environment variables at startup in production and fails fast on errors.

### 7. CI Certification
- Configured a unified `.github/workflows/ci.yml` pipeline that triggers on all pull requests and pushes to `main`.
- Enforces strict validation gates: TypeScript typechecking, JS/TS/CSS linting, dependency rules, Vitest suites, and Playwright E2E browser tests.

### 8. Testing Milestones
- **Server Tests**: 548 vitest tests passing.
- **Client Tests**: 571 vitest tests passing.
- **Behavior Script Scenarios**: 39 behavior scripts passing.
- **Typecheck & Build**: Complete compilation and build passes.
