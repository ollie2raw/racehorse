# Phase: Server `index.ts` REST Route Extraction Report (Phase 1 of 2)

## Goal

Extract all 40 REST route handlers from `server/src/index.ts` (~5,385 LOC) into domain-scoped modules under `server/src/http/routes/`, following the same composition pattern used for Bot Match and Live Match Session on the client. Route handlers are registered via explicit `registerXRoutes(app, deps)` functions; shared helpers used by both routes and Socket.IO realtime code live in `server/src/shared/` or `server/src/http/stores/`. This is Phase 1 only — REST routes, not Socket.IO setup, matchmaking, or presence. No behavior change: same paths, methods, middleware, response shapes, and error handling.

## Before / After LOC

| File | Before | After |
|------|--------|-------|
| `server/src/index.ts` | 5,385 | **1,631** |

### New route modules (`server/src/http/routes/`)

| File | LOC | Routes |
|------|-----|--------|
| `stats.ts` | 129 | `GET /api/mp-stats`, `GET /api/home/daily-summary`, `POST /api/stats/record-match` |
| `ranking.ts` | 162 | `GET /api/ranking/profile/:userId`, `GET /api/ranking/leaderboard`, `GET /api/ranking/history/:userId`, `POST /api/ranking/process/:userId` |
| `ghost.ts` | 323 | `GET /api/ghost/profile/:userId`, `GET /api/ghost/profile-by-username/:username`, `POST /api/ghost/complete`, `POST /api/ghost/start` |
| `league.ts` | 422 | 8 `/league/*` endpoints |
| `botMatches.ts` | 222 | `POST /bot-matches/cleanup-stale`, `POST /api/bot-matches/local/start`, `/local/resolve`, `/local/abandon` |
| `dailyPuzzle.ts` | 416 | 5 daily-puzzle routes + `GET/POST /api/cron/daily-puzzle-ladder-warm` |
| `dailyFritz.ts` | 931 | 10 `/api/daily-fritz/*` routes |
| `roomEvents.ts` | 64 | `GET /api/room-events/:matchId` |

**Route modules total:** 2,669 LOC

### Supporting modules (helpers extracted from `index.ts`)

| File | LOC | Role |
|------|-----|------|
| `server/src/shared/pacificDate.ts` | 64 | Pacific timezone date keys and warmup scheduling |
| `server/src/shared/verifiedSinglePlayerMatch.ts` | 292 | Verified ghost/Fritz session persistence + ghost move-log validation |
| `server/src/shared/fritzMatchLifecycle.ts` | 217 | Fritz forfeit, pending-match insert/resolve, ranked abandon (routes + socket) |
| `server/src/http/stores/homeCompletionDates.ts` | 53 | Homepage daily completion date queries |
| `server/src/http/stores/dailyPuzzleStore.ts` | 330 | Daily puzzle DB layer, cron warm handler, `isRequestPuzzleGenerationEnabled` |
| `server/src/http/stores/dailyFritzStore.ts` | 616 | Daily Fritz DB layer, normalization, cache, leaderboard |

**Supporting modules total:** 1,572 LOC

## Dependency-mapping decisions

### Route-exclusive → moved with routes or into `http/stores/`

| Helper / state | Destination | Used by |
|----------------|-------------|---------|
| `listCompletedDailyFritzDatesForUser`, `listCompletedDailyPuzzleLadderDatesForUser`, `listCompletedLegacyDailyPuzzleDatesForUser`, `isMissingRelationError` | `http/stores/homeCompletionDates.ts` | `stats` routes |
| `isSafeGhostMoveLog`, `isGhostTileKey`, `isGhostBranch`, `buildGhostCompletionHash` | `shared/verifiedSinglePlayerMatch.ts` | `ghost` routes |
| Verified match maps + CRUD | `shared/verifiedSinglePlayerMatch.ts` | ghost, bot, daily-fritz routes |
| Daily puzzle attempt/slot/leaderboard DB helpers, `handleDailyPuzzleLadderCronWarm`, `isAuthorizedDailyPuzzleCronRequest`, `isRequestPuzzleGenerationEnabled` | `http/stores/dailyPuzzleStore.ts` | `dailyPuzzle` routes |
| Daily Fritz types, `dailyFritzRunCache`, normalization, attempt/run DB, `buildDailyFritzLeaderboard`, `getDailyFritzStreak` | `http/stores/dailyFritzStore.ts` | `dailyFritz` routes |
| `parseOptionalActivityScore` | `shared/fritzMatchLifecycle.ts` | `botMatches` abandon route only among REST; colocated with forfeit chain |

### Shared routes + realtime → `server/src/shared/`

| Helper | REST consumers | Realtime consumers |
|--------|----------------|-------------------|
| `formatFritzActivityOpponentLabel` | `ghost/complete` | `createGameOverPersistScheduler` activity feed |
| `getFritzIdentityForTier` | bot local/start, daily-fritz/start | `recordPendingFritzDisconnectLoss` (disconnect forfeit) |
| `finalizeFritzForfeit` | bot cleanup-stale, local/abandon | `socket.on('disconnect')` Fritz forfeit |
| `getPendingFritzMatchContext`, `insertPendingFritzMatch`, `resolvePendingFritzMatch` | — | `onAfterMatchStarted`, `createGameOverPersistScheduler` |
| `queryVerifiedSinglePlayerMatchByLocalKey` | ghost/bot/daily-fritz routes | `resolveLocalFritzAbandonRankedSource` → disconnect forfeit |
| Full `fritzMatchLifecycle.ts` exports | bot + ghost (partial) | game-over persist, disconnect, match start |

