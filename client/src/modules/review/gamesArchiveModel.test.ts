import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  TREND_MAX_POINTS,
  attachSavedReviews,
  computeAccuracyTrend,
  computeArchiveStats,
  filterGames,
  formatAccuracy,
  gameResult,
  mergeArchiveGames,
  tiersPresent,
  titleCase,
} from './gamesArchiveModel.ts';
import type { SavedGameSummary } from './savedGames.ts';

let counter = 0;
function game(overrides: Partial<SavedGameSummary> = {}): SavedGameSummary {
  counter += 1;
  return {
    sourceMatchId: `g${counter}`,
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    result: { you: 61, opponent: 40, winner: 'you' },
    moveCount: 80,
    verification: 'replay_verified',
    playedAt: null,
    savedAt: '2026-11-01T00:00:00.000Z',
    review: null,
    ...overrides,
  };
}
const loss = (overrides: Partial<SavedGameSummary> = {}) => game({ result: { you: 30, opponent: 60, winner: 'opponent' }, ...overrides });
const review = (accuracy: number | null, grade: string | null = null) => ({ id: `r${counter}`, accuracy, grade });

describe('computeArchiveStats', () => {
  it('counts games, wins, losses and the win rate over decided games', () => {
    const stats = computeArchiveStats([game(), game(), loss(), game({ result: { you: 0, opponent: 0, winner: null } })]);
    expect(stats).toMatchObject({ games: 4, wins: 2, losses: 1, winRate: 67 });
  });

  it('has no win rate when nothing was decided, and no average when nothing has an accuracy', () => {
    expect(computeArchiveStats([])).toEqual({ games: 0, wins: 0, losses: 0, winRate: null, reviewed: 0, averageAccuracy: null });
    expect(computeArchiveStats([game({ review: review(null) })])).toMatchObject({ reviewed: 1, averageAccuracy: null });
  });

  it('averages only the accuracies that exist, to one decimal', () => {
    const stats = computeArchiveStats([
      game({ review: review(90) }),
      game({ review: review(81.25) }),
      game({ review: review(null) }),
      game(),
    ]);
    expect(stats.reviewed).toBe(3);
    expect(stats.averageAccuracy).toBe(85.6);
  });

  it('never counts a non-finite accuracy', () => {
    expect(computeArchiveStats([game({ review: review(Number.NaN) })]).averageAccuracy).toBeNull();
  });
});

describe('filterGames', () => {
  const games = [game({ fritzTier: 'rookie' }), loss({ fritzTier: 'master' }), game({ fritzTier: 'master' }), loss({ fritzTier: 'elite' })];

  it('keeps everything with no filters', () => {
    expect(filterGames(games, NO_FILTERS)).toHaveLength(4);
  });

  it('filters by result', () => {
    expect(filterGames(games, { result: 'wins', tier: 'all' }).map(gameResult)).toEqual(['win', 'win']);
    expect(filterGames(games, { result: 'losses', tier: 'all' }).map(gameResult)).toEqual(['loss', 'loss']);
  });

  it('filters by tier, and combines with result', () => {
    expect(filterGames(games, { result: 'all', tier: 'master' })).toHaveLength(2);
    expect(filterGames(games, { result: 'losses', tier: 'master' })).toHaveLength(1);
    expect(filterGames(games, { result: 'wins', tier: 'elite' })).toHaveLength(0);
  });

  it('does not treat an undecided game as a win or a loss', () => {
    const draw = game({ result: { you: 0, opponent: 0, winner: null } });
    expect(filterGames([draw], { result: 'wins', tier: 'all' })).toHaveLength(0);
    expect(filterGames([draw], { result: 'losses', tier: 'all' })).toHaveLength(0);
    expect(filterGames([draw], NO_FILTERS)).toHaveLength(1);
  });
});

describe('tiersPresent', () => {
  it('lists only the tiers that appear, weakest first, then unknown ones alphabetically', () => {
    const games = [game({ fritzTier: 'master' }), game({ fritzTier: 'rookie' }), game({ fritzTier: 'zeta' }), game({ fritzTier: 'master' }), game({ fritzTier: null }), game({ fritzTier: 'alpha' })];
    expect(tiersPresent(games)).toEqual(['rookie', 'master', 'alpha', 'zeta']);
  });
});

describe('formatting', () => {
  it('formats accuracy to one decimal and hides a missing one', () => {
    expect(formatAccuracy(91.234)).toBe('91.2%');
    expect(formatAccuracy(90)).toBe('90%');
    expect(formatAccuracy(null)).toBeNull();
    expect(formatAccuracy(Number.NaN)).toBeNull();
  });

  it('title-cases a tier, with Fritz as the fallback', () => {
    expect(titleCase('elite')).toBe('Elite');
    expect(titleCase(null)).toBe('Fritz');
  });
});

