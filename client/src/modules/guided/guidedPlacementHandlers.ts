import { useCallback } from 'react';
import {
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from '../../game/moveLogger.ts';
import type { Move, PlacementPosition, Tile } from '../../types.ts';
import {
  applyPlayMove,
  getDisplayOpenEnds,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import { getFritzBestMove } from '../bot-turn/fritzEvaluation.ts';
import { sumTilePips } from '../../game/tileUtils.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import {
  notifyGuidedV2EventToasts,
  parseGuidedTranscriptState,
} from './guidedBotMatchHelpers.ts';
import type { BotHandReveal, GuidedCoachTip } from '../match/types.ts';
import type { AuthoredStep, FrozenLesson, GuidedTranscript, GuidedTurn } from '../../learn/guidedAuthoring.ts';
import type { LessonV2, LessonV2Event } from '../../learn/lessonV2.ts';
import { parseTileKey, toTileKey } from '../../game/tileKeys.ts';
import { tileEquals } from '../../game/tileUtils.ts';
import type { useLearningCoach } from '../../learning/useLearningCoach.ts';
import {
  playScoreSound,
  playTileSound,
  queueSound,
} from '../../utils/sound.ts';
import { buildBotMatchStateFromV2Event } from './guidedV2State.ts';

export type GuidedPlacementResult = 'handled' | 'continue';

export type GuidedPlacementHandlerDeps = {
  isGuidedTranscriptMode: boolean;
  guidedTranscript: GuidedTranscript | null;
  currentTranscriptTurn: GuidedTurn | null;
  pushToast: (msg: string, ms?: number) => void;
  setIsOffAuthoredLine: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTile: (tile: Tile | null) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  setGuidedV1Replay: React.Dispatch<React.SetStateAction<{ stepIndex: number; replyIndex: number } | null>>;
  setLessonStepIndex: React.Dispatch<React.SetStateAction<number>>;
  isGuidedV2Mode: boolean;
  frozenV2Lesson: LessonV2 | null;
  isGuidedV2OffLine: boolean;
  guidedV2EventIndex: number;
  setIsGuidedV2OffLine: React.Dispatch<React.SetStateAction<boolean>>;
  setGuidedV2EventIndex: React.Dispatch<React.SetStateAction<number>>;
  matchRef: React.MutableRefObject<BotMatchState>;
  opponentLabel: string;
  showScoreToast: (player: 'you' | 'bot', points: number) => void;
  showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  isMuted: boolean;
  scheduleHandReveal: (reveal: BotHandReveal, delayMs: number) => void;
  match: BotMatchState;
  guidedCoachTip: GuidedCoachTip | null;
  userPlayMoves: Move[];
  coach: ReturnType<typeof useLearningCoach>;
  isAuthoringMode: boolean;
  recordAuthoringStep: (chosenMove: string | null) => void;
  applyAndNotify: (result: BotActionResult) => void;
  appendMove: (entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>) => void;
  setMovesUsed: React.Dispatch<React.SetStateAction<number>>;
  fritzDifficulty: BotDifficulty;
  canPlayCoachedMove: boolean;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
  frozenLesson: FrozenLesson | null;
  currentLessonStep: AuthoredStep | null | undefined;
  isTransitioningRef: React.MutableRefObject<boolean>;
};

export function useGuidedPlacementHandlers(deps: GuidedPlacementHandlerDeps) {
  const {
    isGuidedTranscriptMode,
    guidedTranscript,
    currentTranscriptTurn,
    pushToast,
    setIsOffAuthoredLine,
    setSelectedTile,
    flashLastPlayed,
    setMatch,
    setGuidedV1Replay,
    setLessonStepIndex,
    isGuidedV2Mode,
    frozenV2Lesson,
    isGuidedV2OffLine,
    guidedV2EventIndex,
    setIsGuidedV2OffLine,
    setGuidedV2EventIndex,
    matchRef,
    opponentLabel,
    showScoreToast,
    showBoardToast,
    isMuted,
    scheduleHandReveal,
    match,
    guidedCoachTip,
    userPlayMoves,
    coach,
    isAuthoringMode,
    recordAuthoringStep,
    applyAndNotify,
    appendMove,
    setMovesUsed,
    fritzDifficulty,
    canPlayCoachedMove,
    currentExpectedV2PlayerEvent,
    frozenLesson,
    currentLessonStep,
    isTransitioningRef,
  } = deps;

  const acceptGuidedTranscriptTurn = useCallback((turn: GuidedTurn, playedTile: Tile | null) => {
    const playerState = parseGuidedTranscriptState(turn.playerStateAfter);
    if (!playerState) {
      pushToast('This transcript turn is missing a valid player state.');
      setIsOffAuthoredLine(true);
      return;
    }
    setSelectedTile(null);
    flashLastPlayed(playedTile);
    setMatch(playerState);
    if (turn.fritzReplies.length > 0) {
      setGuidedV1Replay({ stepIndex: turn.stepIndex, replyIndex: 0 });
      return;
    }
    setLessonStepIndex((prev) => prev + 1);
  }, [flashLastPlayed, pushToast, setMatch, setSelectedTile, setGuidedV1Replay, setIsOffAuthoredLine, setLessonStepIndex]);

  const scheduleV2HandReveal = useCallback((event: LessonV2Event, playerHand: Tile[], fritzHand: Tile[], delayMs: number) => {
    if (!event.handOver || !event.handEnded) return;
    scheduleHandReveal({
      winner: event.handEnded.winner === 'player' ? 'you'
        : event.handEnded.winner === 'fritz' ? 'bot'
        : null,
      reason: event.handEnded.reason,
      pointsAwarded: event.handEnded.pointsAwarded,
      loserPips: event.handEnded.loserPips,
      calcText: event.handEnded.calcText,
      yourRemainingTiles: playerHand,
      botRemainingTiles: fritzHand,
    }, delayMs);
  }, [scheduleHandReveal]);

  const applyV2PlayerEvent = useCallback((event: LessonV2Event, playedTile: Tile | null, revealDelayMs: number) => {
    const nextState = buildBotMatchStateFromV2Event(matchRef.current, event);
    setMatch(nextState);
    notifyGuidedV2EventToasts(event, opponentLabel, { showScoreToast, showBoardToast });
    if (event.pointsScored > 0) queueSound(() => playScoreSound(event.pointsScored, isMuted), 80);
    queueSound(() => playTileSound('standard', isMuted), 0);
    setGuidedV2EventIndex((i) => i + 1);
    flashLastPlayed(playedTile);
    setSelectedTile(null);
    scheduleV2HandReveal(event, nextState.players.you.hand, nextState.players.bot.hand, revealDelayMs);
  }, [
    flashLastPlayed,
    isMuted,
    matchRef,
    opponentLabel,
    scheduleV2HandReveal,
    setMatch,
    setSelectedTile,
    setGuidedV2EventIndex,
    showBoardToast,
    showScoreToast,
  ]);

  const handleGuidedPlacement = useCallback((move: Move, position: PlacementPosition): GuidedPlacementResult => {
    if (isGuidedTranscriptMode && guidedTranscript) {
      const turn = currentTranscriptTurn;
      const clickedMove = move.tile
        ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
        : null;
      const expected = turn?.expectedPlayerMove ?? null;
      const expectedMove = expected
        ? expected.type === 'play'
          ? `${expected.tile ?? ''}${expected.position ? `:${expected.position}` : ''}`
          : expected.type
        : null;
      if (!turn || !expected || expected.type !== 'play') {
        pushToast('This transcript turn does not accept a tile placement.');
        setIsOffAuthoredLine(true);
        return 'handled';
      }
      if (clickedMove !== expectedMove) {
        setIsOffAuthoredLine(true);
        pushToast('Off lesson line. Guided playback stopped.');
        return 'handled';
      }
      acceptGuidedTranscriptTurn(turn, move.tile ?? null);
      return 'handled';
    }

    if (isGuidedV2Mode && frozenV2Lesson && !isGuidedV2OffLine) {
      const expected = frozenV2Lesson.events[guidedV2EventIndex];
      const playedKey = move.tile ? toTileKey(move.tile) : null;
      const expectedKey = expected?.tile ?? null;
      const expectedPos = expected?.position ?? null;
      const tileMatch = playedKey && expectedKey && playedKey === expectedKey;
      const posMatch = !expectedPos || move.position === expectedPos;
      if (tileMatch && posMatch && expected) {
        applyV2PlayerEvent(expected, move.tile ?? null, 1400);
        return 'handled';
      }
      console.log('[guided-v2-mismatch]', {
        guidedV2EventIndex,
        expectedTile: expected?.tile ?? null,
        expectedPosition: expectedPos,
        clickedTile: playedKey,
        clickedPosition: typeof position === 'string' ? position : null,
        posMatch,
      });
      setIsGuidedV2OffLine(true);
      pushToast('You went off the lesson. Continuing live from here.');
      return 'continue';
    }

    return 'continue';
  }, [
    acceptGuidedTranscriptTurn,
    applyV2PlayerEvent,
    currentTranscriptTurn,
    guidedTranscript,
    guidedV2EventIndex,
    frozenV2Lesson,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    pushToast,
    setIsGuidedV2OffLine,
    setIsOffAuthoredLine,
  ]);

  const playBestMove = useCallback(() => {
    if (!guidedCoachTip?.bestMove.tile) return;
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    const move = guidedCoachTip.bestMove;
    const boardEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const validMoves = userPlayMoves.filter((m) => m.tile).map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const result = applyPlayMove(match, 'you', move);
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);
    if (isAuthoringMode && move.tile) {
      const posStr = typeof move.position === 'string' && move.position ? `:${move.position}` : '';
      recordAuthoringStep(`${toTileKey(move.tile)}${posStr}`);
    }
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(move.tile as Tile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      pointsScored: result.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match, fritzDifficulty),
    });
  }, [
    applyAndNotify,
    appendMove,
    coach,
    flashLastPlayed,
    fritzDifficulty,
    guidedCoachTip,
    isAuthoringMode,
    match,
    recordAuthoringStep,
    setMovesUsed,
    setSelectedTile,
    userPlayMoves,
  ]);

  const playLessonBestMove = useCallback(() => {
    if (!isGuidedTranscriptMode && !isGuidedV2Mode) return;
    if (!canPlayCoachedMove || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;

    if (isGuidedV2Mode && frozenV2Lesson && !isGuidedV2OffLine) {
      const expected = currentExpectedV2PlayerEvent;
      if (!expected || expected.actor !== 'player' || expected.action !== 'play' || !expected.tile) return;
      const parsedTile = parseTileKey(expected.tile);
      if (!parsedTile) return;
      let move: Move | null = null;
      if (expected.position) {
        move = userPlayMoves.find(
          (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === expected.position,
        ) ?? null;
      }
      if (!move) {
        move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
      }
      if (!move?.tile) return;
      applyV2PlayerEvent(expected, move.tile ?? null, 1400);
      return;
    }

    if (isGuidedTranscriptMode) {
      const turn = currentTranscriptTurn;
      if (!turn || turn.expectedPlayerMove.type !== 'play') return;
      const tileKeyRaw = turn.expectedPlayerMove.tile ?? '';
      const positionRaw = turn.expectedPlayerMove.position ?? null;
      const parsedTile = parseTileKey(tileKeyRaw);
      if (!parsedTile) return;
      let move: Move | null = null;
      if (positionRaw) {
        move = userPlayMoves.find(
          (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === positionRaw,
        ) ?? null;
      }
      if (!move) {
        move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
      }
      if (!move?.tile) return;
      acceptGuidedTranscriptTurn(turn, move.tile ?? null);
      return;
    }

    if (!frozenLesson) return;

    const step = currentLessonStep;
    if (!step?.chosenMove || step.chosenMove === 'draw' || step.chosenMove === 'pass') return;

    const colonIdx = step.chosenMove.indexOf(':');
    const tileKeyRaw = colonIdx >= 0 ? step.chosenMove.slice(0, colonIdx) : step.chosenMove;
    const positionRaw = colonIdx >= 0 ? step.chosenMove.slice(colonIdx + 1) : null;

    const parsedTile = parseTileKey(tileKeyRaw);
    if (!parsedTile) return;

    let move: Move | null = null;
    if (positionRaw) {
      move = userPlayMoves.find(
        (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === positionRaw,
      ) ?? null;
    }
    if (!move) {
      move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
    }
    if (!move?.tile) return;
    const clickedMove = `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`;
    console.log('[guided-player] expectedMove =', step.chosenMove, 'clickedMove =', clickedMove, 'accepted =', true);

    const boardEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const validMoves = userPlayMoves.filter((m) => m.tile).map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const result = applyPlayMove(match, 'you', move);
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);
    setLessonStepIndex((prev) => prev + 1);
    isTransitioningRef.current = true;
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(move.tile as Tile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      pointsScored: result.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match, fritzDifficulty),
    });
  }, [
    acceptGuidedTranscriptTurn,
    applyAndNotify,
    applyV2PlayerEvent,
    appendMove,
    canPlayCoachedMove,
    coach,
    currentExpectedV2PlayerEvent,
    currentLessonStep,
    currentTranscriptTurn,
    flashLastPlayed,
    frozenLesson,
    frozenV2Lesson,
    fritzDifficulty,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    isTransitioningRef,
    match,
    setMovesUsed,
    setSelectedTile,
    setLessonStepIndex,
    userPlayMoves,
  ]);

  return {
    acceptGuidedTranscriptTurn,
    scheduleV2HandReveal,
    applyV2PlayerEvent,
    handleGuidedPlacement,
    playBestMove,
    playLessonBestMove,
  };
}