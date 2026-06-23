# ADR-001: Shared API Client

**Status:** Accepted  
**Date:** 2026-06

## Context
Before this change, 11 different files made `fetch` calls with manually constructed auth headers. 401 token refresh was handled inconsistently or not at all. Any change to auth header format required touching 11 files.

## Decision
Centralize all HTTP calls through `src/api/client.ts`. This file owns:
- Auth header construction (`getAuthHeaders`)
- 401 detection and token refresh
- Consistent `ApiResult<T>` return type (never throws — returns `{ ok, data, error }`)
- Debug ingest isolation

## Consequences
- All new API calls must go through `apiGet`, `apiPost`, or `apiDelete`
- `apiFetch` is private — not exported
- 401 refresh is automatic and tested
- Adding a new auth scheme requires changing one file