### Shared routes + startup / health → split between `shared/` and `http/stores/`

| Helper | REST | Startup / health |
|--------|------|------------------|
| `getPacificDateKey`, `getPacificDateKeyDaysFromNow`, `getNextPacificWarmupAt`, `getPacificDateTimeParts`, `getPacificOffsetMinutes` | all daily modes, stats home summary | `registerHealthRoutes` `/ready`, warmup schedulers, `server.listen` |
| `listDailyPuzzleSlotsForDate` | via `listDailyPuzzleSlotsForDateWithAutoSeed` | `registerHealthRoutes` `/ready` |
| `ensureDailyFritzRunForDate`, `getDailyFritzRun`, `dailyFritzRunCache` | daily-fritz routes | `warmDailyFritzRuns` in `index.ts` |
| `listDailyPuzzleSlotsForDateWithAutoSeed` | daily-puzzle routes | `warmDailyPuzzleLadders` imports store helpers |

### Kept in `index.ts` (socket / process / warmup only)

| Symbol | Reason |
|--------|--------|
| `installSocketRateLimit`, `SOCKET_EVENT_LIMITS`, `socketRateLimiter` | Socket.IO only |
| `tryHydrateMatchmakingRoomShell`, `waitUntilMatchmakingRoomSocketsReady`, `MATCHMAKING_JOIN_SYNC_MAX_MS` | Passed to `initRoomSession` |
| `emitPresenceUpdateToFriends`, `socketsByUserId` | Socket presence + league state route dep |
| `normalizeUsername`, `normalizeUserId`, `normalizeAuthToken`, `resolveSocketIdentity`, `isUuidLike` | Socket identity + `initRoomSession` |
| `createGameOverPersistScheduler` | Game-over persist hook (ranking, league, Fritz) |
| `warmDailyFritzRuns`, `scheduleDailyFritzWarmup`, `warmDailyPuzzleLadders`, `scheduleDailyPuzzleLadderWarmup`, `isTruthyEnvFlag`, `isStartup*`, `yieldEventLoop` | `server.listen` boot warmups |
| `getProcessErrorLogPayload` | `process.on('unhandledRejection'/'uncaughtException')` only |
| Rate limiter middleware (`app.use` lines 377–392) | Global Express middleware — unchanged in `index.ts` |

### Rate limiter instances (unchanged location)

| Instance | Applied to |
|----------|------------|
| `restRateLimiter` | Backing store for all REST middleware |
| `socketRateLimiter` | `installSocketRateLimit` per Socket.IO event |
| `restApiLimit` | `/api`, `/league`, `/bot-matches` |
| `dailySubmitLimit` | daily-puzzle submit/complete, daily-fritz next-hand/record-game/complete |
| `adminLimit` | daily-fritz admin, ranking process, league jobs, bot cleanup |
| `cronLimit` | `/api/cron` |

## Responsibility map

| Domain | Routes | Module |
|--------|--------|--------|
| stats / home | `/api/mp-stats`, `/api/home/daily-summary`, `/api/stats/record-match` | `http/routes/stats.ts` |
| ranking | 4 `/api/ranking/*` | `http/routes/ranking.ts` |
| ghost | 4 `/api/ghost/*` | `http/routes/ghost.ts` |
| league | 8 `/league/*` | `http/routes/league.ts` |
| botMatches | 4 bot-match routes | `http/routes/botMatches.ts` |
| dailyPuzzle | 7 puzzle + cron warm | `http/routes/dailyPuzzle.ts` |
| dailyFritz | 10 fritz routes | `http/routes/dailyFritz.ts` |
| roomEvents | `/api/room-events/:matchId` | `http/routes/roomEvents.ts` |

## `index.ts` registration wiring (complete)

Routes register **after** `const io = new Server(...)` and `socketsByUserId` creation so `/api/mp-stats` and league online checks receive live `io` / presence map. No `app.get`/`app.post` remain in `index.ts`.

```typescript
const socketsByUserId = new Map<string, Set<string>>();
registerStatsRoutes(app, {
  io,
  getRoomRuntimeStats,
  ROOM_CLEANUP_GRACE_MS,
  getPacificDateKey,
  getAuthenticatedUserId,
  buildHomeDailySummary,
  createHomeDailyCompletionMap,
  listCompletedDailyFritzDatesForUser,
  listCompletedDailyPuzzleLadderDatesForUser,
  listCompletedLegacyDailyPuzzleDatesForUser,
  recordUserMatch,
});

registerRankingRoutes(app, {
  supabaseFetch,
  getAuthenticatedUserId,
  isAdminSecret,
  getLeaderboard,
  processRatingPeriod,
  computeOnlineCurrentWinStreak,
  isFritzId,
  DEFAULT_RATING,
  DEFAULT_RD,
});

registerGhostRoutes(app, {
  getAuthenticatedUserId,
  isFritzId,
  getVerifiedSinglePlayerMatch,
  persistVerifiedSinglePlayerMatch,
  startVerifiedSinglePlayerMatch,
  isSafeGhostMoveLog,
  buildGhostCompletionHash,
  writeMatchActivity,
  formatFritzActivityOpponentLabel,
  supabaseFetch,
});

registerLeagueRoutes(app, {
  getAuthenticatedUserId,
  supabaseFetch,
  isAdminSecret,
  socketsByUserId,
});

registerBotMatchesRoutes(app, {
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromToken,
  supabaseFetch,
  isAdminSecret,
  startVerifiedSinglePlayerMatch,
  abandonVerifiedSinglePlayerMatch,
  getFritzIdentityForTier,
  finalizeFritzForfeit,
  parseOptionalActivityScore,
});

registerDailyPuzzleRoutes(app);
registerDailyFritzRoutes(app);

registerRoomEventsRoutes(app, {
  getAuthenticatedUserId,
  queryPersistedRoomMatchLog,
  isRoomMatchLogsPersistenceAvailable,
});
```

