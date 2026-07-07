import { useCallback } from 'react';
import { applyPlayMove } from '../match/runtime/botEngine.ts';
import { findMoveForSelection, sumTilePips } from '../../game/tileUtils.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import type { PlacementPosition } from '../../types.ts';
import {
  traceDailyFritzMoveApplied,
  traceDailyFritzPlacementClick,
} from './dailyFritzPlayerDiagnostics.ts';
import {
  buildAuthoringV2PlayEvent,
  recordAuthoringPlayStep,
} from './playerAuthoringCapture.ts';
import {
  buildGhostPlacementMoveLogEntry,
  resolveGhostAgreementFeedback,
} from './playerGhostSync.ts';
import {
  buildPlacementMoveLogEntry,
} from './playerMoveLogEntries.ts';
import { collectPlayerMoveSnapshot } from './playerMoveSnapshot.ts';
import { getPlacementClickBlockReason } from './playerPlacementGuards.ts';
import type { UsePlayerTurnOrchestrationArgs } from './types.ts';

type UsePlayerPlacementHandlerArgs = Pick<
  UsePlayerTurnOrchestrationArgs,
  | 'match'
  | 'selectedTile'
  | 'userPlayMoves'
  | 'ports'
  | 'guided'
  | 'authoring'
  | 'ghost'
  | 'isDailyFritzMode'
  | 'fritzDifficulty'
  | 'moveCounterRef'
> & {
  applyAndNotify: (result: import('../match/runtime/botEngine.ts').BotActionResult) => void;
};

export function usePlayerPlacementHandler({
  match,
  selectedTile,
  userPlayMoves,
  ports,
  guided,
  authoring,
  ghost,
  isDailyFritzMode,
  fritzDifficulty,
  moveCounterRef,
  applyAndNotify,
}: UsePlayerPlacementHandlerArgs) {
  const {
    handleGuidedPlacement,
    captureGuidedMatchCandidateAction,
    flashLastPlayed,
    recordPlayerMove,
    appendGhostMove,
    appendMove,
    setSelectedTile,
    setSelectedController,
    setMovesUsed,
    setGhostAgreementType,
    setGhostBoardPulse,
    recordAuthoringStep,
    createV2Event,
    setAuthoringV2Events,
  } = ports;

  const {
    currentLessonStep,
    lessonStepIndex,
    isOffAuthoredLine,
  } = guided;

  const {
    isAuthoringMode,
    isAuthoringV2Mode,
    authoringNoteText,
    authoringV2NextEventIndexRef,
  } = authoring;

  const { isGhostMode, ghostSuggestedPlayerMove } = ghost;

  return useCallback((position: PlacementPosition) => {
    console.log('[guided-path-root]', {
      position,
      selectedTile: selectedTile ? toTileKey(selectedTile) : null,
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
    });
    console.log('[guided-click-enter]', {
      selectedTile: selectedTile ? toTileKey(selectedTile) : null,
      position,
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
      isOffAuthoredLine,
    });
    if (isDailyFritzMode) {
      traceDailyFritzPlacementClick({ position, selectedTile, match });
    }

    const move = selectedTile
      ? findMoveForSelection(userPlayMoves, selectedTile, position)
      : null;
    const blockReason = getPlacementClickBlockReason(match, selectedTile, Boolean(move));
    if (blockReason) {
      console.log(`[guided-click-blocked] reason = ${blockReason}`);
      return;
    }

    const expectedMoveForLog = currentLessonStep?.chosenMove ?? null;
    const clickedMoveForLog = move!.tile
      ? `${toTileKey(move!.tile)}${move!.position ? `:${move!.position}` : ''}`
      : null;
    console.log('[guided-click-move]', {
      foundMove: true,
      clickedMove: clickedMoveForLog,
      expectedMove: expectedMoveForLog,
    });

    const guidedPlacement = handleGuidedPlacement(move!, position);
    if (guidedPlacement === 'handled') return;

    const snapshot = collectPlayerMoveSnapshot(match, userPlayMoves);
    const result = applyPlayMove(match, 'you', move!);
    captureGuidedMatchCandidateAction('player', 'tile-play', match, result, move!);
    if (isDailyFritzMode) {
      traceDailyFritzMoveApplied(move!);
    }
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    recordPlayerMove(match, move!);

    recordAuthoringPlayStep(isAuthoringMode, move!, position, recordAuthoringStep);

    if (isAuthoringV2Mode) {
      const eventIndex = authoringV2NextEventIndexRef.current++;
      const v2event = buildAuthoringV2PlayEvent(createV2Event, {
        result,
        handNumber: match.handNumber,
        move: move!,
        position,
        eventIndex,
        coachingText: authoringNoteText,
      });
      setAuthoringV2Events((prev) => [...prev, v2event]);
      console.log('[v2-capture] player play', { eventIndex, tile: v2event.tile, position: v2event.position });
    }

    console.log('[guided-move] applying result to match state');
    console.log('[guided-move] result.state player hand =', result.state.players.you.hand.map(toTileKey));
    console.log('[guided-move] result.state board mainLine length =', result.state.board?.mainLine.length);

    applyAndNotify(result);
    console.log('[guided-click-applied]', {
      currentPlayerAfter: result.state.currentPlayer,
      lessonStepIndexCurrent: lessonStepIndex,
    });
    flashLastPlayed(move!.tile ?? null);
    setSelectedTile(null);
    setSelectedController(null);

    if (isGhostMode && selectedTile && ghostSuggestedPlayerMove) {
      const feedback = resolveGhostAgreementFeedback(move!, position, ghostSuggestedPlayerMove);
      if (feedback.kind === 'agreement') {
        setGhostAgreementType(feedback.type);
        window.setTimeout(() => setGhostAgreementType(null), 1300);
      } else {
        setGhostBoardPulse(true);
        window.setTimeout(() => setGhostBoardPulse(false), 520);
      }
      appendGhostMove(
        buildGhostPlacementMoveLogEntry({
          moveCounter: moveCounterRef.current,
          handNumber: match.handNumber,
          snapshot,
          selectedTile,
          position,
          pointsScored: result.scored?.points ?? 0,
          forcedDraw: Boolean(result.drew?.player === 'you'),
        }),
      );
    }

    appendMove(
      buildPlacementMoveLogEntry(
        match,
        snapshot,
        selectedTile!,
        afterPips,
        result.scored?.points ?? 0,
        fritzDifficulty,
      ),
    );
  }, [
    applyAndNotify,
    appendGhostMove,
    appendMove,
    authoringNoteText,
    authoringV2NextEventIndexRef,
    captureGuidedMatchCandidateAction,
    createV2Event,
    currentLessonStep?.chosenMove,
    flashLastPlayed,
    fritzDifficulty,
    ghostSuggestedPlayerMove,
    handleGuidedPlacement,
    isAuthoringMode,
    isAuthoringV2Mode,
    isDailyFritzMode,
    isGhostMode,
    isOffAuthoredLine,
    lessonStepIndex,
    match,
    moveCounterRef,
    recordAuthoringStep,
    recordPlayerMove,
    selectedTile,
    setAuthoringV2Events,
    setGhostAgreementType,
    setGhostBoardPulse,
    setMovesUsed,
    setSelectedController,
    setSelectedTile,
    userPlayMoves,
  ]);
}