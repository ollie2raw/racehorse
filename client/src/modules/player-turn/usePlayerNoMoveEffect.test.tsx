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
