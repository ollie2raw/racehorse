# Phase: Server `index.ts` Phase 2 Sub-phase 1 — Daily Warmup Scheduler Extraction

## Goal

Extract **only** the daily warmup scheduling system from `server/src/index.ts` into a dedicated module. Zero behavior change: same Pacific-date timing, log messages, env-flag gating, and `reason` strings (`'startup' | 'scheduled'`).

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/scheduled/dailyWarmup.ts` (130 LOC) |
| New tests | `server/src/scheduled/dailyWarmup.test.ts` (114 LOC, 9 tests) |
| `index.ts` LOC | 1,631 → **1,504** (−127) |
| Behavior change | **None** |
| `server.listen` call order | **Unchanged** relative ordering |

---

## Module path and naming justification

**Path:** `server/src/scheduled/dailyWarmup.ts`

**Reasoning (mirrors client `postGameExit.ts` pattern):**

- **Verb+noun, single concern:** `dailyWarmup` names the product operation (pre-warming Daily Fritz runs and Daily Puzzle ladders), not generic infrastructure.
- **Domain folder:** `scheduled/` groups non-HTTP periodic/startup jobs, separate from `scheduledTournament/` (bracket/tournament engine) and `ranking/cron.ts` (rating periods).
- **Direct imports:** Dependencies (`dailyFritzStore`, `seedDailyPuzzleLadder`, `shared/pacificDate`) are imported directly — no ref bridge through `index.ts`, matching Phase 1 route-extraction composition.
- **No circular import risk:** Module depends on stores + Pacific date helpers; those do not import `index.ts`.

---

## `isTruthyEnvFlag` fate — moved (not shared import)

**Grep proof** (`server/src/index.ts` before extraction):

```text
rg 'isTruthyEnvFlag' server/src/index.ts
  655:function isTruthyEnvFlag(...)
  663:  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
  668:  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_PUZZLE_WARMUP);
```

Only the two startup warmup helpers referenced `isTruthyEnvFlag`. No other `index.ts` consumer existed, so **`isTruthyEnvFlag` moved with the warmup module** rather than staying in `index.ts`.

---

## `STARTUP_DAILY_WARMUP_DELAY_MS` placement decision

**Decision:** Move the startup `setTimeout` block into the module as **`scheduleStartupDailyWarmups()`**.

**Justification:**

1. The block is **warmup-domain logic** — env-flag gating, skip hints, log messages, and calls to `warmDailyFritzRuns` / `warmDailyPuzzleLadders`.
2. `STARTUP_DAILY_WARMUP_DELAY_MS` is **only** used by this block; colocating constant + callback avoids a magic number in `index.ts`.
3. `index.ts` retains **thin bootstrap wiring** — one call alongside the Pacific schedulers, preserving `server.listen` readability.
4. Contrast with **ping interval** setup (stays in `index.ts`): generic deployment infra, not daily-content warming.

**`index.ts` after (bootstrap only):**

```typescript
  startRankingCron();
  scheduleDailyFritzWarmup();
  scheduleDailyPuzzleLadderWarmup();
  scheduleStartupDailyWarmups();
```

Relative order vs. before: `startRankingCron` → Fritz schedule → Puzzle schedule → startup warmups (was inline `setTimeout`). Ping interval and ranking cron positions unchanged.

---

## `server.listen` call order confirmation

**Before and after — tail of callback (order preserved):**

| Step | Before | After |
|------|--------|-------|
| 1 | `bootstrapScheduledTournamentInfrastructure` | same |
| 2 | `probeRoomMatchLogsTable` probe | same |
| 3 | ping `setInterval` (if `SERVER_URL`) | same |
| 4 | `startRankingCron()` | same |
| 5 | `scheduleDailyFritzWarmup()` | same |
| 6 | `scheduleDailyPuzzleLadderWarmup()` | same |
| 7 | startup warmup `setTimeout` (12s) | `scheduleStartupDailyWarmups()` |

No reordering of ranking cron, ping setup, or Pacific schedulers.

---

## Moved functions — before (from `server/src/index.ts`)

```typescript
function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Off by default in production; set ENABLE_STARTUP_FRITZ_WARMUP=true to run on boot. */
function isStartupDailyFritzWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
}

