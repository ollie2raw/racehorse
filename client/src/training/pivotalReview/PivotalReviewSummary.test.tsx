// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PivotalReviewSummary } from './PivotalReviewSummary';
import type { PivotalReviewSession } from './pivotalReviewStorage';

vi.mock('./HandTimeline', () => ({ HandTimeline: () => null }));

const session: PivotalReviewSession = {
  id: 'current', mode: 'bot', createdAt: Date.now(), accuracy: 80,
  youScore: 60, opponentScore: 40, pivotalMoveNumbers: [1],
  reflections: [{ moveNumber: 1, rank: 1, note: 'Consider the other branch.' }],
};
const props = {
  open: true, session, candidates: [], hands: [], worstHandNumber: null,
  opponentLabel: 'Fritz', onSaveAndClose: vi.fn(), onSelectHand: vi.fn(),
};
const key = 'racehorse_pivotal_review_sessions_v1';

beforeEach(() => window.localStorage.clear());

describe('pivotal summary reflection compatibility', () => {
  it('renders note-only reflections without a recurring-pattern block', () => {
    render(<PivotalReviewSummary {...props} />);
    expect(screen.getByText('Turn 1 — pivotal moment')).toBeInTheDocument();
    expect(screen.queryByLabelText('Recurring miss pattern')).not.toBeInTheDocument();
  });

  it('reads mixed historical and note-only sessions without mutating stored data', () => {
    const historical = { ...session, id: 'old', reflections: [{ moveNumber: 2, rank: 1, note: '', missReasons: ['missed_scoring_line'] }] };
    const stored = JSON.stringify([historical, session]);
    window.localStorage.setItem(key, stored);
    render(<PivotalReviewSummary {...props} />);
    expect(screen.getByLabelText('Recurring miss pattern')).toHaveTextContent("Didn't see scoring line");
    expect(screen.getByLabelText('Recurring miss pattern')).toHaveTextContent('(1×)');
    expect(window.localStorage.getItem(key)).toBe(stored);
  });

  it('still formats old reflections containing taxonomy reasons', () => {
    render(<PivotalReviewSummary {...props} session={{ ...session, reflections: [{ moveNumber: 1, rank: 1, note: '', missReasons: ['missed_scoring_line'] }] }} />);
    expect(screen.getByText("Turn 1 — pivotal moment (Didn't see scoring line)")).toBeInTheDocument();
  });
});
