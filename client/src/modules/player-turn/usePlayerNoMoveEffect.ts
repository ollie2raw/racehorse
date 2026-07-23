import { useEffect } from 'react';
import type { RunDrawSequence } from '../bot-turn/drawSequence.ts';
import { resolveTranscriptDrawLogCount } from '../daily/dailyFritzDrawTranscript.ts';
import {
  isDailyFritzLockedBoneyardNoMove,
  resolveDailyFritzBlockedHandPass,
} from './dailyFritzBlockedHand.ts';
import {
  logDailyFritzBlockedHandResolved,
  logDailyFritzLockedBoneyardDetected,
} from './dailyFritzPlayerDiagnostics.ts';
import {
  buildAuthoringV2DrawEvent,
  buildAuthoringV2PassEvent,
  recordAuthoringPassStep,
} from './playerAuthoringCapture.ts';
import {
  buildGhostDrawMoveLogEntry,
  buildGhostPassMoveLogEntry,
} from './playerGhostSync.ts';
import {
  buildDrawMoveLogEntry,
  buildPassMoveLogEntry,
} from './playerMoveLogEntries.ts';
import { collectPlayerMoveSnapshot } from './playerMoveSnapshot.ts';
import type { UsePlayerTurnOrchestrationArgs } from './types.ts';

type UsePlayerNoMoveEffectArgs = Pick<
  UsePlayerTurnOrchestrationArgs,
  | 'match'
  | 'userPlayMoves'
  | 'ports'
  | 'guided'
  | 'authoring'
  | 'ghost'
  | 'isDailyFritzMode'
  | 'fritzDifficulty'
  | 'moveCounterRef'
  | 'drawSequenceActiveRef'
  | 'setDrawSequenceActiveBoth'
  | 'isTransitioningRef'
  | 'localRun'
> & {
  applyAndNotify: (result: import('../match/runtime/botEngine.ts').BotActionResult) => void;
  runDrawSequence: RunDrawSequence;
};

