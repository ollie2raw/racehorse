// @vitest-environment jsdom
/**
 * Command admission while Fritz's committed turn is still being presented.
 *
 * The engine already names the human (embedded chain ended with Fritz's pass), so the ONLY thing
 * keeping a placement from being submitted is the shared draw lock. These tests drive the real
 * placement handler (the single command-submission path for tile/side/double placement — there
 * are no draw/pass buttons, drag/drop or keyboard shortcuts in Fritz modes) and prove it fails
 * closed on the lock, and that the tile-click selection path does too.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyPlayMove, getLegalMoves, passTurn, type BotMatchState } from '../match/runtime/botEngine.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import { buildEmbeddedChainFixture, POOL_TILES } from '../bot-turn/embeddedChainFixture.ts';
import { usePlayerPlacementHandler } from './usePlayerPlacementHandler.ts';

const P = (a: number, b: number) =>
  POOL_TILES.find((t) => t.low === Math.min(a, b) && t.high === Math.max(a, b))!;

/** Human to move right after Fritz's embedded chain + pass, holding a playable 5-5. */
function humanTurnAfterEmbeddedChain(): BotMatchState {
  const start = buildEmbeddedChainFixture({
    fritzPool: [P(0, 2), P(0, 3)],
    boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
    humanHoldsFive: true,
  });
  const play = asPlayMoves(getLegalMoves(start, 'bot')).find((m) => m.position === 'right')!;
  const after = applyPlayMove(start, 'bot', play).state;
  expect(after.currentPlayer).toBe('you'); // engine resolved Fritz's whole turn atomically
  return after;
}

function setup(lockHeld: boolean) {
  const match = humanTurnAfterEmbeddedChain();
  const userPlayMoves = asPlayMoves(getLegalMoves(match, 'you'));
  expect(userPlayMoves.length).toBeGreaterThan(0);
  const selectedTile = userPlayMoves[0]!.tile ?? null;
  const position = userPlayMoves[0]!.position!;
  const applyAndNotify = vi.fn();
  const setMatch = vi.fn();
  const appendMove = vi.fn();
  const ports = new Proxy({ appendMove }, {
    get: (target, key) => (key in target ? (target as never)[key] : vi.fn()),
  });
  const drawSequenceActiveRef = { current: lockHeld };
  const { result } = renderHook(() =>
    usePlayerPlacementHandler({
      match,
      selectedTile,
      userPlayMoves,
      ports: ports as never,
      guided: { currentLessonStep: null, lessonStepIndex: 0, isOffAuthoredLine: false } as never,
      authoring: { isAuthoringMode: false, isAuthoringV2Mode: false, authoringNoteText: '', authoringV2NextEventIndexRef: { current: 0 } } as never,
      ghost: { isGhostMode: false, ghostSuggestedPlayerMove: null } as never,
      isDailyFritzMode: false,
      fritzDifficulty: 'casual',
      moveCounterRef: { current: 1 },
      drawSequenceActiveRef,
      setMatch,
      onDrawVisualStep: vi.fn(),
      triggerDrawStepAnimation: vi.fn(),
      setDrawSequenceActiveBoth: vi.fn(),
      drawStepMs: 0,
      isMuted: true,
      applyAndNotify,
    }),
  );
  return { onPositionClick: result.current, position, applyAndNotify, setMatch, appendMove };
}

describe('placement command admission during a held Fritz presentation', () => {
  it('rejects the placement while the presentation lock is held — nothing submitted, nothing logged', () => {
    const { onPositionClick, position, applyAndNotify, setMatch, appendMove } = setup(true);
    onPositionClick(position);
    expect(applyAndNotify).not.toHaveBeenCalled();
    expect(setMatch).not.toHaveBeenCalled();
    expect(appendMove).not.toHaveBeenCalled();
  });

  it('control: the identical placement is admitted once the lock is released', () => {
    const { onPositionClick, position, applyAndNotify } = setup(false);
    onPositionClick(position);
    expect(applyAndNotify).toHaveBeenCalledTimes(1);
  });
});

describe('engine control for the fixture', () => {
  it('the human really is blocked after the chain when they hold no 5', () => {
    const start = buildEmbeddedChainFixture({
      fritzPool: [P(0, 2), P(0, 3)],
      boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
    });
    const play = asPlayMoves(getLegalMoves(start, 'bot')).find((m) => m.position === 'right')!;
    const after = applyPlayMove(start, 'bot', play).state;
    expect(asPlayMoves(getLegalMoves(after, 'you'))).toHaveLength(0);
    expect(passTurn(after, 'you').handEnded?.reason).toBe('blocked');
  });
});
