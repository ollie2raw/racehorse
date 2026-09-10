// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardState, Move, PlacementPosition, Tile } from '../../types.ts';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { makeGuidedTurn, makeGuidedTranscript, makeLessonV2, makeLessonV2Event } from './guidedTestFixtures.ts';
import {
  useGuidedPlacementHandlers,
  type GuidedPlacementHandlerDeps,
} from './guidedPlacementHandlers.ts';

// `buildBotMatchStateFromV2Event` (via the V2-match path) reads the board parser
// off the lazy registry; the guided V2 state tests stub it the same way.
const { parseLessonV2BoardState } = vi.hoisted(() => ({
  parseLessonV2BoardState: vi.fn<(boardAfter: string) => BoardState | null>(() => null),
}));
vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', () => ({ parseLessonV2BoardState }));
vi.mock('../../utils/sound.ts', () => ({
  queueSound: vi.fn((fn: () => void) => fn()),
  playScoreSound: vi.fn(),
  playTileSound: vi.fn(),
}));

const tile = (low: number, high: number): Tile => ({ low, high });
const playMove = (t: Tile, position?: PlacementPosition): Move => ({ type: 'play', tile: t, position });

/**
 * The hook takes a 76-field deps bag; `handleGuidedPlacement` and its two inline
 * helpers only read ~15 of them. Everything else is a spy / inert value.
 */
function makeDeps(overrides: Partial<GuidedPlacementHandlerDeps> = {}): GuidedPlacementHandlerDeps {
  const match = createBotMatch();
  const fn = () => vi.fn();
  return {
    isGuidedTranscriptMode: false,
    guidedTranscript: null,
    currentTranscriptTurn: null,
    pushToast: fn(),
    setIsOffAuthoredLine: fn(),
    setSelectedTile: fn(),
    flashLastPlayed: fn(),
    setMatch: fn(),
    setGuidedV1Replay: fn(),
    setLessonStepIndex: fn(),
    isGuidedV2Mode: false,
    frozenV2Lesson: null,
    isGuidedV2OffLine: false,
    guidedV2EventIndex: 0,
    setIsGuidedV2OffLine: fn(),
    setGuidedV2EventIndex: fn(),
    matchRef: { current: match },
    opponentLabel: 'Fritz',
    showScoreToast: fn(),
    showBoardToast: fn(),
    isMuted: true,
    scheduleHandReveal: fn(),
    match,
    guidedCoachTip: null,
    userPlayMoves: [],
    coach: { recordPlayerMove: vi.fn() } as unknown as GuidedPlacementHandlerDeps['coach'],
    isAuthoringMode: false,
    recordAuthoringStep: fn(),
    applyAndNotify: fn(),
    appendMove: fn(),
    setMovesUsed: fn(),
    fritzDifficulty: 'standard' as GuidedPlacementHandlerDeps['fritzDifficulty'],
    canPlayCoachedMove: false,
    currentExpectedV2PlayerEvent: null,
    frozenLesson: null,
    currentLessonStep: null,
    isTransitioningRef: { current: false },
    ...overrides,
  };
}

function handler(deps: GuidedPlacementHandlerDeps) {
  return renderHook(() => useGuidedPlacementHandlers(deps)).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  parseLessonV2BoardState.mockReturnValue(null);
});

