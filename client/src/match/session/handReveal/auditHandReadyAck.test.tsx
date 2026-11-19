// @vitest-environment jsdom
/**
 * AUDIT 2026-11-17 (docs/audit-parts/B-multiplayer.md, finding B1). Tests-only: documents CURRENT behaviour, no fix.
 *
 * useHandRevealSequence dispatches readySettled { ok: true } for ANY resolved hand:ready ack (useHandRevealSequence.ts:191-195),
 * including the server's { ok:false, uncertain:true } ("Hand update couldn't be saved — try again.") and
 * { ok:false, error:'new_hand_blocked' }. The ack is then recorded as acknowledged on this connection, so the recovery path
 * never resends it while the connection lasts. Server side (server/src/multiplayer/auditHandBoundaryStrand.test.ts) such a
 * room is left hand-over with both seats ready and nothing scheduled: it waits for a reconnect.
 *
 * These assertions pin the bug. When it is fixed, flip them (expect a resend after a failed ack).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHandRevealSequence, type UseHandRevealSequenceParams } from './useHandRevealSequence';
import type { GameState } from '../../../types';

const { emitHandReady } = vi.hoisted(() => ({ emitHandReady: vi.fn() }));
vi.mock('../../../multiplayer/roomTransport', () => ({ emitHandReady }));

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: ['p1', 'p2'],
    players: { p1: { id: 'p1', hand: [], score: 0 }, p2: { id: 'p2', hand: [], score: 0 } },
    board: { mainLine: [], leftEnd: 3, rightEnd: 5, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: false,
    handOver: true,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 1,
    ...overrides,
  } as GameState;
}

const reveal = (handNumber: number) => ({
  handNumber,
  yourRemainingTiles: [],
  opponentRemainingTiles: [],
  pointsAwarded: { you: 0, opponent: 0 },
});

describe.each([
  ['uncertain (hand-start write could not be proven durable)', { ok: false, uncertain: true, error: "Hand update couldn't be saved — try again." }],
  ['new_hand_blocked (room degraded/failed)', { ok: false, error: 'new_hand_blocked' }],
])('AUDIT B1: a failed hand:ready ack is treated as acknowledged (%s)', (_label, failedAck) => {
  const live = { connected: true, id: 'conn-a' };
  let shownRef: { current: number | null };
  let timerRef: { current: ReturnType<typeof setTimeout> | null };
  const showToast = vi.fn();
  const params = (state: GameState, handReveal: UseHandRevealSequenceParams['handReveal']): UseHandRevealSequenceParams => ({
    socket: live as never,
    joinedRoom: 'ROOM123',
    you: 'p1',
    state,
    handReveal,
    setHandReveal: vi.fn() as never,
    preGameDraw: null,
    inGame: true,
    handRevealShownRef: shownRef,
    handRevealTimerRef: timerRef,
    showToast,
  });

  beforeEach(() => {
    emitHandReady.mockReset();
    emitHandReady.mockResolvedValue(failedAck);
    showToast.mockReset();
    shownRef = { current: null };
    timerRef = { current: null };
    live.connected = true;
    live.id = 'conn-a';
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('CURRENT BEHAVIOUR (bug): never resent on the same connection, no warning shown', async () => {
    const state = makeState();
    const { rerender } = renderHook(({ handReveal, s }) => useHandRevealSequence(params(s, handReveal)), {
      initialProps: { handReveal: null as UseHandRevealSequenceParams['handReveal'], s: state },
    });
    vi.advanceTimersByTime(1500);
    rerender({ handReveal: reveal(2), s: state });
    vi.advanceTimersByTime(4100); // auto-continue: hand:ready sent
    await act(async () => { await Promise.resolve(); }); // the failed ack resolves
    rerender({ handReveal: null, s: state });
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(10_000);
      rerender({ handReveal: null, s: makeState({ sequence: 1 + i }) }); // state echoes, same hand still over
      await act(async () => { await Promise.resolve(); });
    }
    expect(emitHandReady).toHaveBeenCalledTimes(1); // the bug: the hand is stuck until a reconnect
    expect(showToast).not.toHaveBeenCalled();

    // Only a new connection makes it resend.
    live.id = 'conn-b';
    rerender({ handReveal: null, s: makeState({ sequence: 99 }) });
    expect(emitHandReady).toHaveBeenCalledTimes(2);
  });
});
