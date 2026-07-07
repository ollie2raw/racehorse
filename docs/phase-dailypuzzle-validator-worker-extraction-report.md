# Phase: Daily Puzzle Cleanup Sub-phase 3 — Validator Worker Lifecycle Extraction

## Sub-phase 2 report path confirmation

**Does `docs/phase-dailypuzzle-ladder-icons-helpers-report.md` exist on disk?** **YES**

---

## Goal

Extract Web Worker lifecycle management for puzzle solution validation from `DailyPuzzleScreen.tsx` into `useDailyPuzzleValidatorWorker.ts`. Zero behavior change. Touch **only** worker lifecycle code and hook wiring in the screen file.

## Summary

| Item | Result |
|------|--------|
| New hook | `client/src/dailyPuzzle/useDailyPuzzleValidatorWorker.ts` (129 LOC) |
| New tests | `client/src/dailyPuzzle/useDailyPuzzleValidatorWorker.test.ts` (98 LOC, 7 tests) |
| `DailyPuzzleScreen.tsx` LOC | **1445 → 1346** (−99) |
| Behavior change | **None** |

---

## Investigation — grep results (`client/src/`)

**Command:**

```bash
rg 'Worker|validator\.worker|ValidatorWorker|validatorWorkerRef|validatorPendingRef|validatorRequestIdRef' client/src
```

| Symbol / asset | Consumers |
|----------------|-----------|
| `new Worker(new URL('./validator.worker.ts', ...))` | **Only** `DailyPuzzleScreen.tsx` (before extraction) → **`useDailyPuzzleValidatorWorker.ts`** (after) |
| `validator.worker.ts` | Worker script; imported only via `new URL('./validator.worker.ts', import.meta.url)` from hook |
| `ValidatorWorkerRequest` / `ValidatorWorkerResponse` / `PendingWorkerJob` | Defined in `dailyPuzzleScreenTypes.ts`; used by hook + worker script (duplicate inline types in worker file) |
| `requestValidationFromWorker` / `requestBestScoreFromWorker` | **Only** `DailyPuzzleScreen.tsx` (call sites unchanged) |
| `validator.ts` `validatePuzzle` / `computeBestPossiblePuzzleScore` | Used by `validator.worker.ts` and `DailyPuzzleAdminScreen.tsx` (main-thread admin only) — **not** worker lifecycle |
| `confetti.create(..., { useWorker: true })` | Unrelated confetti canvas workers in `DailyPuzzleScreen.tsx`, `MultiplayerGameShell.tsx`, `NoBrainerLabScreen.tsx` |

**Conclusion:** Puzzle validator Web Worker construction, message posting, pending-map sequencing, and unmount termination had a **single consumer**: `DailyPuzzleScreen.tsx`.

---

## Current `DailyPuzzleScreen.tsx` LOC (pre-extraction)

**1445 LOC** (after sub-phases 1–2; not the stale 1,472 figure).

---

## Message protocol sharing

| Location | Role |
|----------|------|
| `dailyPuzzleScreenTypes.ts` | **Canonical main-thread types:** `ValidatorWorkerRequest`, `ValidatorWorkerResponse`, `PendingWorkerJob<T>` |
| `validator.worker.ts` | **Duplicate inline** `ValidatorWorkerRequest` / `ValidatorWorkerResponse` types (worker-isolated; unchanged this sub-phase) |
| Worker script validation logic | Calls `validatePuzzle` / `computeBestPossiblePuzzleScore` from `validator.ts` — **not modified** |

---

## Stale-response / sequencing guards (high-scrutiny — preserved exactly)

1. **Monotonic `requestId`:** `++validatorRequestIdRef.current` per outbound message.
2. **Pending map keyed by `requestId`:** `validatorPendingRef.current.set(requestId, { expected, puzzleDate, resolve, reject })`.
3. **Inbound handler:** lookup by `data.requestId`; if missing → **ignore** (orphan response).
4. **Delete pending entry** immediately after lookup succeeds (before resolve/reject).
5. **`puzzleDate` match:** `data.puzzleDate !== pending.puzzleDate` → reject `'Stale validator response.'`
6. **Expected type match:** `data.type !== pending.expected` → reject `'Unexpected validator response type.'`
7. **Worker `onerror`:** reject all pending jobs, clear map.
8. **Unmount cleanup:** reject all pending with `'Validator worker terminated.'`, clear map, `terminate()` worker, null ref.