`registerDailyPuzzleRoutes` and `registerDailyFritzRoutes` take only `app` — they import store/shared modules directly (no closure over `index.ts` internals).

## Test results

| Suite | Before | After |
|-------|--------|-------|
| Server vitest (`cd server && npm test`) | 434 passed (60 files) | **434 passed (60 files)** |
| Client vitest (`cd client && npm test`) | 402 passed (42 files) | **402 passed (42 files)** |
| Client behavior (`node run-behavior-tests.mjs`) | 31 suites | **31 suites** |
| Server build (`npm run build --prefix server`) | — | **Passed** |
| Client build (`npm run build --prefix client`) | — | **Passed** |

### Route inventory verification

`grep 'app\.(get|post)' server/src/http/routes` → **40 handlers** across 8 files (matches pre-extraction count). `grep` on `index.ts` → **0** route handlers.

## Deviations from plan

1. **Registration moved after `io` creation.** Originally some routes (352–1230) registered before `const io`. They now register at line ~449 after `io` exists. Handler behavior is unchanged; `io` was always resolved at request time via closure.

2. **`dailyPuzzle.ts` / `dailyFritz.ts` use zero-deps registrars.** Store modules are imported directly rather than passed through `index.ts`, reducing the registration object size. Explicit-deps rule still holds — dependencies are module imports, not `index.ts` closures.

3. **Helper stores under `http/stores/` not `shared/`** for daily puzzle/Fritz DB layers. These are route-primary but also used by `index.ts` warmup schedulers and health checks; `shared/` holds cross-cutting Fritz/verified-match/pacific helpers only.

4. **Test file outside `index.ts` scope:** `server/src/dailyPuzzleGeneration.test.ts` line 244 now reads `http/stores/dailyPuzzleStore.ts` instead of `index.ts` for `isRequestPuzzleGenerationEnabled` source assertion (required after helper move).

## Explicitly not touched

- `io.on('connection', ...)` and all Socket.IO handler registration (line ~1041+)
- Matchmaking (`registerMatchmakingHandlers`, queue/pairing/persistence modules)
- Presence (`upsertPresence`, `presence:identify` handlers)
- `recoveryMachine.ts`, `socketEventBus.ts`, client `useRoomSocketSync.ts` projection gates
- `client/src/modules/`, `client/src/bot/`, `client/src/match/session/`
- `App.tsx`, `server/src/index.ts` rate-limiter `app.use` middleware block
- `registerHealthRoutes` implementation (pre-existing `platform/health/`)

## Remaining debt / Phase 2 candidates

1. **Extract Socket.IO connection block** (`io.on('connection')` ~600+ LOC) into `server/src/realtime/` registrars — Phase 2 scope.
2. **Extract `createGameOverPersistScheduler`** (~250 LOC) — tightly coupled to `io`, ranking, league, Fritz lifecycle; natural Phase 2 companion.
3. **Extract warmup schedulers** (`warmDailyFritzRuns`, `scheduleDailyPuzzleLadderWarmup`, etc.) — could move to `server/src/jobs/` once route stores are stable.
4. **Trim `index.ts` imports** — several `dailyPuzzle`/`dailyFritz` type imports may now only serve warmup paths; safe cleanup pass after Phase 2.
5. **Route-level integration tests** — no new HTTP route tests added in Phase 1; consider smoke tests per `registerXRoutes`.

---

## Appendix A — Full source (files ≤ 130 LOC)

### `server/src/shared/pacificDate.ts`

```typescript
export function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getPacificDateTimeParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: getNumber('year'),
    month: getNumber('month'),
    day: getNumber('day'),
    hour: getNumber('hour'),
    minute: getNumber('minute'),
    second: getNumber('second'),
  };
}

export function getPacificOffsetMinutes(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-8';
  const match = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return -8 * 60;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

export function getPacificDateKeyDaysFromNow(daysFromNow: number): string {
  return getPacificDateKey(new Date(Date.now() + daysFromNow * 86400000));
}

export function getNextPacificWarmupAt(hour = 0, minute = 2): Date {
  const now = new Date();
  const pacific = getPacificDateTimeParts(now);
  const nextUtcGuess = new Date(Date.UTC(pacific.year, pacific.month - 1, pacific.day + 1, hour, minute, 0, 0));
  const offsetMinutes = getPacificOffsetMinutes(nextUtcGuess);
  return new Date(nextUtcGuess.getTime() - offsetMinutes * 60000);
}
```

### `server/src/http/stores/homeCompletionDates.ts`

See repo file (53 LOC) — exports `isMissingRelationError`, `listCompletedDailyFritzDatesForUser`, `listCompletedDailyPuzzleLadderDatesForUser`, `listCompletedLegacyDailyPuzzleDatesForUser`.

### `server/src/http/routes/stats.ts`

See repo file (129 LOC) — exports `StatsRouteDeps`, `registerStatsRoutes`.

### `server/src/http/routes/roomEvents.ts`

