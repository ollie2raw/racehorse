// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FRITZ_ROOKIE_ID, FRITZ_STANDARD_ID } from '../bot/fritzConfig';
import {
  buildStatsSummary,
  dedupeOnlineMatchRows,
  deriveFritzSummary,
  formatWeekLabel,
  getWeekStart,
  hasModeActivity,
  isGhostRatingEligible,
  summarizeRecentForm,
} from './statsDerivations';

describe('dedupeOnlineMatchRows', () => {
  it('collapses duplicate room results', () => {
    const rows = [
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        mode: 'online',
        room_code: 'ROOM1',
        winner_score: 60,
        loser_score: 40,
        created_at: '2026-01-01T12:00:00Z',
      },
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        mode: 'online',
        room_code: 'ROOM1',
        winner_score: 60,
        loser_score: 40,
        created_at: '2026-01-01T12:00:05Z',
      },
    ];
    expect(dedupeOnlineMatchRows(rows)).toHaveLength(1);
  });
});

describe('buildStatsSummary', () => {
  it('computes win rate and streaks for online matches', () => {
    const summary = buildStatsSummary('user-1', [
      {
        winner_user_id: 'user-1',
        loser_user_id: 'user-2',
        mode: 'online',
        created_at: '2026-01-01T10:00:00Z',
      },
      {
        winner_user_id: 'user-1',
        loser_user_id: 'user-3',
        mode: 'online',
        created_at: '2026-01-02T10:00:00Z',
      },
      {
        winner_user_id: 'user-4',
        loser_user_id: 'user-1',
        mode: 'online',
        created_at: '2026-01-03T10:00:00Z',
      },
    ]);

    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(66.7);
    expect(summary.longestWinStreak).toBe(2);
    expect(summary.currentWinStreak).toBe(0);
  });
});

describe('deriveFritzSummary', () => {
  it('tracks tier records and weekly deltas', () => {
    const weekStart = getWeekStart(new Date('2026-07-05T12:00:00'));
    const summary = deriveFritzSummary(
      [
        {
          played_at: '2026-07-05T10:00:00Z',
          opponent_id: FRITZ_ROOKIE_ID,
          player_score: 60,
          opponent_score: 40,
          delta: 12,
        },
        {
          played_at: '2026-06-01T10:00:00Z',
          opponent_id: FRITZ_STANDARD_ID,
          player_score: 30,
          opponent_score: 60,
          delta: -8,
        },
      ],
      weekStart,
    );

    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.gamesThisWeek).toBe(1);
    expect(summary.ratingChangeThisWeek).toBe(12);
    expect(summary.tierRecords.rookie.wins).toBe(1);
    expect(summary.tierRecords.standard.losses).toBe(1);
  });
});

describe('isGhostRatingEligible', () => {
  it('requires a meaningful final score', () => {
    expect(isGhostRatingEligible(10, 5)).toBe(true);
    expect(isGhostRatingEligible(4, 3)).toBe(false);
  });
});

describe('formatWeekLabel', () => {
  it('renders a Monday-through-Sunday label', () => {
    const weekStart = getWeekStart(new Date('2026-07-05T12:00:00'));
    expect(formatWeekLabel(weekStart)).toMatch(/^Week of /);
  });
});
describe('summarizeRecentForm', () => {
  it('counts the run and labels it by its length', () => {
    const form = ['win', 'win', 'loss', 'win', 'win'] as const;
    expect(summarizeRecentForm([...form])).toEqual({
      wins: 4,
      losses: 1,
      label: '4W – 1L last 5',
    });
  });

  it('returns null for a player with no recent games, rather than a 0W – 0L badge', () => {
    expect(summarizeRecentForm([])).toBeNull();
  });

  it('caps the run at ten, keeping the most recent', () => {
    // The model can hand back more than the strip shows; the label has to
    // describe the games actually drawn, or it contradicts the squares.
    const twelve = [
      ...Array<'loss'>(2).fill('loss'),
      ...Array<'win'>(10).fill('win'),
    ];
    expect(summarizeRecentForm(twelve)).toEqual({ wins: 10, losses: 0, label: '10W – 0L last 10' });
  });

  it('reads oldest-first, so the newest game is the last square', () => {
    expect(summarizeRecentForm(['loss', 'win'])).toEqual({
      wins: 1,
      losses: 1,
      label: '1W – 1L last 2',
    });
  });
});

describe('hasModeActivity', () => {
  it('is false when every count is zero or missing', () => {
    expect(hasModeActivity([0, null, 0])).toBe(false);
    expect(hasModeActivity([null, null])).toBe(false);
  });

  it('is true as soon as one count is above zero', () => {
    expect(hasModeActivity([0, null, 3])).toBe(true);
  });

  it('treats a negative value as activity, not emptiness', () => {
    // A negative rating delta still means games were played.
    expect(hasModeActivity([-12])).toBe(true);
  });
});