Extracted to testable pure function `dispatchValidatorWorkerMessage` — logic identical to inline `onmessage` body.

**Worker instantiation not unit-tested:** requires real `Worker` + Vite `import.meta.url` bundling; impractical in Vitest/jsdom without heavy mocking. Pure dispatch/request-builder functions provide coverage of the protocol contract.

---

## Files touched

| File | Change |
|------|--------|
| `DailyPuzzleScreen.tsx` | Removed worker refs/callbacks/cleanup effect; added hook import + destructuring call; trimmed type imports |
| `useDailyPuzzleValidatorWorker.ts` | **New** |
| `useDailyPuzzleValidatorWorker.test.ts` | **New** |
| `validator.worker.ts` | **Untouched** |
| `dailyPuzzleScreenTypes.ts` | **Untouched** (types reused) |
| All other files | **Untouched** |

---

## Full before source — worker blocks in `DailyPuzzleScreen.tsx`

### Refs (before)

```typescript
  const validatorWorkerRef = useRef<Worker | null>(null);
  const validatorRequestIdRef = useRef(0);
  const validatorPendingRef = useRef<Map<number, PendingWorkerJob<unknown>>>(new Map());
```

### Type imports (before)

```typescript
import type {
  DailyPuzzleScreenProps,
  PendingWorkerJob,
  PlayStatus,
  ValidatorWorkerRequest,
  ValidatorWorkerResponse,
} from './dailyPuzzleScreenTypes';
```

### `getValidatorWorker` (before)

```typescript
  const getValidatorWorker = useCallback((): Worker => {
    if (!validatorWorkerRef.current) {
      const worker = new Worker(new URL('./validator.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ValidatorWorkerResponse>) => {
        const data = event.data;
        const pending = validatorPendingRef.current.get(data.requestId);
        if (!pending) return;
        validatorPendingRef.current.delete(data.requestId);
        if (data.type === 'error') {
          pending.reject(new Error(data.error));
          return;
        }
        if (data.puzzleDate !== pending.puzzleDate) {
          pending.reject(new Error('Stale validator response.'));
          return;
        }
        if (data.type !== pending.expected) {
          pending.reject(new Error('Unexpected validator response type.'));
          return;
        }
        if (data.type === 'validateResult') {
          pending.resolve(data.result);
          return;
        }
        pending.resolve(data.score);
      };
      worker.onerror = (err) => {
        for (const [, pending] of validatorPendingRef.current) {
          pending.reject(err.error ?? new Error('Validator worker failed.'));
        }
        validatorPendingRef.current.clear();
      };
      validatorWorkerRef.current = worker;
    }
    return validatorWorkerRef.current;
  }, []);
```

### `requestValidationFromWorker` (before)

```typescript
  const requestValidationFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<PuzzleValidationResult>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'validateResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as PuzzleValidationResult),
          reject,
        });
        const payload: ValidatorWorkerRequest = {
          requestId,
          type: 'validate',
          puzzleDate: activePuzzle.puzzleDate,
          puzzle: activePuzzle,
        };
        worker.postMessage(payload);
      }),
    [getValidatorWorker],
  );
```

### `requestBestScoreFromWorker` (before)

```typescript
  const requestBestScoreFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<number>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'bestScoreResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as number),
          reject,
        });
        const payload: ValidatorWorkerRequest = {
          requestId,
          type: 'bestScore',
          puzzleDate: activePuzzle.puzzleDate,
          puzzle: activePuzzle,
        };
        worker.postMessage(payload);
      }),
    [getValidatorWorker],
  );
```

### Unmount cleanup `useEffect` (before)

```typescript
  useEffect(() => {
    return () => {
      for (const [, pending] of validatorPendingRef.current) {
        pending.reject(new Error('Validator worker terminated.'));
      }
      validatorPendingRef.current.clear();
      validatorWorkerRef.current?.terminate();
      validatorWorkerRef.current = null;
    };
  }, []);
```

