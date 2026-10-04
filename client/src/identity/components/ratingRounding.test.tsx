// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlayerIdentityModel } from '../playerIdentityNormalization';
import type { PlayerIdentitySignal } from '../playerIdentityTypes';
import { PlayerCompetitiveSummary } from './PlayerCompetitiveSummary';
import { PlayerIdentityHighlights } from './PlayerIdentityHighlights';
import { PlayerMilestoneShelf } from './PlayerMilestoneShelf';

// Real Glicko ratings are fractional; the profile shows whole points.
describe('profile rating displays round fractional ratings', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rounds the rating and peak rating in How they play', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now() + 10_000), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const base = createEmptyPlayerIdentityModel(100);
    render(<PlayerCompetitiveSummary competitive={{ ...base.competitive, rating: 1779.968, peakRating: 1812.4 }} />);
    // Rating and peak animate independently; wait for both to land.
    await waitFor(() => {
      expect(screen.getByText('1,780')).toBeTruthy();
      expect(screen.getByText('1,812')).toBeTruthy();
    });
    expect(screen.queryByText(/1,779\.968/)).toBeNull();
  });

  it('rounds the at-peak highlight rating', () => {
    const signal: PlayerIdentitySignal = { id: 'test:peak', type: 'competitive_at_peak', domain: 'competitive', strength: 'signature', priority: 50, label: 'peak', evidence: 'At peak', value: null, sampleSize: null, visibility: 'public', details: { kind: 'rating', current: 1779.968, peak: 1779.968 } };
    render(<PlayerIdentityHighlights signals={[signal]} isCurrentUser={false} />);
    expect(screen.getByText('1,780 rating')).toBeTruthy();
  });

  it('rounds the peak rating record', () => {
    render(<PlayerMilestoneShelf milestones={[{ type: 'rating_peak', value: 1779.968, achieved: true }]} />);
    expect(screen.getByText('1,780')).toBeTruthy();
  });
});
