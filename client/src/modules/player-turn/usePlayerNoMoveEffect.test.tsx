import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFixedBotHand } from '../match/runtime/botEngine.ts';
import { usePlayerNoMoveEffect } from './usePlayerNoMoveEffect.ts';

function makeStablePorts(overrides: Record<string, unknown> = {}) {
  const drawSequenceActiveRef = { current: false };
  let activeRun = false;
  return {
    userPlayMoves: [] as unknown[],
    ports: {
      appendGhostMove: vi.fn(),
      appendMove: vi.fn(),
      pushToast: vi.fn(),
      setIsOffAuthoredLine: vi.fn(),
      setLessonStepIndex: vi.fn(),
      setAuthoringV2Events: vi.fn(),
      setSelectedTile: vi.fn(),
      acceptGuidedTranscriptTurn: vi.fn(),
      captureGuidedMatchCandidateAction: vi.fn(),
      recordAuthoringStep: vi.fn(),
      createV2Event: vi.fn(),
      showBoardToast: vi.fn(),
    },
    guided: {
      currentTranscriptTurn: null,
      isGuidedTranscriptMode: false,
      isGuidedV2Mode: false,
      isGuidedV2OffLine: false,
      isGuidedMode: false,
      frozenLesson: null,
    },
    authoring: {
      isAuthoringMode: false,
      isAuthoringV2Mode: false,
      authoringV2NextEventIndexRef: { current: 0 },
    },
    ghost: { isGhostMode: false },
    isDailyFritzMode: true,
    fritzDifficulty: 'hard',
    moveCounterRef: { current: 0 },
    drawSequenceActiveRef,
    setDrawSequenceActiveBoth: vi.fn((value: boolean) => {
      drawSequenceActiveRef.current = value;
    }),
    isTransitioningRef: { current: false },
    localRun: {
      beginLocalRun: vi.fn(() => {
        activeRun = true;
        return { id: 1, lifecycleVersion: 0, kind: 'player-draw' as const };
      }),
      isLocalRunCurrent: vi.fn(() => activeRun),
      hasActiveLocalRun: vi.fn(() => activeRun),
      finishLocalRun: vi.fn(() => { activeRun = false; }),
    },
    applyAndNotify: vi.fn(),
    runDrawSequence: vi.fn(() => new Promise<never>(() => {})),
    ...overrides,
  };
}

