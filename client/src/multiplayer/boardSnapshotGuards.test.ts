// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { BoardState, GameState } from '../types';
import {
  isRenderableNonNullBoard,
  isRenderableMultiplayerSnapshot,
  projectMultiplayerGameState,
  projectRenderableBoard,
} from './boardSnapshotGuards';

function minimalPlacedTile(low: number, high: number) {
  return { tile: { low, high }, orientation: 'horizontal-normal' as const };
}

function minimalBoard(overrides: Partial<BoardState> = {}): BoardState {
  return {
    leftEnd: 3,
    rightEnd: 3,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    mainLine: [minimalPlacedTile(3, 3)],
    hubDoubles: [],
    ...overrides,
  };
}

function minimalGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 60 },
    playerIds: ['p1', 'p2'],
    players: {
      p1: { id: 'p1', hand: [], score: 0 },
      p2: { id: 'p2', hand: [], score: 0 },
    },
    board: minimalBoard(),
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 1,
    ...overrides,
  };
}

describe('projectRenderableBoard', () => {
  it('accepts a valid minimal board snapshot', () => {
    const projected = projectRenderableBoard(minimalBoard());
    expect(projected).not.toBeNull();
    expect(projected?.mainLine).toHaveLength(1);
    expect(projected?.hubDoubles).toEqual([]);
  });

  it('accepts an empty mainLine with valid shape', () => {
    const projected = projectRenderableBoard(minimalBoard({ mainLine: [] }));
    expect(projected).not.toBeNull();
    expect(projected?.mainLine).toEqual([]);
  });

  it('rejects null and non-object payloads', () => {
    expect(projectRenderableBoard(null)).toBeNull();
    expect(projectRenderableBoard(undefined)).toBeNull();
    expect(projectRenderableBoard('board')).toBeNull();
  });

  it('rejects boards missing mainLine', () => {
    expect(projectRenderableBoard({ hubDoubles: [] })).toBeNull();
  });

  it('rejects boards missing hubDoubles', () => {
    expect(
      projectRenderableBoard({
        mainLine: [minimalPlacedTile(1, 2)],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      }),
    ).toBeNull();
  });

  it('rejects malformed mainLine tiles missing orientation', () => {
    expect(
      projectRenderableBoard({
        mainLine: [{ tile: { low: 1, high: 2 } }],
        hubDoubles: [],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      }),
    ).toBeNull();
  });

  it('rejects mainLine entries with non-numeric pip values', () => {
    expect(
      projectRenderableBoard({
        mainLine: [{ tile: { low: 'x', high: 2 }, orientation: 'horizontal-normal' }],
        hubDoubles: [],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      }),
    ).toBeNull();
  });

  it('coerces hub branches and hydrates open ends', () => {
    const projected = projectRenderableBoard({
      mainLine: [minimalPlacedTile(5, 5)],
      leftEnd: 5,
      rightEnd: 5,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [
        {
          tileIndex: 0,
          hubValue: 5,
          isCrossed: false,
          branches: [
            { tiles: [minimalPlacedTile(5, 6)], openEnd: 6, openEndIsDouble: false },
            null,
          ],
        },
      ],
    });
    expect(projected).not.toBeNull();
    expect(projected?.hubDoubles[0]?.branches[0]?.tiles).toHaveLength(1);
  });

  it('drops empty branch arms during projection', () => {
    const projected = projectRenderableBoard({
      mainLine: [minimalPlacedTile(4, 4)],
      leftEnd: 4,
      rightEnd: 4,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [
        {
          tileIndex: 0,
          hubValue: 4,
          isCrossed: false,
          branches: [{ tiles: [] }, null],
        },
      ],
    });
    expect(projected?.hubDoubles[0]?.branches[0]).toBeNull();
  });
});

describe('isRenderableNonNullBoard', () => {
  it('returns true for a valid projected board', () => {
    expect(isRenderableNonNullBoard(minimalBoard())).toBe(true);
  });

  it('returns false for malformed payloads', () => {
    expect(isRenderableNonNullBoard({ mainLine: 'nope', hubDoubles: [] })).toBe(false);
  });
});

describe('projectMultiplayerGameState', () => {
  it('accepts a valid multiplayer snapshot', () => {
    const projected = projectMultiplayerGameState(minimalGameState());
    expect(projected).not.toBeNull();
    expect(projected?.board?.mainLine).toHaveLength(1);
  });

  it('accepts snapshots with explicit null board (pre-deal lobby)', () => {
    const projected = projectMultiplayerGameState(minimalGameState({ board: null }));
    expect(projected).toEqual(minimalGameState({ board: null }));
  });

  it('rejects null and non-object state', () => {
    expect(projectMultiplayerGameState(null as unknown as GameState)).toBeNull();
    expect(projectMultiplayerGameState(undefined as unknown as GameState)).toBeNull();
  });

  it('rejects snapshots missing playerIds', () => {
    const state = minimalGameState();
    (state as { playerIds?: string[] }).playerIds = undefined as unknown as string[];
    expect(projectMultiplayerGameState(state)).toBeNull();
  });

  it('rejects snapshots missing players map', () => {
    const state = minimalGameState();
    (state as { players?: GameState['players'] }).players = null as unknown as GameState['players'];
    expect(projectMultiplayerGameState(state)).toBeNull();
  });

  it('rejects snapshots without a board property', () => {
    const { board: _board, ...withoutBoard } = minimalGameState();
    expect(projectMultiplayerGameState(withoutBoard as GameState)).toBeNull();
  });

  it('rejects snapshots with undefined board', () => {
    const state = minimalGameState();
    (state as { board?: BoardState | null }).board = undefined;
    expect(projectMultiplayerGameState(state)).toBeNull();
  });

  it('rejects snapshots with malformed board payloads', () => {
    const state = minimalGameState({
      board: {
        mainLine: [{ tile: { low: 1, high: 2 } }],
        hubDoubles: [],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      } as unknown as BoardState,
    });
    expect(projectMultiplayerGameState(state)).toBeNull();
  });

  it('rejects snapshots when mainLine contains null placed tile entries', () => {
    const state = minimalGameState({
      board: {
        mainLine: [null as unknown as BoardState['mainLine'][0]],
        hubDoubles: [],
        leftEnd: 0,
        rightEnd: 0,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      },
    });
    expect(projectMultiplayerGameState(state)).toBeNull();
  });

  it('rejects regression payloads with non-array hubDoubles', () => {
    const state = minimalGameState({
      board: {
        mainLine: [minimalPlacedTile(1, 2)],
        hubDoubles: 'invalid' as unknown as BoardState['hubDoubles'],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
      },
    });
    expect(projectMultiplayerGameState(state)).toBeNull();
  });
});

describe('isRenderableMultiplayerSnapshot', () => {
  it('returns true for valid snapshots', () => {
    expect(isRenderableMultiplayerSnapshot(minimalGameState())).toBe(true);
  });

  it('returns true for null-board lobby snapshots', () => {
    expect(isRenderableMultiplayerSnapshot(minimalGameState({ board: null }))).toBe(true);
  });

  it('returns false for invalid board regression payloads', () => {
    expect(
      isRenderableMultiplayerSnapshot(
        minimalGameState({
          board: {
            mainLine: [],
            hubDoubles: 'invalid' as unknown as BoardState['hubDoubles'],
            leftEnd: 0,
            rightEnd: 0,
            leftEndIsDouble: false,
            rightEndIsDouble: false,
          },
        }),
      ),
    ).toBe(false);
  });
});