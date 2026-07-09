import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMultiplayerPresentation } from './useMultiplayerPresentation';
import type { GameState, Tile } from '../types';
import type { RoomPlayer } from './protocol';

const YOU = 'player-you';
const OPP = 'player-opp';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [], score: 0 },
      [OPP]: { id: OPP, hand: [], score: 0 },
    },
    board: {
      mainLine: [],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 1, // OPP turn
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

describe('useMultiplayerPresentation passed toast logic', () => {
  let showScoreLikeToast: any;
  let showScoreToast: any;
  let setFlyingTiles: any;

  beforeEach(() => {
    showScoreLikeToast = vi.fn();
    showScoreToast = vi.fn();
    setFlyingTiles = vi.fn();
  });

  const baseParams = {
    you: YOU,
    isMutedRef: { current: true } as any,
    opponentName: 'OpponentName',
    players: [
      { id: YOU, username: 'You', userId: '1' },
      { id: OPP, username: 'OpponentName', userId: '2' },
    ] as RoomPlayer[],
    myHand: [] as Tile[],
    opponentTileCount: 0,
    drawSequenceActive: false,
    boneyardCount: 0,
    showScoreLikeToast: (...args: any[]) => showScoreLikeToast(...args),
    showScoreToast: (...args: any[]) => showScoreToast(...args),
    setFlyingTiles: (...args: any[]) => setFlyingTiles(...args),
    boneyardRef: { current: null } as any,
    handAreaRef: { current: null } as any,
    opponentPillRef: { current: null } as any,
  };

  it('does NOT trigger passed toast on transition when recentAutoPasses is empty (prevents false positive heuristic)', () => {
    // Initial state where it was OPP turn
    const state1 = makeState({ currentPlayerIndex: 1, sequence: 1 });
    const { rerender } = renderHook(
      ({ state, recentAutoPasses }) =>
        useMultiplayerPresentation({
          ...baseParams,
          state,
          recentAutoPasses,
        }),
      {
        initialProps: { state: state1, recentAutoPasses: [] as string[] },
      },
    );

    // Transition to state2: turn switched to YOU, board count and hand length unchanged.
    // The old heuristic would have matched: currentPlayerIndex changed AND hand length same AND board count same.
    // However, recentAutoPasses is empty.
    const state2 = makeState({ currentPlayerIndex: 0, sequence: 2 });
    rerender({ state: state2, recentAutoPasses: [] });

    expect(showScoreLikeToast).not.toHaveBeenCalledWith('OpponentName passed', 'opp');
  });

  it('triggers passed toast on transition when opponent is in recentAutoPasses', () => {
    const state1 = makeState({ currentPlayerIndex: 1, sequence: 1 });
    const { rerender } = renderHook(
      ({ state, recentAutoPasses }) =>
        useMultiplayerPresentation({
          ...baseParams,
          state,
          recentAutoPasses,
        }),
      {
        initialProps: { state: state1, recentAutoPasses: [] as string[] },
      },
    );

    // Transition to state2: turn switched, and opponent (OPP) is marked as auto-passed.
    const state2 = makeState({ currentPlayerIndex: 0, sequence: 2 });
    rerender({ state: state2, recentAutoPasses: [OPP] });

    expect(showScoreLikeToast).toHaveBeenCalledWith('OpponentName passed', 'opp');
  });

  it('does NOT trigger passed toast when opponent plays a double/move keeping board count flat and hand length simulated as flat (prevents false positive)', () => {
    // Initial state: opponent turn, hand count = 2, board has a double hub.
    const state1 = makeState({
      currentPlayerIndex: 1,
      sequence: 1,
      players: {
        [YOU]: { id: YOU, hand: [], score: 0 },
        [OPP]: { id: OPP, hand: [{ low: 2, high: 2 }, { low: 3, high: 4 }], score: 0 },
      },
      board: {
        mainLine: [{ tile: { low: 5, high: 5 }, orientation: 'horizontal-normal' }],
        leftEnd: 5,
        rightEnd: 5,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
    });

    const { rerender } = renderHook(
      ({ state, recentAutoPasses }) =>
        useMultiplayerPresentation({
          ...baseParams,
          state,
          recentAutoPasses,
        }),
      {
        initialProps: { state: state1, recentAutoPasses: [] as string[] },
      },
    );

    // Transition to state2: turn switched to YOU, board count remains flat (simulating a double play or flat count condition),
    // and hand length of OPP is simulated as flat (e.g. 2 tiles) to test the robustness of the new signal-based pass logic.
    // recentAutoPasses is empty.
    const state2 = makeState({
      currentPlayerIndex: 0,
      sequence: 2,
      players: {
        [YOU]: { id: YOU, hand: [], score: 0 },
        [OPP]: { id: OPP, hand: [{ low: 3, high: 4 }, { low: 6, high: 6 }], score: 0 }, // Hand length still 2
      },
      board: {
        mainLine: [{ tile: { low: 5, high: 5 }, orientation: 'horizontal-normal' }],
        leftEnd: 5,
        rightEnd: 5,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [], // flat board count
      },
    });

    rerender({ state: state2, recentAutoPasses: [] });

    expect(showScoreLikeToast).not.toHaveBeenCalledWith('OpponentName passed', 'opp');
  });
});
