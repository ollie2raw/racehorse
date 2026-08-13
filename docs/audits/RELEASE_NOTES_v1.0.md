# Release Notes — v1.0

This release establishes the stable production engineering baseline for the Racehorse Dominoes platform.

Version 1.0 represents the completion of the core platform stabilization effort: gameplay correctness, multiplayer reliability, recovery behavior, shared contracts, security hardening, and automated validation infrastructure are now consolidated into a production-ready foundation.

---

# Technical Summary

## 1. Gameplay Engine Stabilization

* Finalized the core dominoes rules engine, including crossed-double branching behavior, scoring calculations, and hand lifecycle management.
* Established deterministic gameplay invariants for:

  * Board layout calculations
  * Pip counting
  * Turn validation
  * Hand completion conditions
  * Score resolution

These invariants provide a stable foundation for future feature development without altering core game correctness.

---

## 2. Workspace Architecture Migration

* Migrated the repository to an npm workspace architecture containing:

  * `client`
  * `server`
  * Shared packages under `packages/*`

* Consolidated dependency management into a single root `package-lock.json`.

* Removed fragmented dependency boundaries between application layers.

---

## 3. Shared Match Protocol Extraction

* Created the `@racehorse/match-protocol` package.
* Centralized shared TypeScript contracts including:

  * Socket payload definitions
  * Match events
  * Shared schemas
  * Client/server communication types

This establishes a single source of truth between multiplayer clients and the server.

---

## 4. Client Recovery Architecture

* Implemented the client-side `RecoveryMachine` finite state machine.
* Coordinates:

  * Socket connection lifecycle
  * Reconnection attempts
  * State synchronization
  * Match recovery flows
  * Seat reclamation

This replaces ad-hoc recovery behavior with explicit state transitions.

---

## 5. Multiplayer Reliability Improvements

* Integrated a Socket Event Bus with event deduplication protections.
* Added server-side disconnect grace caching.
* Enabled players to recover active sessions after temporary socket interruptions.

---

## 6. Production Hardening

### Server-Authoritative Daily Puzzle Timing

* Removed trust in client-provided solve durations.
* Puzzle timing calculations are now derived from server-side database timestamps.

### Brute-Force Protection

* Added socket room lookup rate limiting.
* Failed room-code searches are limited to prevent room enumeration attacks.

### Environment Validation

* Added centralized startup validation for required server environment variables.
* Production deployments fail fast when required configuration is missing or invalid.

---

## 7. Continuous Integration Certification

Implemented unified GitHub Actions CI pipeline:

`.github/workflows/ci.yml`

Validation gates include:

* TypeScript type checking
* JavaScript / TypeScript / CSS linting
* Dependency validation
* Vitest test suites
* Playwright end-to-end browser tests

All pull requests and pushes to `main` are validated automatically.

---

# Testing Certification

Current validation status:

| Category                  |        Result |
| ------------------------- | ------------: |
| Server Vitest Tests       | ✅ 548 passing |
| Client Vitest Tests       | ✅ 571 passing |
| Behavior Script Scenarios |  ✅ 39 passing |
| TypeScript Compilation    |     ✅ Passing |
| Production Build          |     ✅ Passing |
| Browser E2E Validation    |     ✅ Passing |

---

# Production Baseline Status

Racehorse Dominoes v1.0 is certified as the stable multiplayer engineering baseline.

Future work should focus on:

* New gameplay features
* UX improvements
* Isolated bug fixes
* Performance improvements

Core architecture, multiplayer recovery flows, shared protocol contracts, and validation infrastructure should be treated as the established foundation for future development.