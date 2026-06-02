# P0 Security + Abuse Stabilization Plan

Date: 2026-06-02  
Source: `docs/mass-production-readiness-audit.md`  
Scope: controlled public-beta hardening only. No UI changes, gameplay redesign, durable room store, Redis, or broad architecture refactor.

## Executive Plan

This pass closes the smallest obvious abuse holes that are safe in the current single-instance deployment model:

1. Add lightweight in-memory REST and socket rate limits.
2. Audit Ghost completion auth and preserve the existing verified-match ownership checks.
3. Harden quick-match queue identity so authenticated queue entries use `socket.data.userId`, not arbitrary payload `userId`.
4. Document the Daily Puzzle server-side validation/scoring implementation plan without attempting a broad rewrite.
5. Improve admin/cron endpoint posture with rate limits and constant-time secret comparison where secrets are compared in-process.

Future production scale requires Redis/shared rate limits, durable live room state, stronger DB idempotency constraints, and full server-side puzzle scoring.

## 1. Rate Limiting Strategy

### Current beta implementation

Use process-local in-memory token windows because the current launch model is single-instance Render backend. Limits reset on deploy/restart and do not protect multi-instance deployments.

REST buckets:

| Surface | Strategy |
|---|---|
| General `/api`, `/league`, `/bot-matches` | Per-IP medium window to reduce scraping/spam. |
| Daily submissions | Tighter per-IP limits for Daily Fritz record/complete/next-hand and Daily Puzzle submit/complete. |
| Admin endpoints | Strict per-IP limit for body `adminKey` routes. |
| Cron endpoints | Strict per-IP limit for cron/warmup routes. |
| Social/friend REST | Covered by general API limit; future pass should add per-user friend-request limits. |

Socket buckets:

| Event | Strategy |
|---|---|
| `room:create` | Per socket/user/IP limit. |
| `room:join` | Per socket/user/IP limit. |
| `room:spectate` | Per socket/user/IP limit. |
| `queue:join` | Per socket/user/IP limit. |
| `friend:invite`, `friend:invite:decline` | Per socket/user/IP limit. |
| `room:chat:send`, `room:emote:send` | Per socket/user/IP limit. |
| `game:action`, `hand:ready`, `player:ready` | Higher gameplay-safe limits. |
| Other socket events | Broad default socket event limit. |

### Future production requirement

Move these limits to Redis or another shared limiter before multi-instance deploy. Required keys should include user id when authenticated, IP / forwarded IP for unauthenticated traffic, route/event name, and optionally room code for room-specific spam control.

## 2. Ghost Completion Auth/Spoofing

Audit result: `/api/ghost/complete` is already hardened relative to the audit finding:

- Calls `getAuthenticatedUserId(req)`.
- Rejects unauthenticated requests with `401`.
- Rejects body `userId` mismatch with `403`.
- Requires a known verified single-player match by `matchId`.
- Verifies the match belongs to the authenticated user.
- Verifies `localMatchId`, `opponentUserId`, and mode.
- Uses a completion hash and returns idempotent replay only when the existing completion hash matches.

Small implementation stance:

- Do not rewrite Ghost completion in this pass.
- Keep the endpoint under daily/submission API rate limits.
- Add/keep tests around auth/spoofing in a future route-level test pass if `server/src/index.ts` is modularized enough to make the route test cheap.

## 3. Quick-Match Identity Hardening

Current risk:

- `queue:join` accepts `payload.userId` and `payload.username`.
- Authenticated clients identify the socket via `presence:identify`, but queue join should not trust a forged payload UUID.

Implementation:

- Resolve queue identity from `socket.data.userId` when present.
- If `socket.data.userId` exists and `payload.userId` differs, reject with `user_mismatch`.
- If no authenticated socket user exists, allow only explicit guest queue identities with non-UUID guest ids, and mark them unranked/default-rated.
- Add tests for authenticated identity preference and spoof rejection.

Future:

- Split ranked authenticated queue from guest casual queue in product/API naming.
- Persist queue attempts and abuse metrics.

## 4. Daily Puzzle Anti-Spoofing Plan

Do not fully rewrite in this pass.

Server should eventually verify:

- Attempt ownership and date/set-version binding, already mostly present.
- `puzzleId` belongs to the attempt's set version.
- Submitted line uses exactly legal domino placements from the starting board/hand.
- Every tile in `submittedLine` exists in the starting hand and is used at most once.
- Every placement is legal against canonical open ends.
- `rawScore` is recomputed server-side from the submitted line and objective.
- `movesUsed` is recomputed from accepted placements.
- `elapsedSeconds` is bounded/sanitized but not trusted for competitive scoring unless server-timed.

Client fields that should become UX-only:

- `rawScore`
- `movesUsed`
- `elapsedSeconds`
- `clientResult`
- Any client-calculated perfect/solved flags

Required tests:

- Fake high `rawScore` is ignored/rejected.
- Illegal submitted tile is rejected.
- Duplicate tile use is rejected.
- Legal perfect solution scores correctly.
- Duplicate submit remains idempotent.
- Slot order and set-version binding still pass.

## 5. Admin/Cron Endpoint Posture

Current risk:

- Several admin endpoints compare `req.body.adminKey` directly to `ADMIN_SECRET`.
- Cron endpoint compares header/Bearer secret directly to `DAILY_PUZZLE_CRON_SECRET`.

Implementation:

- Add strict rate limits for admin/cron endpoints.
- Use constant-time comparison helper for in-process secret checks.
- Keep response behavior compatible: unauthorized admin routes continue returning existing 401/403 status patterns.
- Do not log secrets.

Future:

- Replace body `adminKey` with authenticated admin role or signed server-only cron token.
- Add audit logs for admin actions without secret values.

## Validation Plan

Run:

```bash
npm run build --prefix server
npm test --prefix server
npm run build --prefix client
```

Targeted tests to add:

- Rate limiter unit tests.
- Queue identity spoof rejection tests.

## Deferred Items

- Redis/shared limiter.
- Durable room state.
- Full Daily Puzzle server validator/scorer.
- Modular `server/src/index.ts` route-level tests for Ghost endpoint.
- DB idempotency migrations.

