import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../types.ts';
import type { MatchHistoryScrubberState } from '../../modules/replay/index.ts';
import { resolveHistoryScrubberView } from './resolveHistoryScrubberView.ts';

const liveBoard = { leftEnd: 3, rightEnd: 4 } as unknown as BoardState;
const historyBoard = { leftEnd: 1, rightEnd: 2 } as unknown as BoardState;

function scrubber(over: Partial<MatchHistoryScrubberState> = {}): MatchHistoryScrubberState {
  return {
    viewingHistory: false,
    viewingIndex: null,
    historyBoard: null,
    position: 0,
    total: 0,
    viewedHandNumber: null,
    movesBehindLive: 0,
    canStepBack: false,
    canStepForward: false,
    stepBack: () => {},
    stepForward: () => {},
    jumpTo: () => {},
    backToLive: () => {},
    ...over,
  };
}

function input(over: Partial<Parameters<typeof resolveHistoryScrubberView>[0]> = {}) {
  return {
    scrubber: scrubber(),
    liveBoard,
    isGuidedMode: false,
    isAuthoringMode: false,
    isAuthoringV2Mode: false,
    isGuidedV2Mode: false,
    isJourneyTrial: false,
    isLessonLayoutMode: false,
    preGameDrawActive: false,
    gameOver: false,
    ...over,
  };
}

describe('resolveHistoryScrubberView', () => {
  it('is enabled for a plain solo match in play', () => {
    const view = resolveHistoryScrubberView(input());
    expect(view.enabled).toBe(true);
    expect(view.viewingHistory).toBe(false);
    expect(view.displayBoard).toBe(liveBoard);
  });

  it.each([
    'isGuidedMode',
    'isAuthoringMode',
    'isAuthoringV2Mode',
    'isGuidedV2Mode',
    'isJourneyTrial',
    'isLessonLayoutMode',
    'preGameDrawActive',
    'gameOver',
  ] as const)('is disabled when %s', (flag) => {
    const view = resolveHistoryScrubberView(input({ [flag]: true }));
    expect(view.enabled).toBe(false);
    expect(view.viewingHistory).toBe(false);
    expect(view.displayBoard).toBe(liveBoard);
  });

  it('swaps to the historical board while viewing when enabled', () => {
    const view = resolveHistoryScrubberView(
      input({ scrubber: scrubber({ viewingHistory: true, historyBoard, viewingIndex: 2 }) }),
    );
    expect(view.viewingHistory).toBe(true);
    expect(view.displayBoard).toBe(historyBoard);
  });

  it('ignores the cursor when the scrubber is disabled (guided lesson mid-scroll)', () => {
    const view = resolveHistoryScrubberView(
      input({
        isGuidedMode: true,
        scrubber: scrubber({ viewingHistory: true, historyBoard, viewingIndex: 2 }),
      }),
    );
    expect(view.viewingHistory).toBe(false);
    expect(view.displayBoard).toBe(liveBoard);
  });
});
