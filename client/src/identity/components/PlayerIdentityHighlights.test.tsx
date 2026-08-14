// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerIdentityHighlights } from './PlayerIdentityHighlights';
import { selectNonDuplicateMilestones } from './PlayerMilestoneShelf';
import type { PlayerIdentityMilestone, PlayerIdentitySignal, PlayerIdentitySignalDetails, PlayerIdentitySignalType } from '../playerIdentityTypes';

function makeSignal(type: PlayerIdentitySignalType, details: PlayerIdentitySignalDetails, visibility: 'public' | 'self_only' = 'public'): PlayerIdentitySignal {
  return { id: `test:${type}`, type, domain: type.startsWith('fritz') ? 'fritz' : type.startsWith('puzzle') ? 'puzzle' : type.startsWith('learning') ? 'learning' : type.startsWith('rivalry') ? 'rivalry' : 'competitive', strength: type === 'competitive_at_peak' || type === 'fritz_best_record' ? 'signature' : 'supporting', priority: 50, label: type === 'rivalry_viewer_head_to_head' ? 'Your record vs Maya' : type, evidence: 'Authoritative evidence', value: null, sampleSize: null, visibility, details };
}

const allSignals: PlayerIdentitySignal[] = [
  makeSignal('competitive_at_peak', { kind: 'rating', current: 2247, peak: 2247 }),
  makeSignal('competitive_ranked_games', { kind: 'count', count: 184 }),
  makeSignal('competitive_best_streak', { kind: 'streak', games: 8 }),
  makeSignal('competitive_current_streak', { kind: 'streak', games: 3 }),
  makeSignal('competitive_recent_form', { kind: 'form', wins: 4, losses: 1, games: 5 }),
  makeSignal('fritz_most_played_difficulty', { kind: 'record', wins: 79, losses: 75, games: 154, difficulty: 'Master' }),
  makeSignal('fritz_best_record', { kind: 'record', wins: 19, losses: 7, games: 26, difficulty: 'Elite' }),
  makeSignal('fritz_all_difficulties', { kind: 'count', count: 4 }),
  makeSignal('fritz_overall_record', { kind: 'record', wins: 101, losses: 83, games: 184 }),
  makeSignal('fritz_average_score', { kind: 'score', score: 88, scope: 'average' }),
  makeSignal('fritz_best_score', { kind: 'score', score: 101, scope: 'all_time' }),
  makeSignal('puzzle_completions', { kind: 'count', count: 12 }),
  makeSignal('puzzle_current_streak', { kind: 'streak', games: 4 }),
  makeSignal('puzzle_best_today', { kind: 'score', score: 72, scope: 'today' }),
  makeSignal('puzzle_best_ever', { kind: 'score', score: 95, scope: 'all_time' }),
  makeSignal('puzzle_perfect_days', { kind: 'count', count: 3 }),
  makeSignal('learning_journey_progress', { kind: 'journey', completed: 18, total: 25 }, 'self_only'),
  makeSignal('learning_active_chapter', { kind: 'chapter', title: 'The Fritz Trail' }, 'self_only'),
  makeSignal('rivalry_viewer_head_to_head', { kind: 'record', wins: 4, losses: 6, games: 10 }),
  makeSignal('rivalry_most_played', { kind: 'rival', userId: 'u9', username: 'hafnerjan', games: 28 }, 'self_only'),
];

describe('PlayerIdentityHighlights', () => {
  it('omits an empty section and renders no interactive cards', () => {
    const { container } = render(<PlayerIdentityHighlights signals={[]} isCurrentUser />);
    expect(container.firstChild).toBeNull();
  });

  it('renders no more than five supplied signals with factual evidence', () => {
    render(<PlayerIdentityHighlights signals={allSignals} isCurrentUser />);
    expect(screen.getByRole('heading', { name: 'Player highlights', level: 2 })).toBeTruthy();
    expect(document.querySelectorAll('.identity-highlight')).toHaveLength(5);
    expect(screen.getByText('2,247 rating')).toBeTruthy();
    expect(screen.queryByText(/signature|notable|supporting/i)).toBeNull();
    expect(document.querySelectorAll('[role="button"]').length).toBe(0);
  });

  it('renders every current signal type through typed details', () => {
    for (const signal of allSignals) {
      const { container } = render(<PlayerIdentityHighlights signals={[signal]} isCurrentUser />);
      expect(container.querySelector('.identity-highlight')).toBeTruthy();
      cleanup();
    }
  });

  it('uses neutral public peak copy and defensively hides self-only signals', () => {
    render(<PlayerIdentityHighlights signals={[allSignals[0], allSignals[16], allSignals[19]]} isCurrentUser={false} />);
    expect(screen.getByText('AT PEAK RATING')).toBeTruthy();
    expect(screen.queryByText('AT YOUR PEAK')).toBeNull();
    expect(screen.queryByText('JOURNEY PROGRESS')).toBeNull();
    expect(screen.queryByText('MOST-PLAYED RIVAL')).toBeNull();
  });

  it('preserves viewer-relative H2H wording and long evidence safely', () => {
    const h2h = makeSignal('rivalry_viewer_head_to_head', { kind: 'record', wins: 4, losses: 6, games: 10 });
    const longRival = makeSignal('rivalry_most_played', { kind: 'rival', userId: 'u9', username: 'a-very-long-player-name-that-must-wrap-safely', games: 28 });
    render(<PlayerIdentityHighlights signals={[h2h, longRival]} isCurrentUser />);
    expect(screen.getByText('YOUR RECORD VS MAYA')).toBeTruthy();
    expect(screen.getByText('4W–6L')).toBeTruthy();
    expect(screen.getByText('a-very-long-player-name-that-must-wrap-safely')).toBeTruthy();
  });

  it('filters milestone duplicates by typed concepts only', () => {
    const milestones: PlayerIdentityMilestone[] = [
      { type: 'rating_peak', value: 2247, achieved: true },
      { type: 'best_streak', value: 8, achieved: true },
      { type: 'ranked_games', value: 184, achieved: true },
      { type: 'puzzle_best', value: 95, achieved: true },
      { type: 'journey_progress', completed: 18, total: 25, achieved: false },
    ];
    const remaining = selectNonDuplicateMilestones(allSignals, milestones);
    expect(remaining).toEqual([]);
    expect(selectNonDuplicateMilestones([allSignals[0]], milestones)).toEqual(milestones.slice(1));
  });
});
