// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandRevealSequence, type UseHandRevealSequenceParams } from './useHandRevealSequence';
import type { GameState } from '../../../types';

const { emitHandReady } = vi.hoisted(() => ({ emitHandReady: vi.fn() }));
vi.mock('../../../multiplayer/roomTransport', () => ({ emitHandReady }));

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

/**
 * Tournament report (2026-11-06): "Fritz starts the next hand while I still see the end-of-hand modal." The server deals the next hand as soon
 * as every seat has signalled ready (Fritz does 800 ms after the hand ends; at least 2.5 s after the hand ended). A live hand end arrives as
 * state:update (handOver) first and hand:ended after, so the first render has handOver, no reveal and no record of having shown one: the
 * "recover a lost hand:ready" effect read that as a lost signal and sent hand:ready at once, before the player had seen anything. The reveal then
 * opens 1.4 s later and stays up for 4 s, across the next deal and Fritz's opening move.
 */
describe('useHandRevealSequence — the player is ready when they have seen the hand end, not before', () => {
  const socket = { connected: true } as never;
  let shownRef: { current: number | null };
  let timerRef: { current: ReturnType<typeof setTimeout> | null };

  const params = (state: GameState, handReveal: UseHandRevealSequenceParams['handReveal'] = null): UseHandRevealSequenceParams => ({
    socket,
    joinedRoom: 'ROOM123',
    you: YOU,
    state,
    handReveal,
    setHandReveal: vi.fn() as never,
    preGameDraw: null,
    inGame: true,
    handRevealShownRef: shownRef,
    handRevealTimerRef: timerRef,
    showToast: vi.fn(),
  });
  const reveal = (handNumber: number) => ({
    handNumber,
    yourRemainingTiles: [],
    opponentRemainingTiles: [],
    pointsAwarded: { you: 0, opponent: 0 },
  });

  beforeEach(() => {
    emitHandReady.mockReset();
    emitHandReady.mockResolvedValue({ ok: true });
    shownRef = { current: null };
    timerRef = { current: null };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send hand:ready on the first render of a live hand end, before the reveal has opened', () => {
    renderHook(() => useHandRevealSequence(params(makeState({ handNumber: 2 }))));

    vi.advanceTimersByTime(1000);

    expect(emitHandReady).not.toHaveBeenCalled();
  });

  it('sends hand:ready once, when the reveal is continued, with that hand\'s number', () => {
    const state = makeState({ handNumber: 2 });
    const { rerender } = renderHook(({ handReveal }) => useHandRevealSequence(params(state, handReveal)), {
      initialProps: { handReveal: null as UseHandRevealSequenceParams['handReveal'] },
    });
    vi.advanceTimersByTime(1500); // the 1400 ms delay: the reveal opens
    rerender({ handReveal: reveal(2) });

    vi.advanceTimersByTime(4100); // its 4 s auto-progress

    expect(emitHandReady).toHaveBeenCalledTimes(1);
    expect(emitHandReady).toHaveBeenCalledWith(socket, 'ROOM123', 2);
  });

  it('does not send a second hand:ready when the reveal closes', () => {
    const state = makeState({ handNumber: 2 });
    const { rerender } = renderHook(({ handReveal }) => useHandRevealSequence(params(state, handReveal)), {
      initialProps: { handReveal: null as UseHandRevealSequenceParams['handReveal'] },
    });
    vi.advanceTimersByTime(1500);
    rerender({ handReveal: reveal(2) });
    vi.advanceTimersByTime(4100);
    rerender({ handReveal: null });
    vi.advanceTimersByTime(1000);

    expect(emitHandReady).toHaveBeenCalledTimes(1);
  });

  it('re-signals once when the reveal was shown and then cleared without a signal (a reconnect clears the modal)', () => {
    const state = makeState({ handNumber: 2 });
    shownRef.current = 2; // the reveal was armed and shown for this hand
    const { rerender } = renderHook(({ tick }) => useHandRevealSequence(params(state)) && tick, { initialProps: { tick: 0 } });

    rerender({ tick: 1 });
    rerender({ tick: 2 });

    expect(emitHandReady).toHaveBeenCalledTimes(1);
    expect(emitHandReady).toHaveBeenCalledWith(socket, 'ROOM123', 2);
  });

  it('does not re-signal while the reveal is still waiting to open', () => {
    const state = makeState({ handNumber: 2 });
    shownRef.current = 2;
    timerRef.current = setTimeout(() => undefined, 1400); // armed, not fired

    renderHook(() => useHandRevealSequence(params(state)));

    expect(emitHandReady).not.toHaveBeenCalled();
  });

  it('closes a reveal that belongs to an earlier hand once a later hand is in play, without signalling anything', () => {
    const setHandReveal = vi.fn();
    const next = makeState({ handNumber: 3, handOver: false });
    renderHook(() => useHandRevealSequence({ ...params(next, reveal(2)), setHandReveal: setHandReveal as never }));

    expect(setHandReveal).toHaveBeenCalledWith(null);
    expect(emitHandReady).not.toHaveBeenCalled();
  });

  it('keeps the reveal for the hand that is still over', () => {
    const setHandReveal = vi.fn();
    renderHook(() => useHandRevealSequence({ ...params(makeState({ handNumber: 2, handOver: true }), reveal(2)), setHandReveal: setHandReveal as never }));

    expect(setHandReveal).not.toHaveBeenCalledWith(null);
  });

  it('a fresh mount straight into a hand-over state (a reload) shows the reveal first and signals from it', () => {
    const state = makeState({ handNumber: 5 });
    const setHandReveal = vi.fn();
    const { rerender } = renderHook(({ handReveal }) => useHandRevealSequence({ ...params(state, handReveal), setHandReveal: setHandReveal as never }), {
      initialProps: { handReveal: null as UseHandRevealSequenceParams['handReveal'] },
    });
    expect(emitHandReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(setHandReveal).toHaveBeenCalledTimes(1);
    rerender({ handReveal: reveal(5) });
    vi.advanceTimersByTime(4100);

    expect(emitHandReady).toHaveBeenCalledTimes(1);
    expect(emitHandReady).toHaveBeenCalledWith(socket, 'ROOM123', 5);
  });
});
