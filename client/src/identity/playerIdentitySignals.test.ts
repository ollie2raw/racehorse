import { describe, expect, it } from 'vitest';
import { createEmptyPlayerIdentityModel } from './playerIdentityNormalization';
import { derivePlayerIdentitySignals, MIN_FRITZ_COMPARISON_GAMES } from './playerIdentitySignals';
import type { PlayerIdentityModel } from './playerIdentityTypes';

function build(overrides: Partial<PlayerIdentityModel> = {}): PlayerIdentityModel {
  const base = createEmptyPlayerIdentityModel(100);
  return {
    ...base,
    subject: { ...base.subject, userId: 'u1', username: 'Maya', isCurrentUser: true, friendshipStatus: 'self' },
    ...overrides,
  };
}

const signalTypes = (model: PlayerIdentityModel) => derivePlayerIdentitySignals(model).all.map((signal) => signal.type);

describe('player identity signals', () => {
  it.each<[string, Partial<PlayerIdentityModel['competitive']>, string | undefined]>([
    ['at peak rating', { rating: 1500, peakRating: 1500 }, 'competitive_at_peak'],
    ['below peak', { rating: 1499, peakRating: 1500 }, undefined],
    ['missing rating', { rating: null, peakRating: 1500 }, undefined],
    ['best streak', { bestStreak: 8 }, 'competitive_best_streak'],
    ['zero streak', { bestStreak: 0, currentStreak: 0 }, undefined],
    ['current streak', { currentStreak: 3 }, 'competitive_current_streak'],
    ['recent form with three results', { recentForm: ['win', 'loss', 'win'] }, 'competitive_recent_form'],
    ['recent form with two results', { recentForm: ['win', 'loss'] }, undefined],
    ['ranked games', { rankedGames: 184 }, 'competitive_ranked_games'],
  ])('supports %s conservatively', (_name, competitive, expected) => {
    const types = signalTypes(build({ competitive: { ...createEmptyPlayerIdentityModel().competitive, ...competitive } }));
    if (expected) expect(types).toContain(expected);
    else expect(types).not.toContain('competitive_at_peak');
  });

  it('selects most-played Fritz difficulty with stable ties', () => {
    const model = build({ fritz: { ...createEmptyPlayerIdentityModel().fritz, difficultyRecords: [
      { difficulty: 'master', wins: 4, losses: 1, games: 5 },
      { difficulty: 'rookie', wins: 3, losses: 2, games: 5 },
      { difficulty: 'elite', wins: 2, losses: 2, games: 4 },
    ] } });
    const signals = derivePlayerIdentitySignals(model).all;
    expect(signals.find((item) => item.type === 'fritz_most_played_difficulty')?.value).toBe('rookie');
    const reversed = build({ fritz: { ...model.fritz, difficultyRecords: [...model.fritz.difficultyRecords].reverse() } });
    expect(derivePlayerIdentitySignals(reversed)).toEqual(derivePlayerIdentitySignals(model));
  });

  it('requires the centralized Fritz comparison sample threshold', () => {
    const under = build({ fritz: { ...createEmptyPlayerIdentityModel().fritz, difficultyRecords: [{ difficulty: 'master', wins: 4, losses: 0, games: 4 }] } });
    expect(signalTypes(under)).not.toContain('fritz_best_record');
    const exact = build({ fritz: { ...under.fritz, difficultyRecords: [{ difficulty: 'master', wins: MIN_FRITZ_COMPARISON_GAMES, losses: 0, games: MIN_FRITZ_COMPARISON_GAMES }] } });
    expect(signalTypes(exact)).toContain('fritz_best_record');
  });

  it('derives Fritz depth, scoring, and overall record without quality claims', () => {
    const record = (difficulty: string) => ({ difficulty, wins: 5, losses: 1, games: 6 });
    const model = build({ fritz: { ...createEmptyPlayerIdentityModel().fritz, totalWins: 20, totalLosses: 8, averageScore: 84.5, bestScore: 101, difficultyRecords: ['rookie', 'standard', 'elite', 'master'].map(record) } });
    const signals = derivePlayerIdentitySignals(model).all;
    expect(signalTypes(model)).toEqual(expect.arrayContaining(['fritz_all_difficulties', 'fritz_average_score', 'fritz_best_score', 'fritz_overall_record']));
    expect(signals.map((item) => `${item.label} ${item.evidence}`).join(' ')).not.toMatch(/dominant|brilliant|weak|elite strategist|slayer/i);
  });

  it('handles Puzzle completions, streak, score precedence, and perfect days', () => {
    const model = build({ puzzle: { ...createEmptyPlayerIdentityModel().puzzle, completions: 12, currentStreak: 4, bestScoreToday: 72, bestScoreEver: 95, bestScore: 95, perfectDays: 3 } });
    const signals = derivePlayerIdentitySignals(model).all;
    expect(signalTypes(model)).toEqual(expect.arrayContaining(['puzzle_completions', 'puzzle_current_streak', 'puzzle_best_ever', 'puzzle_best_today', 'puzzle_perfect_days']));
    expect(signals.find((item) => item.type === 'puzzle_best_ever')?.value).toBe(95);
  });

  it('keeps Journey self-only and supports partial and complete progress', () => {
    const partial = build({ learning: { completedNodes: 18, totalNodes: 25, activeChapterId: 'fritz', activeChapterTitle: 'The Fritz Trail' } });
    const partialSignals = derivePlayerIdentitySignals(partial);
    expect(partialSignals.all.find((item) => item.type === 'learning_journey_progress')).toMatchObject({ visibility: 'self_only', value: 18 });
    expect(partialSignals.all.find((item) => item.type === 'learning_active_chapter')?.label).toContain('The Fritz Trail');
    const complete = build({ learning: { completedNodes: 25, totalNodes: 25, activeChapterId: null, activeChapterTitle: null } });
    expect(derivePlayerIdentitySignals(complete).all.find((item) => item.type === 'learning_journey_progress')?.label).toBe('Journey complete');
    const publicModel = build({ subject: { ...partial.subject, isCurrentUser: false, friendshipStatus: 'none' }, learning: partial.learning });
    expect(derivePlayerIdentitySignals(publicModel).all.some((item) => item.domain === 'learning')).toBe(false);
  });

  it('preserves viewer head-to-head perspective and most-played rival wording', () => {
    const publicModel = build({ subject: { ...createEmptyPlayerIdentityModel().subject, userId: 'u2', username: 'Maya', isCurrentUser: false }, rivalry: { closestRival: null, currentViewerHeadToHead: { wins: 4, losses: 6 } } });
    const h2h = derivePlayerIdentitySignals(publicModel).all.find((item) => item.type === 'rivalry_viewer_head_to_head');
    expect(h2h?.evidence).toBe('4W–6L');
    expect(h2h?.label).toContain('Your record vs Maya');
    const self = build({ rivalry: { closestRival: { userId: 'u9', username: 'hafnerjan', gamesPlayed: 28, winsAgainst: 14, lossesAgainst: 14, rating: 1300 }, currentViewerHeadToHead: { wins: 4, losses: 6 } } });
    expect(derivePlayerIdentitySignals(self).all.find((item) => item.type === 'rivalry_most_played')?.label).toBe('Most-played rival: hafnerjan');
    expect(signalTypes(self)).not.toContain('rivalry_viewer_head_to_head');
  });

  it('limits featured signals to five with no more than two per domain', () => {
    const base = createEmptyPlayerIdentityModel();
    const model = build({ competitive: { ...base.competitive, rating: 1500, peakRating: 1500, rankedGames: 100, bestStreak: 8, currentStreak: 3, recentForm: ['win', 'win', 'loss', 'win'] }, fritz: { ...base.fritz, totalWins: 20, totalLosses: 4, averageScore: 88, bestScore: 101, difficultyRecords: ['rookie', 'standard', 'elite', 'master'].map((difficulty) => ({ difficulty, wins: 5, losses: 1, games: 6 })) }, puzzle: { ...base.puzzle, completions: 12, currentStreak: 4, bestScoreEver: 95, bestScoreToday: 72, perfectDays: 3 }, learning: { completedNodes: 18, totalNodes: 25, activeChapterId: 'c', activeChapterTitle: 'Chapter' }, rivalry: { closestRival: { userId: 'u9', username: 'Rival', gamesPlayed: 28, winsAgainst: 14, lossesAgainst: 14, rating: null }, currentViewerHeadToHead: null } });
    const featured = derivePlayerIdentitySignals(model).featured;
    expect(featured.length).toBeLessThanOrEqual(5);
    expect(Math.max(...['competitive', 'fritz', 'puzzle', 'learning', 'rivalry'].map((domain) => featured.filter((item) => item.domain === domain).length))).toBeLessThanOrEqual(2);
    expect(new Set(featured.map((item) => item.id)).size).toBe(featured.length);
  });

  it('filters self-only signals from public output and is deterministic for sparse data', () => {
    const sparse = build({ subject: { ...createEmptyPlayerIdentityModel().subject, userId: 'u2', username: 'New', isCurrentUser: false }, learning: { completedNodes: 10, totalNodes: 20, activeChapterId: 'x', activeChapterTitle: 'Private' } });
    const first = derivePlayerIdentitySignals(sparse);
    expect(first.selfSignals).toEqual([]);
    expect(first.publicSignals.every((item) => item.visibility === 'public')).toBe(true);
    expect(first.featured.every((item) => item.visibility === 'public')).toBe(true);
    expect(derivePlayerIdentitySignals(sparse)).toEqual(first);
  });
});
