import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { BotHandReveal } from '../types.ts';
import {
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  DAILY_FRITZ_HAND_REVEAL_DELAY_MS,
  emitHandLifecycleDebugLog,
  logDailyFritzHandBreadcrumb,
  resolveHandRevealScheduleMode,
  shouldShowHandRevealForHand,
} from './handLifecycleRules.ts';
import { dailyFritzDebugLog } from '../../daily/dailyFritzMatchDiagnostics.ts';
import { buildHandRevealFromResult } from './handRevealPayload.ts';
import type { HandEndedRevealPlan, TraceHandLifecycle } from './types.ts';
import type { BotActionResult } from '../runtime/botEngine.ts';

export type UseHandRevealSchedulerArgs = {
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  mode: string;
  isDailyFritzMode: boolean;
  isGuidedMode: boolean;
  isGuidedV2Mode: boolean;
  lastDailyFlowLabelRef: React.MutableRefObject<string>;
  traceHandLifecycle: TraceHandLifecycle;
  onAutoAdvance: () => void;
  onRevealShown: () => void;
  onRevealHidden: () => void;
  prefetchReady: () => boolean;
  handTransitionInFlight: () => boolean;
  initialHandReveal?: BotHandReveal | null;
};

export function useHandRevealScheduler({
  match,
  matchRef,
  mode,
  isDailyFritzMode,
  isGuidedMode,
  isGuidedV2Mode,
  lastDailyFlowLabelRef,
  traceHandLifecycle,
  onAutoAdvance,
  onRevealShown,
  onRevealHidden,
  prefetchReady,
  handTransitionInFlight,
  initialHandReveal = null,
}: UseHandRevealSchedulerArgs) {
  const [handReveal, setHandReveal] = useState<BotHandReveal | null>(initialHandReveal);
  const [handRevealProgress, setHandRevealProgress] = useState(1);

  const handRevealTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingHandRevealRef = useRef<{ handNumber: number; reveal: BotHandReveal } | null>(initialHandReveal ? { handNumber: match.handNumber, reveal: initialHandReveal } : null);
  const handRevealRef = useRef<BotHandReveal | null>(null);
  handRevealRef.current = handReveal;

  const handRevealShownAtRef = useRef<number | null>(null);
  const dailyFritzMinAdvanceAtRef = useRef<number | null>(null);
  const handAutoAdvanceTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const onAutoAdvanceRef = useRef(onAutoAdvance);

  useEffect(() => {
    onAutoAdvanceRef.current = onAutoAdvance;
  }, [onAutoAdvance]);

  const scheduleHandReveal = useCallback((reveal: BotHandReveal, delayMs: number) => {
    if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
    handRevealTimerRef.current = window.setTimeout(() => {
      setHandReveal(reveal);
      handRevealTimerRef.current = null;
    }, delayMs);
  }, []);

  const clearHandReveal = useCallback(() => {
    if (handRevealTimerRef.current) {
      clearTimeout(handRevealTimerRef.current);
      handRevealTimerRef.current = null;
    }
    setHandReveal(null);
    pendingHandRevealRef.current = null;
  }, []);

  const isRevealTimerPending = useCallback(
    () => handRevealTimerRef.current !== null,
    [],
  );

  const planHandEndedReveal = useCallback((result: BotActionResult): HandEndedRevealPlan => {
    const revealPayload = buildHandRevealFromResult(result);
    return {
      revealPayload,
      pending: { handNumber: result.state.handNumber, reveal: revealPayload },
      scheduleMode: resolveHandRevealScheduleMode(isDailyFritzMode),
    };
  }, [isDailyFritzMode]);

  const showHandEndedReveal = useCallback(
    (plan: HandEndedRevealPlan, endedHandNumber: number) => {
      const revealPayload = plan.revealPayload;
      pendingHandRevealRef.current = plan.pending;

      const showReveal = () => {
        const live = matchRef.current;
        if (!shouldShowHandRevealForHand(live.handNumber, endedHandNumber)) {
          handRevealTimerRef.current = null;
          logDailyFritzHandBreadcrumb('reveal-skipped', {
            liveHandNumber: live.handNumber,
            endedHandNumber,
            mode: isDailyFritzMode ? 'daily-fritz' : mode,
          });
          return;
        }
        if (isDailyFritzMode) {
          lastDailyFlowLabelRef.current = 'reveal-start';
          dailyFritzDebugLog('[daily-flow] reveal start', {
            handNumber: endedHandNumber,
            handTransitionInFlight: handTransitionInFlight(),
            prefetchReady: prefetchReady(),
            schedule: plan.scheduleMode,
          });
        }
        setHandReveal(revealPayload);
        handRevealTimerRef.current = null;
      };

      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      if (plan.scheduleMode === 'immediate') {
        showReveal();
      } else {
        handRevealTimerRef.current = window.setTimeout(showReveal, DAILY_FRITZ_HAND_REVEAL_DELAY_MS);
      }
    },
    [handTransitionInFlight, isDailyFritzMode, lastDailyFlowLabelRef, matchRef, mode, prefetchReady],
  );

  const clearAutoAdvanceTimer = useCallback((reason: string) => {
    if (handAutoAdvanceTimerRef.current) {
      window.clearTimeout(handAutoAdvanceTimerRef.current);
      handAutoAdvanceTimerRef.current = null;
      dailyFritzDebugLog('[hand-over] timer-cleared', { reason });
    }
  }, []);

  const dismissRevealForAdvance = useCallback(() => {
    setHandReveal(null);
    pendingHandRevealRef.current = null;
    dailyFritzMinAdvanceAtRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      if (handAutoAdvanceTimerRef.current) clearTimeout(handAutoAdvanceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!handReveal || match.gameOver) {
      setHandRevealProgress(1);
      onRevealHidden();
      handRevealShownAtRef.current = null;
      if (match.gameOver) {
        dailyFritzMinAdvanceAtRef.current = null;
      }
      clearAutoAdvanceTimer(handReveal ? 'game-complete' : 'hidden');
      return;
    }

    handRevealShownAtRef.current = Date.now();
    if (isDailyFritzMode) {
      const revealGate = handRevealShownAtRef.current + DAILY_FRITZ_HAND_AUTO_ADVANCE_MS;
      dailyFritzMinAdvanceAtRef.current = Math.max(dailyFritzMinAdvanceAtRef.current ?? 0, revealGate);
    }

    traceHandLifecycle('showing-hand-result', {
      winner: handReveal.winner,
      pointsAwarded: handReveal.pointsAwarded,
    });
    dailyFritzDebugLog('[hand-over] shown', {
      mode,
      handWinner: handReveal.winner,
      pointsAwarded: handReveal.pointsAwarded,
      gameComplete: match.gameOver,
      setComplete: false,
    });
    setHandRevealProgress(1);
    onRevealShown();

    if (isGuidedMode || isGuidedV2Mode) return;

    if (isDailyFritzMode) {
      dailyFritzDebugLog('[daily-flow] reveal countdown started', {
        handNumber: match.handNumber,
        autoAdvanceMs: DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
        handTransitionInFlight: handTransitionInFlight(),
        prefetchReady: prefetchReady(),
      });
    }
    dailyFritzDebugLog('[hand-over] timer-start', { delayMs: DAILY_FRITZ_HAND_AUTO_ADVANCE_MS });
    emitHandLifecycleDebugLog({
      location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
      message: 'timer-start',
      hypothesisId: 'A',
      data: { delayMs: DAILY_FRITZ_HAND_AUTO_ADVANCE_MS, handNumber: match.handNumber },
    });

    const capturedMatchRef = matchRef;
    const rafId = requestAnimationFrame(() => setHandRevealProgress(0));
    handAutoAdvanceTimerRef.current = window.setTimeout(() => {
      handAutoAdvanceTimerRef.current = null;
      emitHandLifecycleDebugLog({
        location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
        message: 'timer-fired',
        hypothesisId: 'A',
        data: { handNumber: matchRef.current.handNumber },
      });
      onAutoAdvanceRef.current();
    }, DAILY_FRITZ_HAND_AUTO_ADVANCE_MS);

    return () => {
      cancelAnimationFrame(rafId);
      if (handAutoAdvanceTimerRef.current) {
        window.clearTimeout(handAutoAdvanceTimerRef.current);
        handAutoAdvanceTimerRef.current = null;
        dailyFritzDebugLog('[hand-over] timer-cleared', { reason: 'effect-cleanup' });
        emitHandLifecycleDebugLog({
          location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
          message: 'timer-cleared-effect-cleanup',
          hypothesisId: 'A',
          data: { handNumber: capturedMatchRef.current.handNumber },
        });
      }
    };
  }, [
    clearAutoAdvanceTimer,
    handReveal,
    handTransitionInFlight,
    isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    match.gameOver,
    match.handNumber,
    matchRef,
    mode,
    onRevealHidden,
    onRevealShown,
    prefetchReady,
    traceHandLifecycle,
  ]);

  return {
    handReveal,
    handRevealProgress,
    handRevealRef,
    pendingHandRevealRef,
    handRevealTimerRef,
    handRevealShownAtRef,
    dailyFritzMinAdvanceAtRef,
    handAutoAdvanceTimerRef,
    scheduleHandReveal,
    clearHandReveal,
    isRevealTimerPending,
    planHandEndedReveal,
    showHandEndedReveal,
    setHandReveal,
    dismissRevealForAdvance,
    clearAutoAdvanceTimer,
  };
}
