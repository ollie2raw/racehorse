import {
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  nextDailyFritzHand,
  type DailyFritzNextHandResponse,
} from '../../daily/dailyFritzContracts.ts';
import {
  dailyFritzDebugLog,
  shouldLogDailyFritzDebug,
} from '../../daily/dailyFritzMatchDiagnostics.ts';
import { resolveDailyFritzNextHandCache } from './handLifecycleRules.ts';
import type { DailyFritzNextHandCacheEntry, DailyFritzPrefetchParams } from './types.ts';

/**
 * Owns the Daily Fritz next-hand prefetch cache: kick off on hand-end,
 * resolve on advance, and expose in-flight/ready state for debug.
 */
export class HandPrefetchCoordinator {
  private cache: DailyFritzNextHandCacheEntry | null = null;

  get entry(): DailyFritzNextHandCacheEntry | null {
    return this.cache;
  }

  set entry(value: DailyFritzNextHandCacheEntry | null) {
    this.cache = value;
  }

  clear(): void {
    this.cache = null;
  }

  hasReadyResult(): boolean {
    return this.cache?.result != null;
  }

  hasInFlightRequest(): boolean {
    return this.cache?.promise != null;
  }

  startPrefetch(params: DailyFritzPrefetchParams): void {
    const { dailyFritzPackage, dailyFritzHandIndex, gameNumber, transcript } = params;
    dailyFritzDebugLog('[daily-fritz-hand] requesting next hand', {
      source: 'prefetch',
      gameNumber,
      completedHandIndex: dailyFritzHandIndex,
      transcriptActions: transcript?.actions.length ?? 0,
    });
    const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cache: DailyFritzNextHandCacheEntry = {
      promise: nextDailyFritzHand({
        attemptId: dailyFritzPackage.attempt_id,
        verifiedMatchId: dailyFritzPackage.verified_match_id,
        runDate: dailyFritzPackage.run_date,
        gameNumber,
        completedHandIndex: dailyFritzHandIndex,
        transcript,
        completedHandScores: params.completedHandScores,
        timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
      }),
      result: null,
      error: null,
      startedAt: requestStartedAt,
    };
    cache.promise
      .then((response) => {
        const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        dailyFritzDebugLog('[daily-fritz-hand] next hand response', {
          source: 'prefetch',
          gameNumber: response.game_number ?? gameNumber,
          currentHandIndex: response.current_hand_index,
          replayed: Boolean(response.replayed),
          ignored: Boolean(response.ignored),
          durationMs: Number((requestEndedAt - requestStartedAt).toFixed(1)),
        });
        cache.result = response;
      })
      .catch((error) => {
        const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (shouldLogDailyFritzDebug()) {
          console.warn('[daily-fritz-hand] next hand error', {
            source: 'prefetch',
            gameNumber,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Number((requestEndedAt - requestStartedAt).toFixed(1)),
          });
        }
        cache.error = error;
      });
    this.cache = cache;
  }

  ensureRequest(
    params: DailyFritzPrefetchParams,
    source: string,
  ): DailyFritzNextHandCacheEntry {
    if (this.cache?.promise) {
      return this.cache;
    }
    const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { dailyFritzPackage, dailyFritzHandIndex, gameNumber, transcript } = params;
    this.cache = {
      promise: nextDailyFritzHand({
        attemptId: dailyFritzPackage.attempt_id,
        verifiedMatchId: dailyFritzPackage.verified_match_id,
        runDate: dailyFritzPackage.run_date,
        gameNumber,
        completedHandIndex: dailyFritzHandIndex,
        transcript,
        completedHandScores: params.completedHandScores,
        timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
      }),
      result: null,
      error: null,
      startedAt: requestStartedAt,
    };
    dailyFritzDebugLog('[daily-fritz-hand] requesting next hand', {
      source,
      gameNumber,
      completedHandIndex: dailyFritzHandIndex,
      transcriptActions: transcript?.actions.length ?? 0,
    });
    return this.cache;
  }

  async resolve(
    createRequest: () => Promise<DailyFritzNextHandResponse>,
  ): Promise<DailyFritzNextHandResponse> {
    return resolveDailyFritzNextHandCache(this.cache, createRequest);
  }
}
