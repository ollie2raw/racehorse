import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ladderFinalizeFailureMessage,
  ladderSlotRequiresFinalize,
  mergeTodayAfterAttemptUpdate,
  recordLadderFinalizeStreak,
  recordRitualStreakIfNeeded,
  runLadderFinalizeSubmission,
  runLadderSlotSubmission,
  shouldShowPracticeOverlay,
  shouldSkipLadderSlotSubmission,
} from './dailyPuzzleLadderSlotSubmission';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import type {
  DailyPuzzleAttempt,
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
} from './types';

type LadderPlayMode = 'scored' | 'practice';

export type UseDailyPuzzleLadderGameplayParams = {
  attempt: DailyPuzzleAttempt | null;
  finalizeReady: boolean;
  finalizePending: boolean;
  playMode: LadderPlayMode;
  movesUsed: number;
  startTimeRef: React.RefObject<number>;
  moveTraceRef: React.RefObject<Array<Record<string, unknown>>>;
  setAttempt: (attempt: DailyPuzzleAttempt) => void;
  setToday: React.Dispatch<React.SetStateAction<DailyPuzzleTodayResponse>>;
  setHubError: (error: string | null) => void;
  setFinalizePending: React.Dispatch<React.SetStateAction<boolean>>;
  setSlotOverlay: React.Dispatch<
    React.SetStateAction<{
      response: DailyPuzzleSubmitSlotResponse;
      rawScore: number;
    } | null>
  >;
  setFinalOverlay: React.Dispatch<
    React.SetStateAction<{
      response: DailyPuzzleCompleteResponse;
    } | null>
  >;
  setPracticeOverlay: React.Dispatch<
    React.SetStateAction<{
      slotIndex: number;
      slotTitle: string;
      rawScore: number;
      bestPossible: number | null;
    } | null>
  >;
  finalOverlay: { response: DailyPuzzleCompleteResponse } | null;
};

export function useDailyPuzzleLadderGameplay({
  attempt,
  finalizeReady,
  finalizePending,
  playMode,
  movesUsed,
  startTimeRef,
  moveTraceRef,
  setAttempt,
  setToday,
  setHubError,
  setFinalizePending,
  setSlotOverlay,
  setFinalOverlay,
  setPracticeOverlay,
  finalOverlay,
}: UseDailyPuzzleLadderGameplayParams) {
  const [submitPending, setSubmitPending] = useState(false);
  const autoFinalizeTriedRef = useRef(false);

  const applyLadderComplete = useCallback(
    (completeResponse: DailyPuzzleCompleteResponse) => {
      setAttempt(completeResponse.attempt);
      setToday((current) =>
        mergeTodayAfterAttemptUpdate(current, completeResponse.attempt, false),
      );
      setFinalOverlay({ response: completeResponse });
      recordLadderFinalizeStreak(completeResponse.attempt.puzzleDate);
    },
    [setAttempt, setFinalOverlay, setToday],
  );

  const runFinalize = useCallback(async () => {
    if (!attempt || finalizePending) return;
    setFinalizePending(true);
    setHubError(null);
    try {
      const completeResponse = await runLadderFinalizeSubmission({ attempt });
      applyLadderComplete(completeResponse);
    } catch (error) {
      setHubError(
        error instanceof Error ? error.message : 'Unable to finalize ladder run. Try again.',
      );
    } finally {
      setFinalizePending(false);
    }
  }, [applyLadderComplete, attempt, finalizePending, setFinalizePending, setHubError]);

  useEffect(() => {
    if (!finalizeReady || !attempt || finalOverlay || autoFinalizeTriedRef.current) return;
    autoFinalizeTriedRef.current = true;
    void runFinalize();
  }, [attempt?.id, finalizeReady, finalOverlay, runFinalize]);

  const completeSlot = useCallback(
    async (nextStatus: PlayStatus, rawScoreValue: number, activeSlot: DailyPuzzleSlot | null) => {
      if (!activeSlot) return;
      if (shouldShowPracticeOverlay(playMode)) {
        setPracticeOverlay({
          slotIndex: activeSlot.slotIndex,
          slotTitle: activeSlot.slotTitle,
          rawScore: rawScoreValue,
          bestPossible: activeSlot.bestPossibleScore,
        });
        return;
      }
      if (!attempt || shouldSkipLadderSlotSubmission(submitPending)) return;
      setSubmitPending(true);
      setHubError(null);
      try {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
        const response = await runLadderSlotSubmission({
          attempt,
          activeSlot,
          nextStatus,
          rawScoreValue,
          movesUsed,
          elapsedSeconds,
          submittedLine: moveTraceRef.current,
        });
        setAttempt(response.attempt);
        setToday((current) => mergeTodayAfterAttemptUpdate(current, response.attempt));
        recordRitualStreakIfNeeded(response.attempt.puzzleDate, activeSlot.slotIndex);
        if (ladderSlotRequiresFinalize(response)) {
          setFinalizePending(true);
          try {
            const completeResponse = await runLadderFinalizeSubmission({
              attempt: response.attempt,
            });
            applyLadderComplete(completeResponse);
          } catch (finalizeError) {
            setHubError(ladderFinalizeFailureMessage(finalizeError));
          } finally {
            setFinalizePending(false);
          }
        } else {
          setSlotOverlay({ response, rawScore: rawScoreValue });
        }
      } catch (error) {
        setHubError(error instanceof Error ? error.message : 'Unable to submit slot result.');
      } finally {
        setSubmitPending(false);
      }
    },
    [
      applyLadderComplete,
      attempt,
      moveTraceRef,
      movesUsed,
      playMode,
      setAttempt,
      setFinalizePending,
      setHubError,
      setPracticeOverlay,
      setSlotOverlay,
      setToday,
      startTimeRef,
      submitPending,
    ],
  );

  return {
    submitPending,
    runFinalize,
    completeSlot,
  };
}