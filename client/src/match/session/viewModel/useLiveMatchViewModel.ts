import { useEffect, useMemo, type MutableRefObject } from 'react';
import type { GameState, Move, Tile } from '../../../types';
import { tileEquals } from '../../../game/tileUtils';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';

const EMPTY_MOVES: Move[] = [];

export type LiveMatchViewModelInput = {
  state: GameState | null;
  legalMoves: Move[];
  you: string;
  isConnected: boolean;
  joinedRoom: string | null;
  canDraw: boolean;
  selectedTile: Tile | null;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  opponentDragging: boolean;
  drawStepMyHand: Tile[] | null;
  drawStepOpponentHandCount: number | null;
  boneyardDisplayCount: number | null;
  frozenHandOverBoardRef: MutableRefObject<{
    handNumber: number;
    board: NonNullable<GameState['board']>;
  } | null>;
};

export type LiveMatchViewModel = {
  inGame: boolean;
  isMyTurn: boolean;
  myHand: Tile[];
  opponentTileCount: number;
  boneyardCount: number;
  hasPlayMoves: boolean;
  canDrawNow: boolean;
  canPass: boolean;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  selectedTileHasLegalPlay: boolean;
  boardSelectedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  handSelectedTile: Tile | null;
};

export type DeriveLiveMatchViewModelInput = Omit<LiveMatchViewModelInput, 'frozenHandOverBoardRef'> & {
  frozenHandOverBoard: {
    handNumber: number;
    board: NonNullable<GameState['board']>;
  } | null;
};

export function deriveLiveMatchViewModel(input: DeriveLiveMatchViewModelInput): LiveMatchViewModel {
  const {
    state,
    legalMoves,
    you,
    isConnected,
    joinedRoom,
    canDraw,
    selectedTile,
    roomRecoveryState,
    isRecoveringConnection,
    pendingUiAction,
    opponentDragging,
    drawStepMyHand,
    drawStepOpponentHandCount,
    boneyardDisplayCount,
    frozenHandOverBoard,
  } = input;

  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const myHand = drawStepMyHand ?? state?.players[you]?.hand ?? [];
  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const authoritativeOpponentTileCount =
    state && opponentId ? (state.handCounts?.[opponentId] ?? 0) : 0;
  const opponentTileCount = drawStepOpponentHandCount ?? authoritativeOpponentTileCount;
  const hasPlayMoves = legalMoves.some((m) => m.type === 'play');
  const canDrawNow = canDraw && !hasPlayMoves;
  const canPass = legalMoves.some((m) => m.type === 'pass');
  const boneyardCount = boneyardDisplayCount ?? state?.boneyard.length ?? 0;
  const inGame = Boolean(isConnected && joinedRoom && state);

  const boardLegalMoves =
    isMyTurn &&
    roomRecoveryState === 'idle' &&
    !isRecoveringConnection &&
    pendingUiAction !== 'draw' &&
    pendingUiAction !== 'pass' &&
    pendingUiAction !== 'play'
      ? legalMoves
      : EMPTY_MOVES;

  const selectedTileHasLegalPlay = Boolean(
    selectedTile &&
      boardLegalMoves.some(
        (m) =>
          m.type === 'play' && m.tile && m.position && tileEquals(m.tile, selectedTile),
      ),
  );

  const boardSelectedTile = selectedTileHasLegalPlay ? selectedTile : null;
  const boardShowOpenEndGlow = Boolean(isMyTurn && opponentDragging);
  const handSelectedTile = selectedTileHasLegalPlay ? selectedTile : null;

  const rawBoard =
    state?.board ??
    (state?.handOver && frozenHandOverBoard?.handNumber === state.handNumber
      ? frozenHandOverBoard.board
      : null);
  const boardForDisplay = rawBoard ?? null;

  return {
    inGame,
    isMyTurn,
    myHand,
    opponentTileCount,
    boneyardCount,
    hasPlayMoves,
    canDrawNow,
    canPass,
    boardForDisplay,
    boardLegalMoves,
    selectedTileHasLegalPlay,
    boardSelectedTile,
    boardShowOpenEndGlow,
    handSelectedTile,
  };
}

export function useLiveMatchViewModel(input: LiveMatchViewModelInput): LiveMatchViewModel {
  const { frozenHandOverBoardRef, ...rest } = input;
  const frozenHandOverBoard = frozenHandOverBoardRef.current;

  const derived = useMemo(
    () => deriveLiveMatchViewModel({ ...rest, frozenHandOverBoard }),
    [
      rest.state,
      rest.legalMoves,
      rest.you,
      rest.isConnected,
      rest.joinedRoom,
      rest.canDraw,
      rest.selectedTile,
      rest.roomRecoveryState,
      rest.isRecoveringConnection,
      rest.pendingUiAction,
      rest.opponentDragging,
      rest.drawStepMyHand,
      rest.drawStepOpponentHandCount,
      rest.boneyardDisplayCount,
      frozenHandOverBoard,
      rest.state?.board,
      rest.state?.handOver,
      rest.state?.handNumber,
    ],
  );

  useEffect(() => {
    if (!input.state) {
      frozenHandOverBoardRef.current = null;
      return;
    }

    if (input.state.board) {
      frozenHandOverBoardRef.current = {
        handNumber: input.state.handNumber,
        board: input.state.board,
      };
      return;
    }

    if (!input.state.handOver) {
      frozenHandOverBoardRef.current = null;
    }
  }, [input.state, frozenHandOverBoardRef]);

  return derived;
}