### Call sites (unchanged — still in `DailyPuzzleScreen.tsx`)

- Puzzle load effect: `requestValidationFromWorker(puzzle)`, `requestBestScoreFromWorker(puzzle)`
- Play flow: `requestBestScoreFromWorker(puzzle)` when needed

---

## Full after source — `DailyPuzzleScreen.tsx` worker wiring

### Import

```typescript
import type { DailyPuzzleScreenProps, PlayStatus } from './dailyPuzzleScreenTypes';
import { useDailyPuzzleValidatorWorker } from './useDailyPuzzleValidatorWorker';
```

### Hook call (replaces refs + callbacks + cleanup effect)

```typescript
  const { requestValidationFromWorker, requestBestScoreFromWorker } = useDailyPuzzleValidatorWorker();
```

No inline `Worker`, `onmessage`, `postMessage`, or validator refs remain in the screen file.

---

## Full source — `useDailyPuzzleValidatorWorker.ts`

```typescript
import { useCallback, useEffect, useRef } from 'react';
import type { CuratedDailyPuzzle, PuzzleValidationResult } from './types';
import type {
  PendingWorkerJob,
  ValidatorWorkerRequest,
  ValidatorWorkerResponse,
} from './dailyPuzzleScreenTypes';

export type ValidatorWorkerDispatch =
  | { action: 'ignore' }
  | { action: 'reject'; error: Error }
  | { action: 'resolve'; value: unknown };

export function dispatchValidatorWorkerMessage(
  data: ValidatorWorkerResponse,
  pending: PendingWorkerJob<unknown> | undefined,
): ValidatorWorkerDispatch {
  if (!pending) return { action: 'ignore' };
  if (data.type === 'error') {
    return { action: 'reject', error: new Error(data.error) };
  }
  if (data.puzzleDate !== pending.puzzleDate) {
    return { action: 'reject', error: new Error('Stale validator response.') };
  }
  if (data.type !== pending.expected) {
    return { action: 'reject', error: new Error('Unexpected validator response type.') };
  }
  if (data.type === 'validateResult') {
    return { action: 'resolve', value: data.result };
  }
  return { action: 'resolve', value: data.score };
}

export function buildValidatorWorkerRequest(
  requestId: number,
  type: 'validate' | 'bestScore',
  activePuzzle: CuratedDailyPuzzle,
): ValidatorWorkerRequest {
  return {
    requestId,
    type,
    puzzleDate: activePuzzle.puzzleDate,
    puzzle: activePuzzle,
  };
}

export function useDailyPuzzleValidatorWorker(): {
  requestValidationFromWorker: (activePuzzle: CuratedDailyPuzzle) => Promise<PuzzleValidationResult>;
  requestBestScoreFromWorker: (activePuzzle: CuratedDailyPuzzle) => Promise<number>;
} {
  const validatorWorkerRef = useRef<Worker | null>(null);
  const validatorRequestIdRef = useRef(0);
  const validatorPendingRef = useRef<Map<number, PendingWorkerJob<unknown>>>(new Map());

  const getValidatorWorker = useCallback((): Worker => {
    if (!validatorWorkerRef.current) {
      const worker = new Worker(new URL('./validator.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ValidatorWorkerResponse>) => {
        const data = event.data;
        const pending = validatorPendingRef.current.get(data.requestId);
        if (!pending) return;
        validatorPendingRef.current.delete(data.requestId);
        const dispatch = dispatchValidatorWorkerMessage(data, pending);
        if (dispatch.action === 'reject') {
          pending.reject(dispatch.error);
          return;
        }
        if (dispatch.action === 'resolve') {
          pending.resolve(dispatch.value);
        }
      };
      worker.onerror = (err) => {
        for (const [, pending] of validatorPendingRef.current) {
          pending.reject(err.error ?? new Error('Validator worker failed.'));
        }
        validatorPendingRef.current.clear();
      };
      validatorWorkerRef.current = worker;
    }
    return validatorWorkerRef.current;
  }, []);

  const requestValidationFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<PuzzleValidationResult>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'validateResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as PuzzleValidationResult),
          reject,
        });
        worker.postMessage(buildValidatorWorkerRequest(requestId, 'validate', activePuzzle));
      }),
    [getValidatorWorker],
  );

  const requestBestScoreFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<number>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'bestScoreResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as number),
          reject,
        });
        worker.postMessage(buildValidatorWorkerRequest(requestId, 'bestScore', activePuzzle));
      }),
    [getValidatorWorker],
  );

  useEffect(() => {
    return () => {
      for (const [, pending] of validatorPendingRef.current) {
        pending.reject(new Error('Validator worker terminated.'));
      }
      validatorPendingRef.current.clear();
      validatorWorkerRef.current?.terminate();
      validatorWorkerRef.current = null;
    };
  }, []);

  return {
    requestValidationFromWorker,
    requestBestScoreFromWorker,
  };
}
```