describe('computeAccuracyTrend', () => {
  /** A reviewed game on day `n` of November with this accuracy. */
  const on = (n: number, accuracy: number | null, overrides: Partial<SavedGameSummary> = {}) => game({
    playedAt: `2026-11-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    review: accuracy === null ? null : { id: `r${n}`, accuracy, grade: null },
    ...overrides,
  });

  it('plots reviewed games oldest to newest, whatever order they arrive in', () => {
    const { points } = computeAccuracyTrend([on(3, 70), on(1, 50), on(2, 60)]);
    expect(points.map((p) => p.accuracy)).toEqual([50, 60, 70]);
  });

  it('leaves unreviewed games and non-numeric accuracies out instead of plotting zero', () => {
    const { points } = computeAccuracyTrend([on(1, 80), on(2, null), on(3, Number.NaN), on(4, 90)]);
    expect(points.map((p) => p.accuracy)).toEqual([80, 90]);
  });

  it('falls back to the saved time when a game has no played time, and survives an unparseable date', () => {
    const { points } = computeAccuracyTrend([
      on(2, 60),
      on(1, 50, { playedAt: null, savedAt: '2026-11-01T00:00:00.000Z' }),
      on(3, 70, { playedAt: 'not a date' }),
    ]);
    expect(points.map((p) => p.accuracy)).toEqual([70, 50, 60]);
  });

  it('keeps the most recent games when there are more than the chart can show', () => {
    const many = Array.from({ length: TREND_MAX_POINTS + 7 }, (_, i) => on((i % 28) + 1, i, { sourceMatchId: `m${i}`, playedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
    const { points } = computeAccuracyTrend(many);
    expect(points).toHaveLength(TREND_MAX_POINTS);
    expect(points[points.length - 1]!.accuracy).toBe(TREND_MAX_POINTS + 6);
  });

  it('claims no average with fewer than five games, no change with fewer than ten', () => {
    expect(computeAccuracyTrend([on(1, 80), on(2, 90)])).toMatchObject({ recentAverage: null, change: null });
    const five = [1, 2, 3, 4, 5].map((n) => on(n, 80));
    expect(computeAccuracyTrend(five)).toMatchObject({ recentAverage: 80, change: null });
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => on(n, 80));
    expect(computeAccuracyTrend(nine).change).toBeNull();
  });

  it('measures the last five reviewed games against the five before them', () => {
    const accuracies = [70, 72, 74, 76, 78, 80, 82, 84, 86, 88];
    const { recentAverage, change } = computeAccuracyTrend(accuracies.map((a, i) => on(i + 1, a)));
    expect(recentAverage).toBe(84);
    expect(change).toBe(10);
    const worse = computeAccuracyTrend([90, 90, 90, 90, 90, 80, 80, 80, 80, 80].map((a, i) => on(i + 1, a)));
    expect(worse.change).toBe(-10);
  });
});

describe('mergeArchiveGames', () => {
  const at = (id: string, when: string, extra: Partial<SavedGameSummary> = {}) => game({ sourceMatchId: id, playedAt: when, savedAt: when, ...extra });

  it('lists the archive and the Daily Fritz games as one list, newest first, at most the limit', () => {
    const archive = [at('a-old', '2026-10-01T10:00:00.000Z'), at('a-new', '2026-11-02T10:00:00.000Z')];
    const daily = [at('dfz-mid', '2026-10-20T10:00:00.000Z', { mode: 'dfz' }), at('dfz-newest', '2026-11-02T12:00:00.000Z', { mode: 'dfz' })];
    expect(mergeArchiveGames(archive, daily, 10).map((g) => g.sourceMatchId)).toEqual(['dfz-newest', 'a-new', 'dfz-mid', 'a-old']);
    expect(mergeArchiveGames(archive, daily, 2).map((g) => g.sourceMatchId)).toEqual(['dfz-newest', 'a-new']);
    expect(mergeArchiveGames(archive, daily, 0)).toEqual([]);
  });

  it('lists a game once, and sorts an unreadable date as the oldest instead of dropping or promoting it', () => {
    const merged = mergeArchiveGames([at('x', '2026-11-01T00:00:00.000Z'), at('bad', 'not a date')], [at('x', '2026-11-01T00:00:00.000Z', { mode: 'dfz' })], 10);
    expect(merged.map((g) => g.sourceMatchId)).toEqual(['x', 'bad']);
    expect(merged[0]!.mode).toBe('pvf'); // the first one listed wins
  });

  it('does not change its inputs', () => {
    const archive = [at('a', '2026-11-01T00:00:00.000Z')];
    const daily = [at('d', '2026-11-02T00:00:00.000Z', { mode: 'dfz' })];
    const copy = JSON.stringify([archive, daily]);
    mergeArchiveGames(archive, daily, 5);
    expect(JSON.stringify([archive, daily])).toBe(copy);
  });
});

describe('attachSavedReviews', () => {
  const dfz = (id: string, extra: Partial<SavedGameSummary> = {}) => game({ sourceMatchId: id, mode: 'dfz', ...extra });

  it('joins a Daily Fritz game to its saved review by the game\'s own id, with no accuracy to show', () => {
    const [joined, other] = attachSavedReviews(
      [dfz('dfz:1:1'), dfz('dfz:1:2')],
      [{ id: 'review-a', sourceMatchId: 'dfz:1:1' }, { id: 'review-b', sourceMatchId: 'something-else' }],
    );
    expect(joined!.review).toEqual({ id: 'review-a', accuracy: null, grade: null });
    expect(other!.review).toBeNull();
  });

  it('leaves every other kind of game, and a game that already has its review, exactly as it is', () => {
    const pvf = game({ sourceMatchId: 'p1' });
    const mp = game({ sourceMatchId: 'm1', mode: 'mp' });
    const ready = dfz('dfz:2:1', { review: { id: 'server-joined', accuracy: 88, grade: 'A' } });
    const out = attachSavedReviews([pvf, mp, ready], [{ id: 'r1', sourceMatchId: 'p1' }, { id: 'r2', sourceMatchId: 'm1' }, { id: 'r3', sourceMatchId: 'dfz:2:1' }]);
    expect(out).toEqual([pvf, mp, ready]);
  });

  it('ignores a review with no game id, and keeps the first review when a game has several', () => {
    const out = attachSavedReviews([dfz('dfz:3:1')], [{ id: 'orphan', sourceMatchId: null }, { id: 'first', sourceMatchId: 'dfz:3:1' }, { id: 'second', sourceMatchId: 'dfz:3:1' }]);
    expect(out[0]!.review!.id).toBe('first');
    const lone = dfz('dfz:4:1');
    expect(attachSavedReviews([lone], [])).toEqual([lone]);
  });
});