See repo file (64 LOC) — exports `RoomEventsRouteDeps`, `registerRoomEventsRoutes`.

## Appendix B — Large module export surfaces (full source in repo)

### `server/src/shared/verifiedSinglePlayerMatch.ts` (292 LOC)

Exports: `isSafeGhostMoveLog`, `buildGhostCompletionHash`, `startVerifiedSinglePlayerMatch`, `getVerifiedSinglePlayerMatch`, `persistVerifiedSinglePlayerMatch`, `abandonVerifiedSinglePlayerMatch`, `queryVerifiedSinglePlayerMatchByLocalKey`, `queryVerifiedSinglePlayerMatchByMatchId`.

### `server/src/shared/fritzMatchLifecycle.ts` (217 LOC)

Exports: `getFritzTierForRoom`, `getPendingFritzMatchContext`, `formatFritzActivityOpponentLabel`, `parseOptionalActivityScore`, `readFritzForfeitScoresFromRoom`, `writeFritzForfeitActivityFeed`, `finalizeFritzForfeit`, `getFritzIdentityForTier`, `insertPendingFritzMatch`, `resolvePendingFritzMatch`, `localMatchIdFromRoomCode`, `resolveLocalFritzAbandonRankedSource`, `recordPendingFritzDisconnectLoss`.

### `server/src/http/stores/dailyPuzzleStore.ts` (330 LOC)

Key exports: `isRequestPuzzleGenerationEnabled`, `listDailyPuzzleSlotsForDate`, `listDailyPuzzleSlotsForDateWithAutoSeed`, `handleDailyPuzzleLadderCronWarm`, all attempt/slot CRUD, `buildDailyPuzzleLeaderboardForDate`, `getDailyPuzzleLadderStreak`.

### `server/src/http/stores/dailyFritzStore.ts` (616 LOC)

Key exports: `dailyFritzRunCache`, `getDailyFritzRun`, `ensureDailyFritzRunForDate`, `buildDailyFritzLeaderboard`, all normalization helpers used by `dailyFritz.ts` routes and `index.ts` warmups.

### Route modules > 160 LOC

| File | Export |
|------|--------|
| `ranking.ts` | `registerRankingRoutes(app, RankingRouteDeps)` |
| `ghost.ts` | `registerGhostRoutes(app, GhostRouteDeps)` |
| `league.ts` | `registerLeagueRoutes(app, LeagueRouteDeps)` |
| `botMatches.ts` | `registerBotMatchesRoutes(app, BotMatchesRouteDeps)` |
| `dailyPuzzle.ts` | `registerDailyPuzzleRoutes(app)` |
| `dailyFritz.ts` | `registerDailyFritzRoutes(app)` |

Full implementations: `server/src/http/routes/<name>.ts` in this repository.

## Appendix C — Files changed in this phase

| Path | Change |
|------|--------|
| `server/src/index.ts` | Removed ~3,754 lines of routes + extracted helpers; added route registration + shared imports |
| `server/src/http/routes/*.ts` | **New** (8 files) |
| `server/src/shared/*.ts` | **New** (3 files) |
| `server/src/http/stores/*.ts` | **New** (3 files) |
| `server/src/dailyPuzzleGeneration.test.ts` | Updated source-read path for `isRequestPuzzleGenerationEnabled` |
| `docs/phase-server-index-route-extraction-report.md` | **New** (this file) |

## Rate-limiter parity audit

**Audit date:** 2026-07-04  
**Baseline:** `git show HEAD:server/src/index.ts` (pre-extraction committed `index.ts`)  
**Current:** `server/src/index.ts` + `server/src/http/routes/*.ts`

### Mechanism (unchanged)

Rate limiting was **never** attached as per-route `app.get`/`app.post` middleware arguments in the original `index.ts`. Every extracted route was registered as `app.<method>(path, handler)` with a single handler — verified by scanning all 41 `app.get`/`app.post` registrations in the committed file (none pass `restApiLimit`, `dailySubmitLimit`, `adminLimit`, or `cronLimit` inline).

Limiting is applied globally via prefix `app.use` middleware in `index.ts` (lines 377–392), registered **before** `registerXRoutes(...)` (lines 449–514). That registration order is identical to pre-extraction (global limiters at ~304–319, inline routes at ~568+).

```typescript
app.use('/api/cron', cronLimit);
app.use('/api/daily-puzzle/submit-slot', dailySubmitLimit);
app.use('/api/daily-puzzle/complete', dailySubmitLimit);
app.use('/api/daily-fritz/next-hand', dailySubmitLimit);
app.use('/api/daily-fritz/record-game', dailySubmitLimit);
app.use('/api/daily-fritz/complete', dailySubmitLimit);
app.use('/api/daily-fritz/generate', adminLimit);
app.use('/api/daily-fritz/invalidate', adminLimit);
app.use('/api/daily-fritz/reset-attempt', adminLimit);
app.use('/api/ranking/process', adminLimit);
app.use('/league/run-forfeits', adminLimit);
app.use('/league/run-rollover', adminLimit);
app.use('/bot-matches/cleanup-stale', adminLimit);
app.use('/api', restApiLimit);
app.use('/league', restApiLimit);
app.use('/bot-matches', restApiLimit);
```

Limiter instances (`restApiLimit`, `dailySubmitLimit`, `adminLimit`, `cronLimit`) are the same four objects created once in `index.ts` (lines 365–375); no new limiters were introduced during extraction.

**Column definitions:**

