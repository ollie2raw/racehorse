# ADR-002: Error Boundary Placement

**Status:** Accepted  
**Date:** 2026-06

## Context
Unhandled React render errors were crashing the entire app with a blank white screen and no recovery path.

## Decision
Place `ErrorBoundary` at three levels:
1. **Root** (`main.tsx`) — catches catastrophic failures, shows generic fallback
2. **Route level** (`AppRoutes.tsx`) — wraps each major screen so one screen crash doesn't kill navigation
3. **Component level** — wraps high-risk async components (tournament bracket, etc.)

Each boundary is tagged with a `context` string that flows to Sentry for grouping.

## Consequences
- All new screens added to AppRoutes must be wrapped in `<ErrorBoundary context="screen-name">`
- Custom fallback UIs go in `src/components/` next to `DefaultErrorFallback.tsx`
- ErrorBoundary is class-based (React requirement) — do not convert to functional
