import { useEffect } from 'react';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { BotHandReveal } from '../types.ts';
import {
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  emitHandLifecycleDebugLog,
  getDailyFritzWatchdogDelayMs,
  logDailyFritzHandBreadcrumb,
  shouldDailyFritzWatchdogAdvance,
  shouldShowHandRevealForHand,
  warnHandLifecycleStuck,
} from './handLifecycleRules.ts';
import { DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS } from '../../daily/dailyFritzContracts.ts';
import { dailyFritzDebugLog } from '../../daily/dailyFritzMatchDiagnostics.ts';

export type UseHandLifecycleWatchdogsArgs = {
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  handReveal: BotHandReveal | null;
  handRevealRef: React.MutableRefObject<BotHandReveal | null>;
  pendingHandRevealRef: React.MutableRefObject<{ handNumber: number; reveal: BotHandReveal } | null>;
  handRevealTimerRef: React.MutableRefObject<ReturnType<typeof window.setTimeout> | null>;
  handRevealShownAtRef: React.MutableRefObject<number | null>;
  dailyFritzMinAdvanceAtRef: React.MutableRefObject<number | null>;
  handTransitionInFlightRef: React.MutableRefObject<boolean>;
  lastDailyFlowLabelRef: React.MutableRefObject<string>;
  isDailyFritzMode: boolean;
  isGuidedMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  handAdvanceError: string | null;
  setShowManualHandAdvance: React.Dispatch<React.SetStateAction<boolean>>;
  setHandReveal: React.Dispatch<React.SetStateAction<BotHandReveal | null>>;
  advanceHand: () => void;
};

/**
 * Owns safety timers: stall hint after reveal, non-Daily-Fritz fallback advance,
 * and Daily Fritz watchdog restore/advance.
 */
export function useHandLifecycleWatchdogs({
  match,
  matchRef,
  handReveal,
  handRevealRef,
  pendingHandRevealRef,
  handRevealTimerRef,
  handRevealShownAtRef,
  dailyFritzMinAdvanceAtRef,
  handTransitionInFlightRef,
  lastDailyFlowLabelRef,
  isDailyFritzMode,
  isGuidedMode,
  isGuidedV2Mode,
  isGuidedV2OffLine,
  handAdvanceError,
  setShowManualHandAdvance,
  setHandReveal,
  advanceHand,
}: UseHandLifecycleWatchdogsArgs) {
  useEffect(() => {
    if (!handReveal || match.gameOver || isGuidedMode || isGuidedV2Mode) {
      return;
    }
    const stallMs =
      DAILY_FRITZ_HAND_AUTO_ADVANCE_MS + DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS * 2 + 2500;
    const warnId = window.setTimeout(() => {
      if (!handRevealShownAtRef.current) return;
      const visibleMs = Date.now() - handRevealShownAtRef.current;
      if (visibleMs < stallMs - 500) return;
      if (handAdvanceError) return;
      warnHandLifecycleStuck('hand result modal visible past auto-advance window', {
        visibleMs,
        stallMs,
        handOver: matchRef.current.handOver,
        gameOver: matchRef.current.gameOver,
        inFlight: handTransitionInFlightRef.current,
        handAdvanceError,
      });
      emitHandLifecycleDebugLog({
        location: 'BotMatchScreen.tsx:handRevealStallWarn',
        message: 'stall-hint-shown',
        hypothesisId: 'C',
        data: { visibleMs, stallMs, inFlight: handTransitionInFlightRef.current },
      });
      logDailyFritzHandBreadcrumb('manual-advance-shown', {
        reason: 'hand-reveal-stall',
        visibleMs,
        stallMs,
        inFlight: handTransitionInFlightRef.current,
      });
      setShowManualHandAdvance(true);
    }, stallMs);
    return () => window.clearTimeout(warnId);
  }, [
    handAdvanceError,
    handReveal,
    handRevealShownAtRef,
    handTransitionInFlightRef,
    isGuidedMode,
    isGuidedV2Mode,
    match.gameOver,
    matchRef,
    setShowManualHandAdvance,
  ]);

  useEffect(() => {
    if (!match.handOver || match.gameOver || handReveal || handRevealTimerRef.current) return;
    if (isDailyFritzMode) return;
    if (isGuidedV2Mode && !isGuidedV2OffLine) return;
    const timer = window.setTimeout(() => {
      if (matchRef.current.handOver && !matchRef.current.gameOver && !handRevealTimerRef.current) {
        advanceHand();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    advanceHand,
    handReveal,
    handRevealTimerRef,
    isDailyFritzMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    match.gameOver,
    match.handOver,
    matchRef,
  ]);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    if (!match.handOver || match.gameOver) return;

    const watchdogMs = getDailyFritzWatchdogDelayMs(handReveal !== null);
    const id = window.setTimeout(() => {
      const live = matchRef.current;
      if (!live.handOver || live.gameOver) return;

      if (!handRevealRef.current && pendingHandRevealRef.current) {
        const pending = pendingHandRevealRef.current;
        if (shouldShowHandRevealForHand(live.handNumber, pending.handNumber)) {
          logDailyFritzHandBreadcrumb('reveal-restored', {
            handNumber: pending.handNumber,
            source: 'watchdog',
          });
          setHandReveal(pending.reveal);
          return;
        }
      }

      if (!shouldDailyFritzWatchdogAdvance({
        handOver: live.handOver,
        gameOver: live.gameOver,
        handRevealVisible: handRevealRef.current !== null,
        minAdvanceAt: dailyFritzMinAdvanceAtRef.current,
        nowMs: Date.now(),
      })) {
        dailyFritzDebugLog('[daily-flow] watchdog skipped — reveal/countdown not finished', {
          handNumber: live.handNumber,
          revealVisible: handRevealRef.current !== null,
          minAdvanceAt: dailyFritzMinAdvanceAtRef.current,
        });
        return;
      }

      dailyFritzDebugLog('[daily-flow] watchdog fired — advancing after reveal window', {
        handNumber: live.handNumber,
        handTransitionInFlight: handTransitionInFlightRef.current,
        lastLabel: lastDailyFlowLabelRef.current,
        revealVisible: handRevealRef.current !== null,
      });
      handTransitionInFlightRef.current = false;
      advanceHand();
    }, watchdogMs);

    return () => window.clearTimeout(id);
  }, [
    advanceHand,
    dailyFritzMinAdvanceAtRef,
    handReveal,
    handRevealRef,
    handTransitionInFlightRef,
    isDailyFritzMode,
    lastDailyFlowLabelRef,
    match.gameOver,
    match.handOver,
    matchRef,
    pendingHandRevealRef,
    setHandReveal,
  ]);
}