export function usePlayerNoMoveEffect({
  match,
  userPlayMoves,
  ports,
  guided,
  authoring,
  ghost,
  isDailyFritzMode,
  fritzDifficulty,
  moveCounterRef,
  drawSequenceActiveRef,
  setDrawSequenceActiveBoth,
  isTransitioningRef,
  localRun,
  applyAndNotify,
  runDrawSequence,
}: UsePlayerNoMoveEffectArgs) {
  const {
    appendGhostMove,
    appendMove,
    pushToast,
    setIsOffAuthoredLine,
    setLessonStepIndex,
    setAuthoringV2Events,
    setSelectedTile,
    acceptGuidedTranscriptTurn,
    captureGuidedMatchCandidateAction,
    recordAuthoringStep,
    createV2Event,
  } = ports;

  const {
    currentTranscriptTurn,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    isGuidedMode,
    frozenLesson,
  } = guided;

  const {
    isAuthoringMode,
    isAuthoringV2Mode,
    authoringV2NextEventIndexRef,
  } = authoring;

  const { isGhostMode } = ghost;
  const { beginLocalRun, isLocalRunCurrent, finishLocalRun } = localRun;

  useEffect(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver || drawSequenceActiveRef.current) {
      return;
    }
    if (isGuidedTranscriptMode) {
      const turn = currentTranscriptTurn;
      if (!turn) return;
      if (turn.expectedPlayerMove.type === 'play') {
        if (userPlayMoves.length === 0) {
          pushToast('This transcript turn has no legal authored tile play.');
          setIsOffAuthoredLine(true);
        }
        return;
      }
      acceptGuidedTranscriptTurn(turn, null);
      return;
    }
    if (userPlayMoves.length > 0) return;
    if (isGuidedV2Mode && !isGuidedV2OffLine) return;

    const snapshot = collectPlayerMoveSnapshot(match, userPlayMoves);

    void (async () => {
      const runToken = beginLocalRun('player-draw');
      setDrawSequenceActiveBoth(true);
      try {
        if (isDailyFritzMode && isDailyFritzLockedBoneyardNoMove(match)) {
          logDailyFritzLockedBoneyardDetected(match);
          const fastResult = resolveDailyFritzBlockedHandPass(match);
          if (!isLocalRunCurrent(runToken)) return;
          logDailyFritzBlockedHandResolved(fastResult);
          if (fastResult.passed) {
            if (isGhostMode) {
              appendGhostMove(
                buildGhostPassMoveLogEntry({
                  moveCounter: moveCounterRef.current,
                  handNumber: match.handNumber,
                  snapshot,
                  useTupleHandFormat: true,
                }),
              );
            }
            appendMove(buildPassMoveLogEntry(match, snapshot, fritzDifficulty));
          }
          applyAndNotify(fastResult);
          return;
        }

        let drawCount = 0;
        const result = await runDrawSequence(match, 'you', runToken, (step) => {
          if (step.actionKind === 'draw') drawCount += 1;
          captureGuidedMatchCandidateAction('player', step.actionKind, step.beforeState, step.result);
        });
        if (!isLocalRunCurrent(runToken)) return;
        if (result.error) {
          ports.showBoardToast(result.error.message, 'you');
          return;
        }
        setSelectedTile(null);

        if (result.drew) {
          if (isGhostMode) {
            appendGhostMove(
              buildGhostDrawMoveLogEntry({
                moveCounter: moveCounterRef.current,
                handNumber: match.handNumber,
                snapshot,
                useTupleHandFormat: true,
              }),
            );
          }
          const drawLogCount = resolveTranscriptDrawLogCount(isDailyFritzMode, drawCount);
          for (let index = 0; index < drawLogCount; index += 1) {
            appendMove(buildDrawMoveLogEntry(match, snapshot, fritzDifficulty));
          }
        }

        if (isAuthoringV2Mode && result.drew) {
          const eventIndex = authoringV2NextEventIndexRef.current++;
          const v2event = buildAuthoringV2DrawEvent(createV2Event, {
            result,
            handNumber: match.handNumber,
            eventIndex,
          });
          setAuthoringV2Events((prev) => [...prev, v2event]);
          console.log('[v2-capture] player draw', { eventIndex });
        }

        if (result.passed) {
          recordAuthoringPassStep(isAuthoringMode, recordAuthoringStep);
          if (isAuthoringV2Mode) {
            const eventIndex = authoringV2NextEventIndexRef.current++;
            const v2event = buildAuthoringV2PassEvent(createV2Event, {
              result,
              handNumber: match.handNumber,
              eventIndex,
            });
            setAuthoringV2Events((prev) => [...prev, v2event]);
            console.log('[v2-capture] player pass', { eventIndex });
          }
          if (isGuidedMode && frozenLesson) {
            isTransitioningRef.current = true;
            setLessonStepIndex((prev) => prev + 1);
          }
          if (isGhostMode) {
            appendGhostMove(
              buildGhostPassMoveLogEntry({
                moveCounter: moveCounterRef.current,
                handNumber: match.handNumber,
                snapshot,
                useTupleHandFormat: true,
              }),
            );
          }
          appendMove(buildPassMoveLogEntry(match, snapshot, fritzDifficulty));
        }

        applyAndNotify(result);
      } finally {
        if (isLocalRunCurrent(runToken)) {
          finishLocalRun(runToken);
        }
        setDrawSequenceActiveBoth(false);
      }
    })();

    return () => {
      // Progress renders from this draw sequence should not cancel its final pass/block result.
    };
  }, [
    acceptGuidedTranscriptTurn,
    appendGhostMove,
    appendMove,
    applyAndNotify,
    authoringV2NextEventIndexRef,
    beginLocalRun,
    captureGuidedMatchCandidateAction,
    createV2Event,
    currentTranscriptTurn,
    drawSequenceActiveRef,
    finishLocalRun,
    frozenLesson,
    fritzDifficulty,
    isAuthoringMode,
    isAuthoringV2Mode,
    isDailyFritzMode,
    isGhostMode,
    isGuidedMode,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    isLocalRunCurrent,
    isTransitioningRef,
    match,
    moveCounterRef,
    pushToast,
    recordAuthoringStep,
    runDrawSequence,
    setAuthoringV2Events,
    setDrawSequenceActiveBoth,
    setIsOffAuthoredLine,
    setLessonStepIndex,
    setSelectedTile,
    userPlayMoves.length,
  ]);
}
