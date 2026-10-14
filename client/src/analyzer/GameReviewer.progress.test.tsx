// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import GameReviewer from './GameReviewer';
it('uses the same decision population for completed and total work', () => {
  render(<GameReviewer open onClose={vi.fn()} analysis={null} decisionIdByMoveNumber={new Map([[1, 'd1']])} reviewWorkerBatch={{ resultsByDecisionId: new Map(Array.from({ length: 57 }, (_, n) => [`d${n}`, {} as never])), errorsByDecisionId: new Map([['error', 'failed']]), pendingDecisionIds: new Set(['pending-1', 'pending-2']), done: false }} />);
  expect(screen.getByText('Analyzing 57 / 60 decisions')).toBeTruthy();
});
