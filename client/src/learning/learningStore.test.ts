// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandLearningSummary } from './handSummary';
import {
  createDefaultProfile,
  getProfileSummary,
  loadProfile,
  saveProfile,
  updateProfile,
} from './learningStore';

const KEY = 'racehorse:learn:profile:v1';

function summary(overrides: Partial<HandLearningSummary> = {}): HandLearningSummary {
  return {
    handScore: 10,
    moveAccuracy: 0.9,
    bestMovesPlayed: 3,
    excellentMovesPlayed: 1,
    goodMovesPlayed: 0,
    dubiousMovesPlayed: 0,
    blundersPlayed: 0,
    totalMoves: 4,
    missedScores: 0,
    defensiveMistakes: 0,
    flexibilityMistakes: 0,
    strongestConcept: 'scoring',
    weakestConcept: 'safety',
    keyLesson: 'Lesson A',
    encouragement: 'Nice hand.',
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('load and save', () => {
  it('a fresh profile has every concept at zero and starts as a beginner in guided mode', () => {
    const profile = createDefaultProfile();
    expect(Object.values(profile.conceptScores)).toHaveLength(8);
    expect(Object.values(profile.conceptScores).every((score) => score === 0)).toBe(true);
    expect(profile.computedLevel).toBe('beginner');
    expect(profile.preferredMode).toBe('guided');
    expect(profile.handsPlayed).toBe(0);
  });

  it('round-trips a saved profile', () => {
    const updated = updateProfile(createDefaultProfile(), summary(), 'training', '2026-11-01T12:00:00.000Z');
    saveProfile(updated);
    expect(loadProfile()).toMatchObject({ handsPlayed: 1, preferredMode: 'training' });
  });

  it('never throws: corrupt JSON, a different schema version or blocked storage all give a default profile', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadProfile().handsPlayed).toBe(0);

    window.localStorage.setItem(KEY, JSON.stringify({ ...createDefaultProfile(), handsPlayed: 9, _v: 99 }));
    expect(loadProfile().handsPlayed).toBe(0);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadProfile().handsPlayed).toBe(0);
  });

  it('a failed save (quota, private mode) does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveProfile(createDefaultProfile())).not.toThrow();
  });
});

