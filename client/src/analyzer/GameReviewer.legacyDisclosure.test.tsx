// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';

describe('GameReviewer legacy analysis disclosure', () => {
  it('visibly labels a persisted pre-Batch-0 review as a low-confidence heuristic', () => {
    const legacyPersistedAnalysis = {
      ...analyzeMoveLog([]),
      evidence: undefined,
    };

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={legacyPersistedAnalysis}
      />,
    );

    expect(
      screen.getByText('Legacy heuristic estimate · low confidence'),
    ).toBeVisible();
  });
});
