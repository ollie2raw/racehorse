# Racehorse Architecture Overview

## Domain boundaries

| Domain | Path | Rule |
|--------|------|------|
| API | `src/api/` | No imports from `src/components/` |
| Game logic | `src/game/` | No React imports |
| Dev tools | `src/devtools/` | Not imported by production code |
| Test utils | `src/test/` | Not imported by production code |

Boundaries enforced by `dependency-cruiser` — run `npm run check:deps` to verify.

## Key architectural decisions
- [ADR-001](./ADR-001-shared-api-client.md) — Shared API client
- [ADR-002](./ADR-002-error-boundaries.md) — Error boundary placement  
- [ADR-003](./ADR-003-css-token-system.md) — CSS token system and wl-* freeze
- [ADR-004](./ADR-004-room-player-type.md) — RoomPlayer single source of truth
- [ADR-005](./ADR-005-logger.md) — Structured logger and Sentry

## Quality gates (enforced in CI)
- ESLint: 0 errors, <600 warnings
- stylelint: 0 errors
- TypeScript: 0 errors (`noUnusedLocals: true`)
- Tests: 73+ passing, coverage floors locked in `vite.config.ts`
- Dependency boundaries: `npm run check:deps` clean

## Current health scores (June 2026)
| Category | Score |
|----------|-------|
| Error handling | 8 |
| Code organization | 7 |
| Type safety | 8 |
| API consistency | 6 |
| CSS consistency | 5 |
| Dead code | 8 |
| Test coverage | 7 |
| Duplication | 7 |
| File size/complexity | 5 |
| **Overall** | **7** |