| Column | Meaning |
|--------|---------|
| **Original per-route chain** | Middleware arguments on the `app.get`/`app.post` call itself |
| **Original effective chain** | Per-route chain + matching global `app.use` limiters in registration order |
| **Current per-route chain** | Middleware arguments on the extracted `registerXRoutes` registration |
| **Current effective chain** | Per-route chain + same global `app.use` limiters (still in `index.ts`) |

### `stats.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/mp-stats` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/home/daily-summary` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/stats/record-match` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |

### `ranking.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/ranking/profile/:userId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/ranking/leaderboard` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/ranking/history/:userId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/ranking/process/:userId` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |

### `ghost.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/ghost/profile/:userId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/ghost/profile-by-username/:username` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/ghost/complete` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/ghost/start` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |

### `league.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `POST /league/assign-player` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /league/generate-fixtures` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /league/report-result` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /league/run-forfeits` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |
| `POST /league/run-rollover` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |
| `GET /league/state/:userId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /league/history/:userId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /league/fixture/:fixtureId/live-room` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |

*Note:* `generate-fixtures`, `assign-player`, and `report-result` are auth-gated in-handler (`getAuthenticatedUserId` / membership checks) but were **not** behind `adminLimit` before extraction; only `run-forfeits` and `run-rollover` had the admin rate limiter prefix.

### `botMatches.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `POST /bot-matches/cleanup-stale` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |
| `POST /api/bot-matches/local/start` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/bot-matches/local/resolve` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/bot-matches/local/abandon` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |

*Note:* `/api/bot-matches/*` paths match `app.use('/api', restApiLimit)` only — not `app.use('/bot-matches', restApiLimit)`. This was true before and after extraction.

### `dailyPuzzle.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/daily-puzzle/today` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/daily-puzzle/start` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/daily-puzzle/submit-slot` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | **match** |
| `POST /api/daily-puzzle/complete` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | **match** |
| `GET /api/daily-puzzle/leaderboard` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/cron/daily-puzzle-ladder-warm` | *(handler only)* | `cronLimit` → `restApiLimit` | *(handler only)* | `cronLimit` → `restApiLimit` | **match** |
| `POST /api/cron/daily-puzzle-ladder-warm` | *(handler only)* | `cronLimit` → `restApiLimit` | *(handler only)* | `cronLimit` → `restApiLimit` | **match** |

*Note:* Daily Puzzle has no `generate`/`invalidate` admin endpoints; those live on Daily Fritz.

### `dailyFritz.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/daily-fritz/today` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/daily-fritz/start` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/daily-fritz/next-hand` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | **match** |
| `POST /api/daily-fritz/record-game` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | **match** |
| `POST /api/daily-fritz/complete` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | *(handler only)* | `dailySubmitLimit` → `restApiLimit` | **match** |
| `POST /api/daily-fritz/abandon` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `GET /api/daily-fritz/leaderboard/:date` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |
| `POST /api/daily-fritz/generate` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |
| `POST /api/daily-fritz/invalidate` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |
| `POST /api/daily-fritz/reset-attempt` | *(handler only)* | `adminLimit` → `restApiLimit` | *(handler only)* | `adminLimit` → `restApiLimit` | **match** |

### `roomEvents.ts`

| Route | Original per-route chain | Original effective chain | Current per-route chain | Current effective chain | Result |
|-------|--------------------------|--------------------------|-------------------------|-------------------------|--------|
| `GET /api/room-events/:matchId` | *(handler only)* | `restApiLimit` | *(handler only)* | `restApiLimit` | **match** |

### Summary

| Metric | Value |
|--------|-------|
| Routes audited | **41** (40 REST endpoints + cron warm registered as GET + POST) |
| Mismatches found | **0** |
| Code fixes applied | **None** — parity already correct via unchanged global `app.use` block |

**Confirmation:** No rate-limiter middleware was missing from any extracted route file. Re-adding limiters per-route would duplicate the existing global middleware and change nothing functionally; no such change was made.

---

## Full source — Appendix D

### `server/src/http/routes/ranking.ts`

```typescript
import type { Application, Request } from 'express';

export type RankingRouteDeps = {
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  isAdminSecret: (value: unknown) => boolean;
  getLeaderboard: (limit: number) => Promise<unknown[]>;
  processRatingPeriod: (userId: string) => Promise<unknown>;
  computeOnlineCurrentWinStreak: (
    userId: string,
    matchRows: Array<{
      winner_user_id: string | null;
      loser_user_id: string | null;
      mode: string;
      created_at: string;
    }>,
  ) => number;
  isFritzId: (id: string) => boolean;
  DEFAULT_RATING: number;
  DEFAULT_RD: number;
};