describe('updateProfile', () => {
  it('does not mutate the profile it is given', () => {
    const before = createDefaultProfile();
    const snapshot = JSON.stringify(before);
    updateProfile(before, summary(), 'guided', '2026-11-01T12:00:00.000Z');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('moves the strongest concept up by 8 and the weakest down by 5, never below 0 or above 100', () => {
    const start = createDefaultProfile();
    const after = updateProfile(start, summary(), 'guided', '2026-11-01T12:00:00.000Z');
    expect(after.conceptScores.scoring).toBe(8);
    expect(after.conceptScores.safety).toBe(0);

    const high = { ...start, conceptScores: { ...start.conceptScores, scoring: 96, safety: 3 } };
    const capped = updateProfile(high, summary(), 'guided', '2026-11-01T12:00:00.000Z');
    expect(capped.conceptScores.scoring).toBe(100);
    expect(capped.conceptScores.safety).toBe(0);
  });

  it('when the strongest and weakest concept are the same, only the weakest penalty applies', () => {
    const start = { ...createDefaultProfile(), conceptScores: { ...createDefaultProfile().conceptScores, tempo: 50 } };
    const after = updateProfile(start, summary({ strongestConcept: 'tempo', weakestConcept: 'tempo' }), 'guided', '2026-11-01T12:00:00.000Z');
    expect(after.conceptScores.tempo).toBe(45);
  });

  it('keeps a running average accuracy and adds up the move count', () => {
    let profile = createDefaultProfile();
    profile = updateProfile(profile, summary({ moveAccuracy: 1, totalMoves: 4 }), 'guided', '2026-11-01T12:00:00.000Z');
    profile = updateProfile(profile, summary({ moveAccuracy: 0.5, totalMoves: 6 }), 'guided', '2026-11-01T12:00:00.000Z');
    expect(profile.handsPlayed).toBe(2);
    expect(profile.averageAccuracy).toBeCloseTo(0.75);
    expect(profile.moveCount).toBe(10);
  });

  it('tracks streaks: a blunder resets the clean-hand streak, accuracy under 0.8 resets the strong streak', () => {
    let profile = createDefaultProfile();
    profile = updateProfile(profile, summary(), 'guided', '2026-11-01T12:00:00.000Z');
    profile = updateProfile(profile, summary(), 'guided', '2026-11-01T12:00:00.000Z');
    expect(profile.streaks).toMatchObject({ handsWithNoBlunder: 2, strongScoringHands: 2 });

    profile = updateProfile(profile, summary({ blundersPlayed: 1, moveAccuracy: 0.79 }), 'guided', '2026-11-01T12:00:00.000Z');
    expect(profile.streaks).toMatchObject({ handsWithNoBlunder: 0, strongScoringHands: 0 });
  });

  it('counts a new day only when the session date differs from the last update date', () => {
    const start = createDefaultProfile(); // updatedAt 2026-11-01
    const sameDay = updateProfile(start, summary(), 'guided', '2026-11-01T23:00:00.000Z');
    expect(sameDay.streaks.daysPlayed).toBe(0);
    const nextDay = updateProfile(start, summary(), 'guided', '2026-11-02T08:00:00.000Z');
    expect(nextDay.streaks.daysPlayed).toBe(1);
  });

  it('keeps the five most recent distinct lessons, newest first', () => {
    let profile = createDefaultProfile();
    for (const lesson of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L3']) {
      profile = updateProfile(profile, summary({ keyLesson: lesson }), 'guided', '2026-11-01T12:00:00.000Z');
    }
    expect(profile.recentLessons).toEqual(['L3', 'L6', 'L5', 'L4', 'L2']);
  });

  it('only guided, training and challenge change the preferred mode', () => {
    const start = { ...createDefaultProfile(), preferredMode: 'training' as const };
    expect(updateProfile(start, summary(), 'challenge', '2026-11-01T12:00:00.000Z').preferredMode).toBe('challenge');
    expect(updateProfile(start, summary(), 'unknown' as never, '2026-11-01T12:00:00.000Z').preferredMode).toBe('training');
  });

  it('derives the level from the average concept score: under 40 beginner, 40 to 69 intermediate, 70 and up advanced', () => {
    const base = createDefaultProfile();
    const withAll = (score: number) => ({
      ...base,
      conceptScores: Object.fromEntries(Object.keys(base.conceptScores).map((key) => [key, score])) as typeof base.conceptScores,
    });
    // One hand moves two concepts (+8 and -5), so the average shifts by 3/8; pick inputs well inside each band.
    expect(updateProfile(withAll(10), summary(), 'guided', '2026-11-01T12:00:00.000Z').computedLevel).toBe('beginner');
    expect(updateProfile(withAll(55), summary(), 'guided', '2026-11-01T12:00:00.000Z').computedLevel).toBe('intermediate');
    expect(updateProfile(withAll(85), summary(), 'guided', '2026-11-01T12:00:00.000Z').computedLevel).toBe('advanced');
  });

  // KNOWN DEFECT (found in the 2026-11-01 code-health audit): the code is meant to flag a concept that was the weakest
  // in two of the last five hands, but it builds that history from `recentLessons` (lesson sentences), not from past
  // weakest concepts, so no tag can ever repeat and recurringMistakeTags stays empty. Nothing reads the field yet, so
  // players are not affected. `it.fails` passes while the defect exists and starts failing the day it is fixed: flip
  // it to a plain `it` then.
  it.fails('flags a concept that was the weakest in two recent hands', () => {
    let profile = createDefaultProfile();
    profile = updateProfile(profile, summary({ weakestConcept: 'safety', keyLesson: 'L1' }), 'guided', '2026-11-01T12:00:00.000Z');
    profile = updateProfile(profile, summary({ weakestConcept: 'safety', keyLesson: 'L2' }), 'guided', '2026-11-01T12:00:00.000Z');
    expect(profile.recurringMistakeTags).toContain('safety');
  });
});

describe('getProfileSummary', () => {
  it('reports the strongest and weakest concept and the mean mastery', () => {
    const base = createDefaultProfile();
    const profile = { ...base, conceptScores: { ...base.conceptScores, scoring: 80, endgame: 0 }, recentLessons: ['Newest', 'Older'] };
    const view = getProfileSummary(profile);
    expect(view.strongestConcept).toBe('scoring');
    expect(view.weakestConcept).not.toBe('scoring');
    expect(view.overallMasteryScore).toBe(10);
    expect(view.recentLesson).toBe('Newest');
  });

  it('has no recent lesson on a fresh profile', () => {
    expect(getProfileSummary(createDefaultProfile()).recentLesson).toBeNull();
  });
});