**Naming note:** `useDailyPuzzleValidatorWorker.ts` matches existing `useResponsiveHandTileSize.ts` convention (`use` + domain + concern) under `dailyPuzzle/`.

---

## Full source — `useDailyPuzzleValidatorWorker.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import type { CuratedDailyPuzzle } from './types';
import type { PendingWorkerJob } from './dailyPuzzleScreenTypes';
import {
  buildValidatorWorkerRequest,
  dispatchValidatorWorkerMessage,
} from './useDailyPuzzleValidatorWorker';

const pendingValidate: PendingWorkerJob<unknown> = {
  expected: 'validateResult',
  puzzleDate: '2024-06-01',
  resolve: () => {},
  reject: () => {},
};

const pendingBestScore: PendingWorkerJob<unknown> = {
  expected: 'bestScoreResult',
  puzzleDate: '2024-06-01',
  resolve: () => {},
  reject: () => {},
};

describe('dispatchValidatorWorkerMessage', () => {
  it('ignores responses with no matching pending job', () => {
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-01',
      result: { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: '' },
    }, undefined)).toEqual({ action: 'ignore' });
  });

  it('rejects worker error responses', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'error',
      puzzleDate: '2024-06-01',
      error: 'boom',
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('boom') });
  });

  it('rejects stale puzzleDate mismatches', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-02',
      result: { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: '' },
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('Stale validator response.') });
  });

  it('rejects unexpected response types', () => {
    const outcome = dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'bestScoreResult',
      puzzleDate: '2024-06-01',
      score: 42,
    }, pendingValidate);
    expect(outcome).toEqual({ action: 'reject', error: new Error('Unexpected validator response type.') });
  });

  it('resolves validate results', () => {
    const result = { solvable: true, bestScore: 10, hasScoringMove: true, exploredStates: 1, reason: 'ok' };
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'validateResult',
      puzzleDate: '2024-06-01',
      result,
    }, pendingValidate)).toEqual({ action: 'resolve', value: result });
  });

  it('resolves best-score results', () => {
    expect(dispatchValidatorWorkerMessage({
      requestId: 1,
      type: 'bestScoreResult',
      puzzleDate: '2024-06-01',
      score: 55,
    }, pendingBestScore)).toEqual({ action: 'resolve', value: 55 });
  });
});

describe('buildValidatorWorkerRequest', () => {
  it('builds validate and bestScore request payloads', () => {
    const puzzle = { puzzleDate: '2024-06-01' } as CuratedDailyPuzzle;
    expect(buildValidatorWorkerRequest(7, 'validate', puzzle)).toEqual({
      requestId: 7,
      type: 'validate',
      puzzleDate: '2024-06-01',
      puzzle,
    });
    expect(buildValidatorWorkerRequest(8, 'bestScore', puzzle)).toEqual({
      requestId: 8,
      type: 'bestScore',
      puzzleDate: '2024-06-01',
      puzzle,
    });
  });
});
```

---

## Build and test results

### Baseline (before extraction — sub-phase 2 after-numbers)

| Metric | Value |
|--------|-------|
| Test files | **50** |
| Tests | **443** |
| Build | **Pass** |

### After extraction

| Metric | Value |
|--------|-------|
| Test files | **51** (+1) |
| Tests | **450** (+7) |
| Build | **Pass** |

**Commands run:**

```bash
npm test --prefix client
npm run build --prefix client
```