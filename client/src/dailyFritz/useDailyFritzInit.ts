import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  clearDailyFritzClientStorage,
  clearDailyFritzTodayCache,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  DAILY_FRITZ_TODAY_CACHE_PREFIX,
  getTodayDailyFritz,
  recordDailyFritzTelemetry,
  type DailyFritzTodayResponse,
} from './api';
import {
  DAILY_FRITZ_INIT_SLOW_MS,
  dfInitLog,
  friendlyDailyFritzInitError,
  readTodayCache,
  shouldClearStaleClientState,
} from './dailyFritzScreenHelpers';
import { dailyFritzTelemetryEventId, getDailyFritzTelemetrySession } from './telemetry';
import type { DailyFritzInitPhase } from './dailyFritzScreenTypes';

export type UseDailyFritzInitParams = {
  userId: string | undefined;
};

export type UseDailyFritzInitResult = {
  today: DailyFritzTodayResponse | null;
  initPhase: DailyFritzInitPhase;
  loadError: string | null;
  initRetryPending: boolean;
  hubError: string | null;
  setHubError: Dispatch<SetStateAction<string | null>>;
  refreshToday: () => Promise<void>;
  runInit: (options?: { clearStale?: boolean; isRetry?: boolean }) => Promise<void>;
  showInitScreen: boolean;
};

export function useDailyFritzInit({ userId }: UseDailyFritzInitParams): UseDailyFritzInitResult {
  const [today, setToday] = useState<DailyFritzTodayResponse | null>(null);
  const [initPhase, setInitPhase] = useState<DailyFritzInitPhase>('preparing');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initRetryPending, setInitRetryPending] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);

  const cacheKey = useMemo(
    () => (userId ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${userId}` : null),
    [userId],
  );
  const todayRef = useRef<DailyFritzTodayResponse | null>(today);
  const initRequestIdRef = useRef(0);
  const initInFlightRef = useRef(false);
  const initSlowTimerRef = useRef<number | null>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const persistTodayCache = useCallback(
    (response: DailyFritzTodayResponse) => {
      if (!cacheKey || typeof window === 'undefined') return;
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(response));
      } catch {
        /* noop */
      }
    },
    [cacheKey],
  );

  const refreshToday = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await getTodayDailyFritz();
      const cached = readTodayCache(cacheKey);
      if (cached && shouldClearStaleClientState(cached, response)) {
        clearDailyFritzClientStorage(userId);
      }
      setToday(response);
      persistTodayCache(response);
      setHubError(null);
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    }
  }, [cacheKey, persistTodayCache, userId]);

  const clearInitSlowTimer = useCallback(() => {
    if (initSlowTimerRef.current != null) {
      window.clearTimeout(initSlowTimerRef.current);
      initSlowTimerRef.current = null;
    }
  }, []);

  const runInit = useCallback(
    async (options?: { clearStale?: boolean; isRetry?: boolean }) => {
      if (!userId) return;
      if (initInFlightRef.current) return;

      initInFlightRef.current = true;
      const requestId = ++initRequestIdRef.current;
      const retryAttempt = options?.isRetry ? initRequestIdRef.current : null;

      setInitRetryPending(Boolean(options?.isRetry));
      setLoadError(null);
      setHubError(null);
      setInitPhase((phase) => {
        const next: DailyFritzInitPhase =
          options?.isRetry || phase === 'failed' || phase === 'still-preparing' ? 'retrying' : 'preparing';
        dfInitLog('state', { phase: next });
        return next;
      });

      if (options?.clearStale) {
        // Soft retry: drop the today hub cache only. Wiping match snapshots here
        // destroyed mid-hand resume after a flaky init.
        clearDailyFritzTodayCache(userId);
      } else {
        const corruptCache = readTodayCache(cacheKey);
        if (corruptCache === null && cacheKey && typeof window !== 'undefined') {
          try {
            const raw = window.sessionStorage.getItem(cacheKey);
            if (raw) clearDailyFritzTodayCache(userId);
          } catch {
            /* noop */
          }
        }
      }

      const runDateHint = todayRef.current?.run_date ?? readTodayCache(cacheKey)?.run_date ?? null;
      dfInitLog('start', { date: runDateHint, userId });
      if (retryAttempt != null) {
        dfInitLog('retry', { attempt: retryAttempt });
      }

      clearInitSlowTimer();
      initSlowTimerRef.current = window.setTimeout(() => {
        if (initRequestIdRef.current !== requestId) return;
        setInitPhase((phase) => {
          if (phase === 'preparing' || phase === 'retrying') {
            dfInitLog('timeout', { ms: DAILY_FRITZ_INIT_SLOW_MS });
            dfInitLog('state', { phase: 'still-preparing' });
            return 'still-preparing';
          }
          return phase;
        });
      }, DAILY_FRITZ_INIT_SLOW_MS);

      try {
        const response = await getTodayDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
        if (initRequestIdRef.current !== requestId) return;

        const cached = readTodayCache(cacheKey);
        if (cached && shouldClearStaleClientState(cached, response)) {
          clearDailyFritzClientStorage(userId);
        }

        setToday(response);
        persistTodayCache(response);
        setInitPhase('ready');
        const sessionId = getDailyFritzTelemetrySession(response.run_date);
        void recordDailyFritzTelemetry({
          eventId: dailyFritzTelemetryEventId(sessionId, 'mode_impression'),
          eventType: 'mode_impression',
          runDate: response.run_date,
          challengeId: response.challenge_id ?? null,
          sessionId,
          payload: { attemptStatus: response.attempt_status },
        });
        dfInitLog('state', { phase: 'ready' });
      } catch (initErr) {
        if (initRequestIdRef.current !== requestId) return;
        console.error('[daily-fritz] init failed:', initErr);
        setLoadError(friendlyDailyFritzInitError(initErr));
        setInitPhase('failed');
        dfInitLog('state', { phase: 'failed' });
      } finally {
        if (initRequestIdRef.current === requestId) {
          initInFlightRef.current = false;
          setInitRetryPending(false);
          clearInitSlowTimer();
        }
      }
    },
    [cacheKey, clearInitSlowTimer, persistTodayCache, userId],
  );

  useEffect(() => {
    return () => {
      clearInitSlowTimer();
    };
  }, [clearInitSlowTimer]);

  useEffect(() => {
    if (!userId) {
      setToday(null);
      setInitPhase('ready');
      setLoadError(null);
      setHubError('Sign in to play Daily Fritz.');
      return;
    }
    setHubError(null);
    void runInit();
  }, [runInit, userId]);

  const showInitScreen = Boolean(userId) && initPhase !== 'ready';

  return {
    today,
    initPhase,
    loadError,
    initRetryPending,
    hubError,
    setHubError,
    refreshToday,
    runInit,
    showInitScreen,
  };
}
