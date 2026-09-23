import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoricalGameReviewPortal } from './HistoricalGameReviewPortal';

describe('HistoricalGameReviewPortal Gate 4 access', () => {
  it('G: historical non-cohort access remains fail-closed', () => {
    const { container } = render(<HistoricalGameReviewPortal enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText(/Recent game reviews/i)).toBeNull();
  });
});