export function registerRankingRoutes(app: Application, deps: RankingRouteDeps): void {
  const {
    supabaseFetch,
    getAuthenticatedUserId,
    isAdminSecret,
    getLeaderboard,
    processRatingPeriod,
    computeOnlineCurrentWinStreak,
    isFritzId,
    DEFAULT_RATING,
    DEFAULT_RD,
  } = deps;

  app.get('/api/ranking/profile/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}`);
      const profile = profileData?.[0];
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const allProfiles = await supabaseFetch<any[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc`);
      const rankIndex = allProfiles.findIndex((p) => p.id === userId);

      const enc = encodeURIComponent(userId);
      const matchRows = await supabaseFetch<
        Array<{ winner_user_id: string | null; loser_user_id: string | null; mode: string; created_at: string }>
      >(
        `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&select=winner_user_id,loser_user_id,mode,created_at&order=created_at.asc`,
      );
      const currentWinStreak = computeOnlineCurrentWinStreak(userId, matchRows ?? []);

      res.json({
        ok: true,
        glicko_rating: profile.glicko_rating,
        glicko_rd: profile.glicko_rd,
        provisional: profile.provisional,
        ranked_games_played: profile.ranked_games_played,
        peak_rating: profile.peak_rating,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        currentWinStreak,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load ranking profile.',
      });
    }
  });

  app.get('/api/ranking/leaderboard', async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    try {
      const leaderboard = await getLeaderboard(limit);
      res.json({ ok: true, leaderboard });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load leaderboard.',
      });
    }
  });

  app.get('/api/ranking/history/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}&limit=1`);
      const profile = profileData?.[0];
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const games = await supabaseFetch<any[]>(
        `/rest/v1/ranked_games?player_id=eq.${userId}` +
          `&rating_after=not.is.null&select=played_at,rating_after,rd_after,delta,opponent_id,player_score,opponent_score` +
          `&order=played_at.asc,id.asc`,
      );

      res.json({
        ok: true,
        games: games.map((game) => ({
          played_at: game.played_at,
          rating_after: Number(game.rating_after ?? 0),
          rd_after: Number(game.rd_after ?? 350),
          delta: Number(game.delta ?? 0),
          opponent_id: String(game.opponent_id ?? ''),
          player_score: Number(game.player_score ?? 0),
          opponent_score: Number(game.opponent_score ?? 0),
          is_fritz: isFritzId(game.opponent_id),
        })),
        currentRating: Number(profile.glicko_rating ?? DEFAULT_RATING),
        peakRating: Number(profile.peak_rating ?? profile.glicko_rating ?? DEFAULT_RATING),
        provisional: Boolean(profile.provisional),
        rd: Number(profile.glicko_rd ?? DEFAULT_RD),
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load rating history.',
      });
    }
  });

  app.post('/api/ranking/process/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const result = await processRatingPeriod(userId);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to process rating period.',
      });
    }
  });
}
```

### `server/src/http/routes/league.ts`

```typescript
import type { Application, Request } from 'express';
import { assignPlayerToLeague } from '../../league/service';
import { generateLeagueFixtures } from '../../league/schedule';
import {
  recordLeagueAsyncResult,
  recordLeagueLiveResult,
  openLeagueFixtureLiveRoom,
} from '../../league/results';
import { runLeagueForfeitJob } from '../../league/forfeit';
import { runLeagueSundayRollover } from '../../league/rollover';
import { getLeagueStateForPlayer } from '../../league/state';
import { getLeagueHistoryForPlayer } from '../../league/history';
import { createReservedRoom, getRoom } from '../../rooms';
import { makeCode } from '../../tournament/tournament';

export type LeagueRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  socketsByUserId: Map<string, Set<string>>;
};

