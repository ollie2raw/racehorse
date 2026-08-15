import { useEffect } from 'react';
import type { RunDrawSequence } from '../bot-turn/drawSequence.ts';
import { resolveTranscriptDrawLogCount } from '../daily/dailyFritzDrawTranscript.ts';
import { collectBotTurnSnapshot } from '../bot-turn/botMoveSnapshot.ts';
import { buildBotPassMoveLogEntry } from '../bot-turn/botMoveLogEntries.ts';
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
import { collectPlayerMoveSnapshot, type PlayerMoveSnapshot } from './playerMoveSnapshot.ts';
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
  const { beginLocalRun, isLocalRunCurrent, hasActiveLocalRun, finishLocalRun } = localRun;

  useEffect(() => {
    if (
      match.currentPlayer !== 'you'
      || match.handOver
      || match.gameOver
      || drawSequenceActiveRef.current
      || hasActiveLocalRun()
    ) {
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
    const boneyardBefore = match.boneyard.length;

    void (async () => {
      // Another draw may have started between the sync guard and this tick.
      if (drawSequenceActiveRef.current || hasActiveLocalRun()) return;
      const runToken = beginLocalRun('player-draw');
      setDrawSequenceActiveBoth(true);
      try {
        if (isDailyFritzMode && isDailyFritzLockedBoneyardNoMove(match)) {
          logDailyFritzLockedBoneyardDetected(match);
          const resolution = resolveDailyFritzBlockedHandPass(match);
          if (!isLocalRunCurrent(runToken)) return;
          logDailyFritzBlockedHandResolved(resolution.result);
          for (const pass of resolution.passes) {
            if (pass.player === 'you') {
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
              appendMove(
                buildPassMoveLogEntry(pass.before, snapshot, fritzDifficulty),
                match.handNumber,
              );
            } else {
              appendMove(
                buildBotPassMoveLogEntry(collectBotTurnSnapshot(pass.before), null),
                match.handNumber,
              );
            }
          }
          applyAndNotify(resolution.result);
          return;
        }

        let drawCount = 0;
        const drawSnapshots: PlayerMoveSnapshot[] = [];
        const result = await runDrawSequence(match, 'you', runToken, (step) => {
          if (step.actionKind === 'draw') {
            drawCount += 1;
            drawSnapshots.push(collectPlayerMoveSnapshot(step.beforeState, []));
          }
          captureGuidedMatchCandidateAction('player', step.actionKind, step.beforeState, step.result);
        });
        if (!isLocalRunCurrent(runToken)) return;
        if (result.error) {
          ports.showBoardToast(result.error.message, 'you');
          return;
        }
        setSelectedTile(null);
        // Boneyard delta is the source of truth — onStep can undercount if interrupted.
        drawCount = Math.max(drawCount, boneyardBefore - result.state.boneyard.length);

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
            appendMove(
              buildDrawMoveLogEntry(match, drawSnapshots[index] ?? snapshot, fritzDifficulty),
              match.handNumber,
            );
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
          appendMove(buildPassMoveLogEntry(match, snapshot, fritzDifficulty), match.handNumber);
        }

        applyAndNotify(result);
      } finally {
        // Only the current run may clear draw-active. A stale StrictMode/overlap
        // finally must not unlock the board while a newer draw is in progress.
        if (isLocalRunCurrent(runToken)) {
          finishLocalRun(runToken);
          setDrawSequenceActiveBoth(false);
        }
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
    hasActiveLocalRun,
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
