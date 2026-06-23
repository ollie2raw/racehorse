# ADR-005: Structured Logger and Sentry Integration

**Status:** Accepted  
**Date:** 2026-06

## Context
23 raw `console.error` calls were scattered across production code with no structured context and no error monitoring.

## Decision
All production error logging goes through `src/utils/logger.ts`:
- `logger.error(context, error, extra?)` — logs to console + Sentry
- `logger.warn(context, message, extra?)` — dev-only console warn
- `logger.info(context, message, extra?)` — dev-only console info
- Sentry is enabled in production only when `VITE_SENTRY_DSN` is set

## Consequences
- `console.error` in production code is a lint warning (flagged by `no-console` ESLint rule)
- New errors must use `logger.error` with a meaningful context string
- `VITE_SENTRY_DSN` must be set in production environment variables
- See `.env.example` for the required variable name