export function registerLeagueRoutes(app: Application, deps: LeagueRouteDeps): void {
  const { getAuthenticatedUserId, supabaseFetch, isAdminSecret, socketsByUserId } = deps;

  app.post('/league/assign-player', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const assignment = await assignPlayerToLeague(userId);
      res.json({ ok: true, assignment });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to assign player to league.',
      });
    }
  });

  app.post('/league/generate-fixtures', async (req, res) => {
    const leagueId = typeof req.body?.leagueId === 'string' ? req.body.leagueId.trim() : '';
    if (!leagueId) {
      res.status(400).json({ error: 'leagueId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const membershipRows = await supabaseFetch<any[]>(
        `/rest/v1/league_members?select=id&league_id=eq.${leagueId}&player_user_id=eq.${encodeURIComponent(authenticatedUserId)}&limit=1`,
      );
      if (!membershipRows?.[0]?.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const schedule = await generateLeagueFixtures(leagueId);
      res.json({
        ok: true,
        schedule,
        note:
          'Seven-member round robin requires 7 matchdays with one bye per day. This supersedes the earlier 6-day assumption.',
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate league fixtures.',
      });
    }
  });

  app.post('/league/report-result', async (req, res) => {
    const fixtureId = typeof req.body?.fixtureId === 'string' ? req.body.fixtureId.trim() : '';
    const homeScore = req.body?.homeScore;
    const awayScore = req.body?.awayScore;
    const submittedMode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
    const playerMemberId =
      typeof req.body?.playerMemberId === 'string' ? req.body.playerMemberId.trim() : '';
    const opponentMemberId =
      typeof req.body?.opponentMemberId === 'string' ? req.body.opponentMemberId.trim() : '';
    const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim() : '';

    if (!fixtureId) {
      res.status(400).json({ error: 'fixtureId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const parsedHomeScore = Number(homeScore);
      const parsedAwayScore = Number(awayScore);
      if (
        !Number.isInteger(parsedHomeScore) ||
        !Number.isInteger(parsedAwayScore) ||
        parsedHomeScore < 0 ||
        parsedAwayScore < 0 ||
        parsedHomeScore > 200 ||
        parsedAwayScore > 200
      ) {
        res.status(400).json({ error: 'Scores must be integers between 0 and 200.' });
        return;
      }

      const fixtureRows = await supabaseFetch<any[]>(
        `/rest/v1/fixtures?select=id,league_id,season,home_member_id,away_member_id,status&id=eq.${fixtureId}&limit=1`,
      );
      const fixture = fixtureRows?.[0];
      if (!fixture) {
        res.status(404).json({ error: 'Fixture not found.' });
        return;
      }
      if (fixture.status === 'completed' || fixture.status === 'forfeit') {
        res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
        return;
      }
      const leagueRows = await supabaseFetch<any[]>(
        `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
      );
      const league = leagueRows?.[0];
      if (!league || league.status !== 'active') {
        res.status(409).json({ error: 'This fixture is no longer playable.' });
        return;
      }

      const membershipRows = await supabaseFetch<any[]>(
        `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
      );
      const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
      const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
      if (!homeMember || !awayMember) {
        res.status(500).json({ error: 'Fixture membership is invalid.' });
        return;
      }

      const reporterMember =
        homeMember.player_user_id === authenticatedUserId
          ? homeMember
          : awayMember.player_user_id === authenticatedUserId
            ? awayMember
            : null;
      if (!reporterMember) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const otherMember = reporterMember.id === homeMember.id ? awayMember : homeMember;
      const resolvedMode =
        submittedMode === 'ghost' || submittedMode === 'bot' || submittedMode === 'live'
          ? submittedMode
          : otherMember.member_type === 'bot'
            ? 'bot'
            : 'ghost';

      if (playerMemberId && playerMemberId !== reporterMember.id) {
        res.status(400).json({ error: 'playerMemberId does not match the reporting fixture member.' });
        return;
      }
      if (opponentMemberId && opponentMemberId !== otherMember.id) {
        res.status(400).json({ error: 'opponentMemberId does not match the fixture opponent.' });
        return;
      }

      if (resolvedMode === 'live' && (homeMember.member_type !== 'player' || awayMember.member_type !== 'player')) {
        res.status(400).json({ error: 'Live mode is only valid for player-vs-player fixtures.' });
        return;
      }
      if (
        (resolvedMode === 'ghost' || resolvedMode === 'bot') &&
        fixture.status !== 'scheduled' &&
        fixture.status !== 'provisional'
      ) {
        res.status(409).json({ error: `Fixture ${fixtureId} is not currently playable async.` });
        return;
      }
      if (resolvedMode === 'ghost' && otherMember.member_type !== 'player') {
        res.status(400).json({ error: 'Ghost mode is only valid for player-vs-player fixtures.' });
        return;
      }

      const result =
        resolvedMode === 'live'
          ? await recordLeagueLiveResult({
              fixtureId,
              playerMemberId: reporterMember.id,
              opponentMemberId: otherMember.id,
              homeScore: parsedHomeScore,
              awayScore: parsedAwayScore,
              sourceUserId: authenticatedUserId,
              roomCode: roomCode || null,
              metadata: { via: 'league-report-route' },
            })
          : await recordLeagueAsyncResult({
              fixtureId,
              mode: resolvedMode,
              playerMemberId: reporterMember.id,
              opponentMemberId: otherMember.id,
              homeScore: parsedHomeScore,
              awayScore: parsedAwayScore,
              sourceUserId: authenticatedUserId,
              metadata: { via: 'league-report-route' },
            });
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to record league result.',
      });
    }
  });

  app.post('/league/run-forfeits', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const throughDate =
      typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
        ? req.body.throughDate.trim()
        : undefined;

    try {
      const result = await runLeagueForfeitJob(throughDate);
      res.json({
        ok: true,
        result,
        note:
          'Current Step 5 behavior only auto-forfeits fixtures where exactly one side is a bot. Real-vs-real and bot-vs-bot scheduled fixtures are reported as skipped for now.',
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to run league forfeit job.',
      });
    }
  });

  app.post('/league/run-rollover', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const throughDate =
      typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
        ? req.body.throughDate.trim()
        : undefined;

    try {
      const result = await runLeagueSundayRollover(throughDate);
      res.json({
        ok: true,
        result,
        note:
          'Rollover is idempotent at the weekly level: once next-week active leagues exist, reruns will not create duplicate successor leagues.',
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to run league Sunday rollover.',
      });
    }
  });

  app.get('/league/state/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const state = await getLeagueStateForPlayer(userId);
      if (state?.todaysOpponent?.memberType === 'player') {
        const opponentMember =
          state.members.find((member) => member.id === state.todaysOpponent?.memberId) ?? null;
        const opponentUserId = opponentMember?.player_user_id ?? null;
        state.todaysOpponent.online = Boolean(opponentUserId && socketsByUserId.get(opponentUserId)?.size);
      }
      res.json({ ok: true, state });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load league state.',
      });
    }
  });

  app.get('/league/history/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const history = await getLeagueHistoryForPlayer(userId);
      res.json({ ok: true, history });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load league history.',
      });
    }
  });

  app.post('/league/fixture/:fixtureId/live-room', async (req, res) => {
    const fixtureId = typeof req.params.fixtureId === 'string' ? req.params.fixtureId.trim() : '';
    if (!fixtureId) {
      res.status(400).json({ error: 'fixtureId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const fixtureRows = await supabaseFetch<any[]>(
        `/rest/v1/fixtures?select=id,league_id,status,home_member_id,away_member_id,live_room_code&id=eq.${fixtureId}&limit=1`,
      );
      const fixture = fixtureRows?.[0];
      if (!fixture) {
        res.status(404).json({ error: 'Fixture not found.' });
        return;
      }
      if (fixture.status === 'completed' || fixture.status === 'forfeit') {
        res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
        return;
      }
      const leagueRows = await supabaseFetch<any[]>(
        `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
      );
      const league = leagueRows?.[0];
      if (!league || league.status !== 'active') {
        res.status(409).json({ error: 'This fixture is no longer available for live play.' });
        return;
      }

      const membershipRows = await supabaseFetch<any[]>(
        `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
      );
      const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
      const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
      if (!homeMember || !awayMember) {
        res.status(500).json({ error: 'Fixture membership is invalid.' });
        return;
      }
      if (homeMember.member_type !== 'player' || awayMember.member_type !== 'player') {
        res.status(400).json({ error: 'Live play is only available for player-vs-player fixtures.' });
        return;
      }
      if (homeMember.player_user_id !== authenticatedUserId && awayMember.player_user_id !== authenticatedUserId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const existingCode =
        typeof fixture.live_room_code === 'string' && fixture.live_room_code.trim()
          ? fixture.live_room_code.trim().toUpperCase()
          : '';
      let roomCode = existingCode;
      if (roomCode) {
        try {
          getRoom(roomCode);
        } catch {
          createReservedRoom(roomCode, { winningScore: 30 });
        }
      } else {
        do {
          roomCode = `LG-${makeCode(4)}`;
          try {
            getRoom(roomCode);
            roomCode = '';
          } catch {
            // Unused room code, safe to reserve for this fixture.
          }
        } while (!roomCode);
        roomCode = createReservedRoom(roomCode, { winningScore: 30 }).code;
        await openLeagueFixtureLiveRoom(fixtureId, roomCode);
      }

      res.json({ ok: true, fixtureId, roomCode });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to open live room.',
      });
    }
  });
}
```

### `server/src/http/routes/botMatches.ts`

```typescript
import type { Application, Request } from 'express';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';

