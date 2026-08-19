import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFixedBotHand } from '../match/runtime/botEngine.ts';
import { usePlayerNoMoveEffect } from './usePlayerNoMoveEffect.ts';

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
    const drawSequenceActiveRef = { current: false };
    let activeRun = false;
    const runDrawSequence = vi.fn(() => new Promise<never>(() => {}));
    const setDrawSequenceActiveBoth = vi.fn((value: boolean) => {
      drawSequenceActiveRef.current = value;
    });
    const stable = {
      userPlayMoves: [],
      ports: {
        appendGhostMove: vi.fn(), appendMove: vi.fn(), pushToast: vi.fn(),
        setIsOffAuthoredLine: vi.fn(), setLessonStepIndex: vi.fn(),
        setAuthoringV2Events: vi.fn(), setSelectedTile: vi.fn(),
        acceptGuidedTranscriptTurn: vi.fn(), captureGuidedMatchCandidateAction: vi.fn(),
        recordAuthoringStep: vi.fn(), createV2Event: vi.fn(), showBoardToast: vi.fn(),
      },
      guided: {
        currentTranscriptTurn: null, isGuidedTranscriptMode: false,
        isGuidedV2Mode: false, isGuidedV2OffLine: false, isGuidedMode: false,
        frozenLesson: null,
      },
      authoring: {
        isAuthoringMode: false, isAuthoringV2Mode: false,
        authoringV2NextEventIndexRef: { current: 0 },
      },
      ghost: { isGhostMode: false },
      isDailyFritzMode: true,
      fritzDifficulty: 'hard',
      moveCounterRef: { current: 0 },
      drawSequenceActiveRef,
      setDrawSequenceActiveBoth,
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
      runDrawSequence,
    };

    const { rerender } = renderHook(
      ({ liveMatch }) => usePlayerNoMoveEffect({ ...stable, match: liveMatch } as never),
      { initialProps: { liveMatch: match } },
    );

    await waitFor(() => expect(runDrawSequence).toHaveBeenCalledOnce());
    await act(async () => {
      // Reproduce the lifecycle/UI reset that used to reopen the effect while
      // the first draw still owned the authoritative local run.
      drawSequenceActiveRef.current = false;
      rerender({ liveMatch: { ...match } });
    });

    expect(stable.localRun.hasActiveLocalRun).toHaveBeenCalled();
    expect(runDrawSequence).toHaveBeenCalledOnce();
  });
});