/** Off by default in production; set ENABLE_STARTUP_PUZZLE_WARMUP=true to run on boot. */
function isStartupDailyPuzzleWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_PUZZLE_WARMUP);
}

async function warmDailyFritzRuns(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-fritz-warmup] start', {
    reason,
    runDates,
  });
  try {
    const results = await Promise.all(
      runDates.map(async (runDate) => {
        const beforeCached = dailyFritzRunCache.has(runDate);
        const warmedStartedAt = Date.now();
        const run = await ensureDailyFritzRunForDate(runDate);
        return {
          runDate,
          ms: Date.now() - warmedStartedAt,
          beforeCached,
          afterCached: dailyFritzRunCache.has(runDate),
          status: run?.status ?? null,
        };
      }),
    );
    console.log('[daily-fritz-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-fritz-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleDailyFritzWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyFritzRuns('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyFritzWarmup();
  }, delayMs);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function warmDailyPuzzleLadders(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-puzzle-ladder-warmup] start', { reason, runDates });
  try {
    const results: Array<{ runDate: string; ms: number; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      await yieldEventLoop();
      const slotStartedAt = Date.now();
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false, purpose: reason });
      results.push({ runDate, ms: Date.now() - slotStartedAt, outcome });
    }
    console.log('[daily-puzzle-ladder-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-puzzle-ladder-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleDailyPuzzleLadderWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyPuzzleLadders('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyPuzzleLadderWarmup();
  }, delayMs);
}
```

**Before — startup block inside `server.listen`:**

```typescript
  startRankingCron();
  scheduleDailyFritzWarmup();
  scheduleDailyPuzzleLadderWarmup();
  // Optional startup warmups (off unless ENABLE_STARTUP_*_WARMUP=true). Puzzle ladder seeding
  // runs heavy Tactical Setup generation on the single Node event loop and can starve HTTP.
  const STARTUP_DAILY_WARMUP_DELAY_MS = 12_000;
  const startupWarmupDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
  setTimeout(() => {
    if (isStartupDailyFritzWarmupEnabled()) {
      void warmDailyFritzRuns('startup', startupWarmupDates).catch((err) => {
        console.warn('[daily-fritz-warmup] startup failed', err instanceof Error ? err.message : err);
      });
    } else {
      console.log('[daily-fritz-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_FRITZ_WARMUP=true to enable',
      });
    }
    if (isStartupDailyPuzzleWarmupEnabled()) {
      void warmDailyPuzzleLadders('startup', startupWarmupDates).catch((err) => {
        console.warn(
          '[daily-puzzle-ladder-warmup] startup failed',
          err instanceof Error ? err.message : err,
        );
      });
    } else {
      console.log('[daily-puzzle-ladder-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_PUZZLE_WARMUP=true to enable',
      });
    }
  }, STARTUP_DAILY_WARMUP_DELAY_MS);
```

---

## New module — full source (`server/src/scheduled/dailyWarmup.ts`)

```typescript
import { dailyFritzRunCache, ensureDailyFritzRunForDate } from '../http/stores/dailyFritzStore';
import { ensureDailyPuzzleLadderForDate } from '../seedDailyPuzzleLadder';
import { getNextPacificWarmupAt, getPacificDateKeyDaysFromNow } from '../shared/pacificDate';

export function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Off by default in production; set ENABLE_STARTUP_FRITZ_WARMUP=true to run on boot. */
export function isStartupDailyFritzWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
}

/** Off by default in production; set ENABLE_STARTUP_PUZZLE_WARMUP=true to run on boot. */
export function isStartupDailyPuzzleWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_PUZZLE_WARMUP);
}

async function warmDailyFritzRuns(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-fritz-warmup] start', {
    reason,
    runDates,
  });
  try {
    const results = await Promise.all(
      runDates.map(async (runDate) => {
        const beforeCached = dailyFritzRunCache.has(runDate);
        const warmedStartedAt = Date.now();
        const run = await ensureDailyFritzRunForDate(runDate);
        return {
          runDate,
          ms: Date.now() - warmedStartedAt,
          beforeCached,
          afterCached: dailyFritzRunCache.has(runDate),
          status: run?.status ?? null,
        };
      }),
    );
    console.log('[daily-fritz-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-fritz-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleDailyFritzWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyFritzRuns('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyFritzWarmup();
  }, delayMs);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function warmDailyPuzzleLadders(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-puzzle-ladder-warmup] start', { reason, runDates });
  try {
    const results: Array<{ runDate: string; ms: number; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      await yieldEventLoop();
      const slotStartedAt = Date.now();
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false, purpose: reason });
      results.push({ runDate, ms: Date.now() - slotStartedAt, outcome });
    }
    console.log('[daily-puzzle-ladder-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-puzzle-ladder-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleDailyPuzzleLadderWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyPuzzleLadders('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyPuzzleLadderWarmup();
  }, delayMs);
}

