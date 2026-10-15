// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BotGuidedMatchPanel } from './BotGuidedMatchPanel.tsx';
import { buildFiveFiveForcedDrawFixture } from '../modules/bot-turn/forcedDrawFixture.ts';

function panel(extra: Record<string, unknown>) {
  const match = buildFiveFiveForcedDrawFixture({ boneyardSize: 8 });
  const props = ({
        showLeaveConfirm: false,
        setShowLeaveConfirm: vi.fn(),
        showFritzCoachingPanel: false,
        lessonCoachPanelContent: null,
        lessonCoachProgressLabel: '',
        lessonCoachProgressPct: 0,
        showFullCoachTip: false,
        setShowFullCoachTip: vi.fn(),
        showLessonCoachPanel: false,
        showRecommendation: false,
        setShowRecommendation: vi.fn(),
        canPlayCoachedMove: false,
        lessonCoachVm: null,
        playLessonBestMove: vi.fn(),
        guidedFritzAnchorRef: createRef(),
        setScoreTrackOpen: vi.fn(),
        opponentLabel: 'Fritz',
        match,
        botTurn: true,
        turnLabel: 'Fritz is drawing…',
        openEndsSum: 10,
        guidedBoneyardAnchorRef: createRef(),
        boardStage: null,
        handTray: null,
        ...extra,
      } as unknown) as React.ComponentProps<typeof BotGuidedMatchPanel>;
  return render(<BotGuidedMatchPanel {...props} />);
}

describe('BotGuidedMatchPanel opponent/boneyard counts', () => {
  it('shows the presented counts while a draw sequence is being shown', () => {
    const { container } = panel({ fritzTileCount: 9, boneyardCount: 4 });
    expect(container.querySelector('.learn-guided-summary-tiles')?.textContent).toBe('9 tiles');
    expect(container.querySelector('.learn-guided-summary-tiles')?.getAttribute('aria-label')).toBe('Fritz has 9 tiles remaining');
    expect(container.textContent).toContain('4');
  });

  it('falls back to the authoritative counts when nothing is being presented', () => {
    const { container } = panel({});
    expect(container.querySelector('.learn-guided-summary-tiles')?.textContent).toBe('7 tiles');
  });
});
