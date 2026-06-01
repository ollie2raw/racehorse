# Tournament Mode — P0 Stabilization Report

**Date:** 2026-05-31  
**Reference:** `docs/tournament-mode-source-of-truth-audit.md`

---

## Security issue fixed

**Before:** `POST` / `DELETE /api/tournaments/:id/register` accepted `body.userId` with **no auth**. Any client could register or withdraw another user if they knew the UUID. Socket `tournament:register` / `tournament:withdraw` trusted `payload.userId` from the client.

**After:** User identity is derived only from verified auth (REST Bearer → Supabase `/auth/v1/user`) or `socket.data.userId` (set by `presence:identify`). Optional payload `userId` must match or request is rejected (`403 user_mismatch`). Client register/withdraw now send the session Bearer token.

---

## Auth behavior (before / after)

| Surface | Before | After |
|---------|--------|-------|
| `POST …/register` | `body.userId` required, no token | `401` without Bearer; `403` if body userId ≠ token user; inserts **token user only** |
| `DELETE …/register` | Same | Same |
| `tournament:register` | `payload.userId` required | `not_authenticated` without socket identity; `user_mismatch` on spoof; registers **socket user** |
| `tournament:withdraw` | Same | Same |
| Client `tournamentApi` | `postJson` / `deleteJson` without auth | `postAuthedJson` / `deleteAuthedJson` with Bearer |

---

## Game-over fallback behavior

**New:** `applyTournamentGameOverFromRoom()` in `engine.ts` (used from `index.ts` game-over scheduler).

1. If `room.scheduledTournamentMatchId` is set → use it (unchanged path).
2. Else if `room.code` → `findTournamentMatchByRoom(room.code)` (DB lookup by `room_code`).
3. If no match id resolved → log warning, return `false` (no throw).
4. On success → `applyMatchResult()` with injectable persistence (tests).

Production `index.ts` also skips ranked logging when a tournament match row exists for `room.code` even without in-memory match id.

---

## Bracket idempotency behavior

**`generateBracket()`** now calls `fetchMatches(tournamentId)` first. If any match rows exist, returns them immediately — **no duplicate inserts**.

Test: `generateBracket idempotency` in `engine.test.ts`.

---

## Files changed

| File | Change |
|------|--------|
| `server/src/scheduledTournament/tournamentAuth.ts` | **New** — shared auth helpers |
| `server/src/scheduledTournament/routes.ts` | Register/withdraw use auth user |
| `server/src/scheduledTournament/socketHandlers.ts` | Socket register/withdraw use socket identity |
| `server/src/scheduledTournament/engine.ts` | Bracket idempotency; `applyTournamentGameOverFromRoom` |
| `server/src/scheduledTournament/index.ts` | Export game-over helper |
| `server/src/index.ts` | Game-over uses `applyTournamentGameOverFromRoom` + room-code terminal guard |
| `client/src/tournament/tournamentApi.ts` | Authed register/withdraw |
| `server/src/scheduledTournament/routes.test.ts` | Auth + spoof tests |
| `server/src/scheduledTournament/socketHandlers.auth.test.ts` | **New** |
| `server/src/scheduledTournament/engine.gameOver.test.ts` | **New** |
| `server/src/scheduledTournament/engine.test.ts` | Bracket idempotency test |
| `TOURNAMENT_README.md` | Doc alignment (30m slots, 2m close, min 1 human + bots) |
| `TOURNAMENT_SMOKE_TEST.md` | Doc alignment |
| `docs/tournament-mode-p0-stabilization-report.md` | This report |

---

## Tests added/updated

| Test file | Coverage |
|-----------|----------|
| `routes.test.ts` | Auth required, user_mismatch, authenticated register/withdraw |
| `socketHandlers.auth.test.ts` | Socket not_authenticated, spoof, identity-only register |
| `engine.gameOver.test.ts` | Direct match id, room-code fallback, no-match false |
| `engine.test.ts` | Double `generateBracket` does not duplicate rows |

---

## Build / test results

| Command | Result |
|---------|--------|
| `npm run build --prefix server` | **Pass** |
| `npm run build --prefix client` | **Pass** |
| `npm test -- scheduledTournament` (19 files, 100 tests) | **Pass** |
| `npm test -- registerRoomSessionHandlers.tournament` | Included above |

---

## Remaining tournament P0 risks (not in this pass)

| Risk | Notes |
|------|-------|
| **Single-process rooms** | Still required for live play; game-over fallback helps DB path only |
| **Multi-instance scheduler** | No DB lease on no-show / bracket tick |
| **`GET /api/tournaments/my?userId=`** | Still query-param based (read-only; lower priority) |
| **Legacy tournament stack** | Still in repo behind env flag |
| **Bracket generate race** | Idempotent on existing rows; concurrent first-time gen still possible at scale |

---

## Recommended next pass (P1)

> **Tournament P1 — attach reliability**  
> Memoize tournament callbacks into `App.tsx`, reduce `/upcoming` N+1, verify offline `match_ready` recovery via `/me` only, add one two-browser smoke script for register → attach → game-over → bracket advance.

---

## Definition of done

- [x] Register/withdraw cannot spoof another user (REST + socket)
- [x] Game-over advances bracket when `scheduledTournamentMatchId` missing but `room_code` exists in DB
- [x] `generateBracket` idempotent when matches already exist
- [x] README/smoke docs match 30m / 2m / MIN_HUMANS=1 + bot fill
- [x] Targeted tests and builds pass