const STARTUP_DAILY_WARMUP_DELAY_MS = 12_000;

/** Optional startup warmups (off unless ENABLE_STARTUP_*_WARMUP=true). */
export function scheduleStartupDailyWarmups(): void {
  const startupWarmupDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
  setTimeout(() => {
    if (isStartupDailyFritzWarmupEnabled()) {
      void warmDailyFritzRuns('startup', startupWarmupDates).catch((err) => {
        console.warn('[daily-fritz-warmup] startup failed', err instanceof Error ? err.message : err);
      });
    } else {
      console.log('[daily-fritz-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_FRITZ_WARMUP=true to enable',
      });
    }
    if (isStartupDailyPuzzleWarmupEnabled()) {
      void warmDailyPuzzleLadders('startup', startupWarmupDates).catch((err) => {
        console.warn(
          '[daily-puzzle-ladder-warmup] startup failed',
          err instanceof Error ? err.message : err,
        );
      });
    } else {
      console.log('[daily-puzzle-ladder-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_PUZZLE_WARMUP=true to enable',
      });
    }
  }, STARTUP_DAILY_WARMUP_DELAY_MS);
}
```

**`index.ts` import added:**

```typescript
import {
  scheduleDailyFritzWarmup,
  scheduleDailyPuzzleLadderWarmup,
  scheduleStartupDailyWarmups,
} from './scheduled/dailyWarmup';
```

**Unused imports removed from `index.ts`:** `ensureDailyPuzzleLadderForDate`, `dailyFritzRunCache`, `ensureDailyFritzRunForDate`, `getPacificDateKeyDaysFromNow`, `getNextPacificWarmupAt` (warmup-only).

---

## Test file — full source (`server/src/scheduled/dailyWarmup.test.ts`)

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pacificDate from '../shared/pacificDate';
import {
  isStartupDailyFritzWarmupEnabled,
  isStartupDailyPuzzleWarmupEnabled,
  isTruthyEnvFlag,
  scheduleDailyFritzWarmup,
  scheduleDailyPuzzleLadderWarmup,
  scheduleStartupDailyWarmups,
} from './dailyWarmup';

describe('isTruthyEnvFlag', () => {
  it('returns false for empty or missing values', () => {
    expect(isTruthyEnvFlag(undefined)).toBe(false);
    expect(isTruthyEnvFlag('')).toBe(false);
    expect(isTruthyEnvFlag('   ')).toBe(false);
  });

  it('accepts true, 1, and yes case-insensitively', () => {
    expect(isTruthyEnvFlag('true')).toBe(true);
    expect(isTruthyEnvFlag('TRUE')).toBe(true);
    expect(isTruthyEnvFlag('  Yes ')).toBe(true);
    expect(isTruthyEnvFlag('1')).toBe(true);
  });

  it('rejects other strings', () => {
    expect(isTruthyEnvFlag('false')).toBe(false);
    expect(isTruthyEnvFlag('0')).toBe(false);
    expect(isTruthyEnvFlag('on')).toBe(false);
  });
});

describe('startup warmup env gates', () => {
  const originalFritz = process.env.ENABLE_STARTUP_FRITZ_WARMUP;
  const originalPuzzle = process.env.ENABLE_STARTUP_PUZZLE_WARMUP;

  afterEach(() => {
    if (originalFritz === undefined) delete process.env.ENABLE_STARTUP_FRITZ_WARMUP;
    else process.env.ENABLE_STARTUP_FRITZ_WARMUP = originalFritz;
    if (originalPuzzle === undefined) delete process.env.ENABLE_STARTUP_PUZZLE_WARMUP;
    else process.env.ENABLE_STARTUP_PUZZLE_WARMUP = originalPuzzle;
  });

  it('isStartupDailyFritzWarmupEnabled reads ENABLE_STARTUP_FRITZ_WARMUP', () => {
    delete process.env.ENABLE_STARTUP_FRITZ_WARMUP;
    expect(isStartupDailyFritzWarmupEnabled()).toBe(false);
    process.env.ENABLE_STARTUP_FRITZ_WARMUP = 'true';
    expect(isStartupDailyFritzWarmupEnabled()).toBe(true);
  });

  it('isStartupDailyPuzzleWarmupEnabled reads ENABLE_STARTUP_PUZZLE_WARMUP', () => {
    delete process.env.ENABLE_STARTUP_PUZZLE_WARMUP;
    expect(isStartupDailyPuzzleWarmupEnabled()).toBe(false);
    process.env.ENABLE_STARTUP_PUZZLE_WARMUP = 'yes';
    expect(isStartupDailyPuzzleWarmupEnabled()).toBe(true);
  });
});

describe('Pacific warmup schedule delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scheduleDailyFritzWarmup uses at least 1000ms and respects next Pacific warmup', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(pacificDate, 'getNextPacificWarmupAt').mockReturnValue(new Date('2026-07-04T12:00:30.000Z'));

    scheduleDailyFritzWarmup();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it('scheduleDailyFritzWarmup floors delay at 1000ms when next warmup is immediate', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(pacificDate, 'getNextPacificWarmupAt').mockReturnValue(new Date('2026-07-04T11:59:59.500Z'));

    scheduleDailyFritzWarmup();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('scheduleDailyPuzzleLadderWarmup uses the same delay computation', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(pacificDate, 'getNextPacificWarmupAt').mockReturnValue(new Date('2026-07-04T12:05:00.000Z'));

    scheduleDailyPuzzleLadderWarmup();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
  });
});

describe('scheduleStartupDailyWarmups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('defers startup warmups by 12 seconds', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    scheduleStartupDailyWarmups();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12_000);
  });
});
```