describe('handleGuidedPlacement — transcript mode', () => {
  const transcriptDeps = (turn: GuidedPlacementHandlerDeps['currentTranscriptTurn']) =>
    makeDeps({
      isGuidedTranscriptMode: true,
      guidedTranscript: makeGuidedTranscript(),
      currentTranscriptTurn: turn,
    });

  it('rejects a placement when there is no current transcript turn', () => {
    const deps = transcriptDeps(null);
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('handled');
    expect(deps.setIsOffAuthoredLine).toHaveBeenCalledWith(true);
    expect(deps.pushToast).toHaveBeenCalledWith('This transcript turn does not accept a tile placement.');
  });

  it('rejects a placement when the turn does not expect a play', () => {
    const deps = transcriptDeps(makeGuidedTurn({ expectedPlayerMove: { type: 'pass' } }));
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('handled');
    expect(deps.setIsOffAuthoredLine).toHaveBeenCalledWith(true);
  });

  it('stops playback when the clicked move is off the authored line', () => {
    const deps = transcriptDeps(
      makeGuidedTurn({ expectedPlayerMove: { type: 'play', tile: '3|4', position: 'left' } }),
    );
    const result = handler(deps).handleGuidedPlacement(playMove(tile(5, 5), 'left'), 'left');
    expect(result).toBe('handled');
    expect(deps.setIsOffAuthoredLine).toHaveBeenCalledWith(true);
    expect(deps.pushToast).toHaveBeenCalledWith('Off lesson line. Guided playback stopped.');
    expect(deps.setMatch).not.toHaveBeenCalled();
  });

  it('accepts the turn when the clicked move matches tile + position', () => {
    const deps = transcriptDeps(
      makeGuidedTurn({
        expectedPlayerMove: { type: 'play', tile: '3|4', position: 'left' },
        playerStateAfter: '{"handNumber":2}',
        fritzReplies: [],
      }),
    );
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('handled');
    expect(deps.setIsOffAuthoredLine).not.toHaveBeenCalledWith(true);
    expect(deps.setMatch).toHaveBeenCalledWith({ handNumber: 2 });
    expect(deps.setLessonStepIndex).toHaveBeenCalled();
  });

  it('a position-agnostic expected move matches on the tile alone', () => {
    const deps = transcriptDeps(
      makeGuidedTurn({
        expectedPlayerMove: { type: 'play', tile: '3|4' },
        playerStateAfter: '{"handNumber":1}',
      }),
    );
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4)), 'left');
    expect(result).toBe('handled');
    expect(deps.setMatch).toHaveBeenCalled();
  });
});

describe('handleGuidedPlacement — guided V2 mode', () => {
  const v2Deps = (overrides: Partial<GuidedPlacementHandlerDeps> = {}) =>
    makeDeps({
      isGuidedV2Mode: true,
      frozenV2Lesson: makeLessonV2({
        events: [makeLessonV2Event({ tile: '3|4', position: 'left' })],
      }),
      guidedV2EventIndex: 0,
      ...overrides,
    });

  it('applies the expected V2 event when tile + position match', () => {
    const deps = v2Deps();
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('handled');
    expect(deps.setGuidedV2EventIndex).toHaveBeenCalled();
    expect(deps.setMatch).toHaveBeenCalled();
    expect(deps.setIsGuidedV2OffLine).not.toHaveBeenCalled();
  });

  it('goes off-line and continues live when the tile does not match', () => {
    const deps = v2Deps();
    const result = handler(deps).handleGuidedPlacement(playMove(tile(5, 5), 'left'), 'left');
    expect(result).toBe('continue');
    expect(deps.setIsGuidedV2OffLine).toHaveBeenCalledWith(true);
    expect(deps.pushToast).toHaveBeenCalledWith('You went off the lesson. Continuing live from here.');
    expect(deps.setMatch).not.toHaveBeenCalled();
  });

  it('goes off-line when the tile matches but the position does not', () => {
    const deps = v2Deps();
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'right'), 'right');
    expect(result).toBe('continue');
    expect(deps.setIsGuidedV2OffLine).toHaveBeenCalledWith(true);
  });

  it('a V2 event with no position matches on the tile alone', () => {
    const deps = v2Deps({
      frozenV2Lesson: makeLessonV2({ events: [makeLessonV2Event({ tile: '3|4', position: undefined })] }),
    });
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'right'), 'right');
    expect(result).toBe('handled');
  });

  it('does nothing special once already off-line — falls through to live', () => {
    const deps = v2Deps({ isGuidedV2OffLine: true });
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('continue');
    expect(deps.setGuidedV2EventIndex).not.toHaveBeenCalled();
    expect(deps.setIsGuidedV2OffLine).not.toHaveBeenCalled();
    expect(deps.pushToast).not.toHaveBeenCalled();
  });
});

describe('handleGuidedPlacement — neither mode', () => {
  it('returns "continue" and touches nothing', () => {
    const deps = makeDeps();
    const result = handler(deps).handleGuidedPlacement(playMove(tile(3, 4), 'left'), 'left');
    expect(result).toBe('continue');
    expect(deps.setMatch).not.toHaveBeenCalled();
    expect(deps.pushToast).not.toHaveBeenCalled();
    expect(deps.setIsOffAuthoredLine).not.toHaveBeenCalled();
  });
});
