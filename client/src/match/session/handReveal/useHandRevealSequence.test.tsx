// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandRevealSequence, type UseHandRevealSequenceParams } from './useHandRevealSequence';
import type { GameState } from '../../../types';

const YOU = 'p1';
const OPP = 'p2';

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
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: false,
    handOver: true,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 1,
    ...overrides,
  } as GameState;
}

describe('useHandRevealSequence — the 1400ms reveal survives a state echo', () => {
  let setHandReveal: ReturnType<typeof vi.fn>;

  const params = (state: GameState): UseHandRevealSequenceParams => ({
    socket: null,
    joinedRoom: 'ROOM123',
    you: YOU,
    state,
    handReveal: null,
    setHandReveal: setHandReveal as any,
    preGameDraw: null,
    inGame: true,
    handRevealShownRef: sharedShownRef,
    handRevealTimerRef: sharedTimerRef,
    showToast: vi.fn(),
  });

  let sharedShownRef: { current: number | null };
  let sharedTimerRef: { current: ReturnType<typeof setTimeout> | null };

  beforeEach(() => {
    setHandReveal = vi.fn();
    sharedShownRef = { current: null };
    sharedTimerRef = { current: null };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The reveal is deferred 1400ms. The effect depends on the raw `state` object
   * and returned clearTimeout as its cleanup, while handRevealShownRef was set
   * before the timer was armed. So any `state` echo inside that 1400ms window
   * cancelled the pending reveal, and the re-run saw the guard already set for
   * this handNumber and early-returned without arming a replacement — the
   * hand-over reveal never appeared.
   */
  it('still fires the reveal when a state echo lands inside the 1400ms window', () => {
    const first = makeState({ handNumber: 3, sequence: 10 });
    const { rerender } = renderHook(({ state }) => useHandRevealSequence(params(state)), {
      initialProps: { state: first },
    });

    // Authoritative echo of the same hand-over state, well inside the window.
    vi.advanceTimersByTime(100);
    rerender({ state: makeState({ handNumber: 3, sequence: 11 }) });

    vi.advanceTimersByTime(2000);

    expect(setHandReveal).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire across several echoes of the same hand', () => {
    const base = (sequence: number) => makeState({ handNumber: 4, sequence });
    const { rerender } = renderHook(({ state }) => useHandRevealSequence(params(state)), {
      initialProps: { state: base(20) },
    });

    vi.advanceTimersByTime(200);
    rerender({ state: base(21) });
    vi.advanceTimersByTime(200);
    rerender({ state: base(22) });
    vi.advanceTimersByTime(3000);

    expect(setHandReveal).toHaveBeenCalledTimes(1);
  });
});