### Test coverage notes

| Piece | Tested? | Notes |
|-------|---------|-------|
| `isTruthyEnvFlag` | Yes | 3 cases |
| Startup env gates | Yes | Fritz + Puzzle |
| Schedule delay `Math.max(1000, …)` | Yes | Fritz + Puzzle via `vi.spyOn(setTimeout)` + mocked `getNextPacificWarmupAt` |
| `scheduleStartupDailyWarmups` 12s defer | Yes | `setTimeout` delay assertion |
| `warmDailyFritzRuns` / `warmDailyPuzzleLadders` bodies | **No** | Require store/DB mocks; integration-level |
| Recursive scheduler callback firing | **No** | Would need timer advance + heavy mocks; delay math covered separately |
| `server.listen` wiring | **No** | Bootstrap integration; order verified by inspection |

---

## Test / build results

### Before (pre-change baseline)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **60** files, **434** tests passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

### After (this change)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **61** files (+1), **443** tests (+9) passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

---

## Frozen / out-of-scope confirmation

| System | Touched? |
|--------|----------|
| Legacy tournament block (`ENABLE_LEGACY_TOURNAMENTS` and contents) | **No** |
| `createGameOverPersistScheduler` | **No** |
| Presence (`socketsByUserId`, `emitPresenceUpdateToFriends`, `presence:identify` / `presence:online`) | **No** |
| Matchmaking room-shell hydration (`tryHydrateMatchmakingRoomShell`, `waitUntilMatchmakingRoomSocketsReady`) | **No** |
| Chat/emote socket handlers | **No** |
| `io` / `Server` / CORS setup | **No** |
| Phase 1 extractions (`server/src/http/**`, `server/src/shared/**`, `server/src/http/stores/**`) | **No** (imports only from existing stores) |
| `client/**` | **No** |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `server/src/scheduled/dailyWarmup.ts` | **New** — extracted warmup scheduler |
| `server/src/scheduled/dailyWarmup.test.ts` | **New** — 9 unit tests |
| `server/src/index.ts` | Removed warmup functions; thin import + `scheduleStartupDailyWarmups()` call |
| `docs/phase-server-index-warmup-extraction-report.md` | **New** (this file) |