export type BotMatchesRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAuthenticatedUserIdFromToken: (token: string | null) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  startVerifiedSinglePlayerMatch: (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
  }) => Promise<VerifiedSinglePlayerMatch>;
  abandonVerifiedSinglePlayerMatch: (userId: string, localMatchId: string) => Promise<void>;
  getFritzIdentityForTier: (rawTier: unknown) => { fritzId: string; gameType: string };
  finalizeFritzForfeit: (params: {
    userId: string;
    fritzTier: unknown;
    source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
    youScore?: number | null;
    botScore?: number | null;
  }) => Promise<void>;
  parseOptionalActivityScore: (value: unknown) => number | null;
};

export function registerBotMatchesRoutes(app: Application, deps: BotMatchesRouteDeps): void {
  const {
    getAuthenticatedUserId,
    getAuthenticatedUserIdFromToken,
    supabaseFetch,
    isAdminSecret,
    startVerifiedSinglePlayerMatch,
    abandonVerifiedSinglePlayerMatch,
    getFritzIdentityForTier,
    finalizeFritzForfeit,
    parseOptionalActivityScore,
  } = deps;

  app.post('/bot-matches/cleanup-stale', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const staleRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,user_id,room_code,fritz_tier,started_at,resolved&resolved=eq.false&started_at=lt.${encodeURIComponent(threshold)}&order=started_at.asc`,
      );

      let processed = 0;
      for (const row of staleRows ?? []) {
        if (!row?.id || !row?.user_id) continue;
        await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        });
        await finalizeFritzForfeit({
          userId: row.user_id,
          fritzTier: row.fritz_tier,
          source: { roomCode: typeof row.room_code === 'string' ? row.room_code : null },
        });
        processed += 1;
      }

      res.json({ ok: true, processed });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clean stale bot matches.',
      });
    }
  });

  app.post('/api/bot-matches/local/start', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const fritzTier = typeof req.body?.fritzTier === 'string' ? req.body.fritzTier.trim().toLowerCase() : 'elite';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';

    console.log('[Local Fritz Start] Received request:', { userId, fritzTier, localMatchId });

    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      console.log('[Local Fritz Start] Authenticated user:', authenticatedUserId);

      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;

      const fritzIdentity = getFritzIdentityForTier(fritzTier);
      console.log('[Local Fritz Start] Fritz identity:', fritzIdentity);

      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: fritzIdentity.fritzId,
        fritzTier,
      });
      console.log('[Local Fritz Start] Verified match created:', verifiedMatch);

      const existing = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
      );
      console.log('[Local Fritz Start] Existing pending match:', existing?.[0]);

      if (!existing?.[0]?.id) {
        const pendingResponse = await supabaseFetch('/rest/v1/bot_match_pending', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            fritz_tier: fritzTier,
            room_code: roomCode,
            resolved: false,
          }),
        });
        console.log('[Local Fritz Start] Pending match inserted:', pendingResponse);
      }
      res.json({ ok: true, roomCode, matchId: verifiedMatch.matchId });
    } catch (error) {
      console.error('[Local Fritz Start] FAILED:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/resolve', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const roomCode = `local:${localMatchId}`;
      await supabaseFetch(
        `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        },
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/abandon', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId =
        (await getAuthenticatedUserId(req)) || (await getAuthenticatedUserIdFromToken(bodyToken || null));
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await abandonVerifiedSinglePlayerMatch(userId, localMatchId);
      const roomCode = `local:${localMatchId}`;
      const pendingRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
      );
      const pending = pendingRows?.[0];
      if (!pending?.id) {
        res.json({ ok: true, processed: false });
        return;
      }
      await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await finalizeFritzForfeit({
        userId,
        fritzTier: pending.fritz_tier,
        source: { localMatchId, roomCode },
        youScore: parseOptionalActivityScore(req.body?.youScore ?? req.body?.score),
        botScore: parseOptionalActivityScore(req.body?.botScore ?? req.body?.opponentScore),
      });
      res.json({ ok: true, processed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to abandon bot match.',
      });
    }
  });
}
```