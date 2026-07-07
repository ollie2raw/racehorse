import { describe, it, expect } from 'vitest';
import type { GameState, Move, Tile } from '../../../types';
import { deriveLiveMatchViewModel } from './useLiveMatchViewModel';

const YOU = 'player-you';
const OPP = 'player-opp';
const ROOM = 'ABCD';

const sampleBoard: NonNullable<GameState['board']> = {
  mainLine: [],
  leftEnd: 3,
  rightEnd: 5,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const frozenBoard: NonNullable<GameState['board']> = {
  mainLine: [{ tile: { low: 2, high: 4 }, orientation: 'horizontal-normal' }],
  leftEnd: 2,
  rightEnd: 4,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [{ low: 1, high: 2 }, { low: 3, high: 5 }], score: 0 },
      [OPP]: { id: OPP, hand: [], score: 0 },
    },
    handCounts: { [YOU]: 2, [OPP]: 4 },
    board: sampleBoard,
    boneyard: [{ low: 0, high: 1 }, { low: 2, high: 3 }],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 7,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof deriveLiveMatchViewModel>[0]> = {},
) {
  return {
    state: null,
    legalMoves: [] as Move[],
    you: YOU,
    isConnected: false,
    joinedRoom: null,
    canDraw: false,
    selectedTile: null as Tile | null,
    roomRecoveryState: 'idle' as const,
    isRecoveringConnection: false,
    pendingUiAction: null,
    opponentDragging: false,
    drawStepMyHand: null,
    drawStepOpponentHandCount: null,
    boneyardDisplayCount: null,
    frozenHandOverBoard: null,
    ...overrides,
  };
}

describe('deriveLiveMatchViewModel', () => {
  it('returns idle defaults for null / disconnected state', () => {
    const vm = deriveLiveMatchViewModel(baseInput());

    expect(vm.inGame).toBe(false);
    expect(vm.isMyTurn).toBe(false);
    expect(vm.myHand).toEqual([]);
    expect(vm.opponentTileCount).toBe(0);
    expect(vm.boneyardCount).toBe(0);
    expect(vm.hasPlayMoves).toBe(false);
    expect(vm.canDrawNow).toBe(false);
    expect(vm.canPass).toBe(false);
    expect(vm.boardForDisplay).toBeNull();
    expect(vm.boardLegalMoves).toEqual([]);
    expect(vm.selectedTileHasLegalPlay).toBe(false);
    expect(vm.boardSelectedTile).toBeNull();
    expect(vm.boardShowOpenEndGlow).toBe(false);
    expect(vm.handSelectedTile).toBeNull();
  });

  it('derives mid-game turn, hand, and legal board moves when it is your turn', () => {
    const state = makeState();
    const legalMoves: Move[] = [
      { type: 'play', tile: { low: 1, high: 2 }, position: 'left' },
      { type: 'pass' },
    ];
    const selectedTile: Tile = { low: 1, high: 2 };

    const vm = deriveLiveMatchViewModel(
      baseInput({
        state,
        legalMoves,
        isConnected: true,
        joinedRoom: ROOM,
        canDraw: true,
        selectedTile,
      }),
    );

    expect(vm.inGame).toBe(true);
    expect(vm.isMyTurn).toBe(true);
    expect(vm.myHand).toEqual(state.players[YOU].hand);
    expect(vm.opponentTileCount).toBe(4);
    expect(vm.boneyardCount).toBe(2);
    expect(vm.hasPlayMoves).toBe(true);
    expect(vm.canDrawNow).toBe(false);
    expect(vm.canPass).toBe(true);
    expect(vm.boardForDisplay).toEqual(sampleBoard);
    expect(vm.boardLegalMoves).toEqual(legalMoves);
    expect(vm.selectedTileHasLegalPlay).toBe(true);
    expect(vm.boardSelectedTile).toEqual(selectedTile);
    expect(vm.handSelectedTile).toEqual(selectedTile);
  });

  it('hides board selection when the selected tile has no legal play', () => {
    const state = makeState({ currentPlayerIndex: 0 });
    const legalMoves: Move[] = [
      { type: 'play', tile: { low: 3, high: 5 }, position: 'right' },
    ];
    const selectedTile: Tile = { low: 1, high: 2 };

    const vm = deriveLiveMatchViewModel(
      baseInput({
        state,
        legalMoves,
        isConnected: true,
        joinedRoom: ROOM,
        selectedTile,
      }),
    );

    expect(vm.selectedTileHasLegalPlay).toBe(false);
    expect(vm.boardSelectedTile).toBeNull();
    expect(vm.handSelectedTile).toBeNull();
    expect(vm.boardLegalMoves).toEqual(legalMoves);
  });

  it('uses frozen board snapshot when hand is over and live board is cleared', () => {
    const state = makeState({
      board: null,
      handOver: true,
      handNumber: 2,
    });

    const vm = deriveLiveMatchViewModel(
      baseInput({
        state,
        isConnected: true,
        joinedRoom: ROOM,
        frozenHandOverBoard: { handNumber: 2, board: frozenBoard },
      }),
    );

    expect(vm.boardForDisplay).toEqual(frozenBoard);
  });

  it('shows open-end glow when opponent is dragging on your turn', () => {
    const state = makeState();

    const vm = deriveLiveMatchViewModel(
      baseInput({
        state,
        isConnected: true,
        joinedRoom: ROOM,
        opponentDragging: true,
      }),
    );

    expect(vm.isMyTurn).toBe(true);
    expect(vm.boardShowOpenEndGlow).toBe(true);
  });

  it('suppresses board legal moves while a gameplay action is pending', () => {
    const state = makeState();
    const legalMoves: Move[] = [
      { type: 'play', tile: { low: 1, high: 2 }, position: 'left' },
    ];

    const vm = deriveLiveMatchViewModel(
      baseInput({
        state,
        legalMoves,
        isConnected: true,
        joinedRoom: ROOM,
        pendingUiAction: 'draw',
      }),
    );

    expect(vm.boardLegalMoves).toEqual([]);
  });
});