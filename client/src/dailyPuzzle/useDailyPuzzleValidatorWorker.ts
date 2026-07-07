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