describe('usePlayerNoMoveEffect local-run ownership', () => {
  it('does not start a second forced draw when the UI draw flag resets during the in-flight run', async () => {
    const match = createFixedBotHand(
      { you: 18, bot: 20 },
      3,
      60,
      7,
      {
        player_tiles: [
          { low: 2, high: 6 }, { low: 0, high: 1 }, { low: 3, high: 4 },
          { low: 1, high: 5 }, { low: 1, high: 2 }, { low: 3, high: 6 },
          { low: 1, high: 3 },
        ],
        fritz_tiles: [{ low: 2, high: 3 }],
        boneyard: [{ low: 5, high: 5 }, { low: 0, high: 2 }, { low: 0, high: 0 }],
        locked: [{ low: 0, high: 0 }],
      },
      'you',
    );
    const stable = makeStablePorts();
    const { rerender } = renderHook(
      ({ liveMatch }) => usePlayerNoMoveEffect({ ...stable, match: liveMatch } as never),
      { initialProps: { liveMatch: match } },
    );

    await waitFor(() => expect(stable.runDrawSequence).toHaveBeenCalledOnce());
    await act(async () => {
      stable.drawSequenceActiveRef.current = false;
      rerender({ liveMatch: { ...match } });
    });

    expect(stable.localRun.hasActiveLocalRun).toHaveBeenCalled();
    expect(stable.runDrawSequence).toHaveBeenCalledOnce();
  });

  it('does not re-draw after a journalled play whose applyMove already absorbed recovery draws', async () => {
    const match = createFixedBotHand(
      { you: 0, bot: 0 },
      1,
      60,
      7,
      {
        player_tiles: [
          { low: 2, high: 6 },
          { low: 0, high: 6 },
          { low: 0, high: 0 },
        ],
        fritz_tiles: [{ low: 0, high: 1 }],
        boneyard: [
          { low: 2, high: 2 },
          { low: 1, high: 6 },
        ],
        locked: [],
      },
      'you',
    );
    // Mid-presentation race shape: journal already recorded the play, but the
    // UI temporarily restored a drawable boneyard with no legal moves.
    const midPresentation = {
      ...match,
      board: {
        mainLine: [{ tile: { low: 1, high: 5 }, orientation: 'horizontal-normal' as const }],
        leftEnd: 5,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      handOpen: true,
      currentPlayer: 'you' as const,
      officialJournal: {
        handNumber: match.handNumber,
        actions: [
          {
            actor: 'player' as const,
            kind: 'play' as const,
            tile: { low: 1, high: 5 },
            position: 'right' as const,
          },
        ],
      },
    };
    expect(midPresentation.boneyard.length).toBeGreaterThan(midPresentation.deadTiles.length);

    const runDrawSequence = vi.fn();
    const stable = makeStablePorts({
      runDrawSequence,
      localRun: {
        beginLocalRun: vi.fn(),
        isLocalRunCurrent: vi.fn(() => true),
        hasActiveLocalRun: vi.fn(() => false),
        finishLocalRun: vi.fn(),
      },
    });

    renderHook(() => usePlayerNoMoveEffect({ ...stable, match: midPresentation } as never));
    await act(async () => {
      await Promise.resolve();
    });
    expect(runDrawSequence).not.toHaveBeenCalled();
  });
});

describe('usePlayerNoMoveEffect Ghost mode draw logging (RT-2, HARDENING_PLAN §9.3)', () => {
  it('logs one GhostMoveLogEntry per real draw in a multi-draw turn, each with its own hand_before and drawn_tile — not one entry for the whole sequence', async () => {
    const baseMatch = createFixedBotHand(
      { you: 0, bot: 0 },
      1,
      60,
      7,
      {
        player_tiles: [{ low: 1, high: 2 }, { low: 2, high: 2 }],
        fritz_tiles: [{ low: 0, high: 1 }],
        boneyard: [{ low: 0, high: 4 }, { low: 3, high: 6 }],
        locked: [],
      },
      'you',
    );

    // Two real draws before a legal play: 0|4 first, then 3|6.
    const afterDraw1 = {
      ...baseMatch,
      boneyard: [{ low: 3, high: 6 }],
      players: {
        ...baseMatch.players,
        you: { ...baseMatch.players.you, hand: [...baseMatch.players.you.hand, { low: 0, high: 4 }] },
      },
    };
    const afterDraw2 = {
      ...afterDraw1,
      boneyard: [],
      players: {
        ...afterDraw1.players,
        you: { ...afterDraw1.players.you, hand: [...afterDraw1.players.you.hand, { low: 3, high: 6 }] },
      },
    };

    const runDrawSequence = vi.fn(async (_liveMatch, _player, _token, onStep) => {
      onStep({
        actionKind: 'draw',
        beforeState: baseMatch,
        result: { state: afterDraw1, drew: { player: 'you', tile: { low: 0, high: 4 } } },
      });
      onStep({
        actionKind: 'draw',
        beforeState: afterDraw1,
        result: { state: afterDraw2, drew: { player: 'you', tile: { low: 3, high: 6 } } },
      });
      return { state: afterDraw2, drew: { player: 'you', tile: { low: 3, high: 6 } } };
    });

    const stable = makeStablePorts({
      runDrawSequence,
      ghost: { isGhostMode: true },
      localRun: {
        beginLocalRun: vi.fn(() => ({ id: 1, lifecycleVersion: 0, kind: 'player-draw' as const })),
        isLocalRunCurrent: vi.fn(() => true),
        hasActiveLocalRun: vi.fn(() => false),
        finishLocalRun: vi.fn(),
      },
    });

    renderHook(() => usePlayerNoMoveEffect({ ...stable, match: baseMatch } as never));
    await waitFor(() => expect(runDrawSequence).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
    });

    const ghostDrawCalls = stable.ports.appendGhostMove.mock.calls
      .map(([entry]) => entry)
      .filter((entry: { branch: string | null }) => entry.branch === 'draw');

    // The bug this fixes: exactly ONE entry would have been logged here
    // (standing in for both real draws, using the pre-sequence snapshot).
    expect(ghostDrawCalls).toHaveLength(2);
    expect(ghostDrawCalls[0]).toMatchObject({
      hand_before: expect.arrayContaining(['1|2', '2|2']),
      drawn_tile: '0|4',
    });
    expect(ghostDrawCalls[1]).toMatchObject({
      hand_before: expect.arrayContaining(['1|2', '2|2', '0|4']),
      drawn_tile: '3|6',
    });
    // The two entries must NOT share the same hand_before — that collapse
    // (both using the stale pre-sequence snapshot) is exactly the bug.
    expect(ghostDrawCalls[0].hand_before).not.toEqual(ghostDrawCalls[1].hand_before);
  });
});
