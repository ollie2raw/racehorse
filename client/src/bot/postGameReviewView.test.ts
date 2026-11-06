import { describe, expect, it } from 'vitest';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import { buildPostGameReviewView } from './postGameReviewView';

function analysis(overrides: Partial<GameAnalysis> = {}): GameAnalysis {
  return {
    accuracy: 77.3,
    grade: 'B',
    analyzedAt: 0,
    analyzedMoves: [],
    timeline: [],
    hands: [],
    oracleMode: 'tier',
    tierPlayed: 'standard',
    oracleLabel: 'Fritz',
    worstHandNumber: null,
    consequenceByMoveNumber: {},
    ...overrides,
  };
}

const completeModel: GameAccuracyModelResult = {
  status: 'complete',
  accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
  accuracy: 95,
  grade: 'S',
  heuristicMoveCount: 0,
  totalNonForcedMoveCount: 30,
  coverageFraction: 1,
};

const base = {
  eligible: true,
  analysis: analysis(),
  analysisPending: false,
  accuracyModelPending: false,
  reviewUnavailable: false,
  reviewUnavailableReason: null,
  decisionLedger: null,
  retryAvailable: true,
  retryState: 'idle' as const,
};

describe('buildPostGameReviewView', () => {
  it('has no review for a game that is not eligible (a Journey trial, a mode without one)', () => {
    expect(buildPostGameReviewView({ ...base, eligible: false })).toBeNull();
  });

  it('is not openable until the position record exists, and says it is preparing', () => {
    const view = buildPostGameReviewView({ ...base, analysis: null, analysisPending: true })!;
    expect(view.status).toBe('preparing');
    expect(view.canOpen).toBe(false);
    expect(view.statusText).toBe('Preparing your review…');
  });

  it('opens at once while the analysis runs, with real progress and no placeholder accuracy', () => {
    const view = buildPostGameReviewView({
      ...base,
      accuracyModelPending: true,
      decisionLedger: { scoredCount: 12, estimateCount: 0, forcedCount: 4, unavailableCount: 0, pendingCount: 34, totalDecisions: 50, entries: [] },
    })!;
    expect(view.status).toBe('running');
    expect(view.canOpen).toBe(true);
    expect(view.progress).toEqual({ done: 12, total: 46 });
    expect(view.statusText).toBe('Analyzing 12 of 46 moves');
    expect(view.accuracyText).toBeNull();
    expect(view.gradeText).toBeNull();
  });

  it('never shows the legacy accuracy as a stand-in while the calibrated model is missing', () => {
    const view = buildPostGameReviewView({ ...base })!;
    expect(view.status).toBe('running');
    expect(view.accuracyText).toBeNull();
    expect(view.statusText).toBe('Analyzing your moves…');
  });

  it('shows accuracy and grade only when every decision is resolved', () => {
    const view = buildPostGameReviewView({
      ...base,
      analysis: analysis({ accuracyModel: completeModel }),
      decisionLedger: { scoredCount: 30, estimateCount: 0, forcedCount: 4, unavailableCount: 0, pendingCount: 0, totalDecisions: 34, entries: [] },
    })!;
    expect(view.status).toBe('ready');
    expect(view.accuracyText).toBe('95.0%');
    expect(view.gradeText).toBe('S');
    expect(view.progress).toBeNull();
  });

  it('does not offer a retry for a review the server has switched off, and says nothing is wrong with the game', () => {
    const view = buildPostGameReviewView({ ...base, reviewUnavailable: true, reviewUnavailableReason: 'sweep_disabled' })!;
    expect(view.status).toBe('unavailable');
    expect(view.canRetry).toBe(false);
    expect(view.canOpen).toBe(true);
    expect(view.note).toMatch(/switched off/i);
  });

  it('offers a retry for a review that really failed, and shows it restarting', () => {
    const failed = buildPostGameReviewView({ ...base, reviewUnavailable: true, reviewUnavailableReason: 'failed' })!;
    expect(failed.canRetry).toBe(true);
    expect(failed.retrying).toBe(false);
    const restarting = buildPostGameReviewView({ ...base, reviewUnavailable: true, reviewUnavailableReason: 'failed', retryState: 'retrying' })!;
    expect(restarting.retrying).toBe(true);
    expect(restarting.note).toMatch(/Restarting/);
  });

  it('offers no retry when the caller gave no handler', () => {
    const view = buildPostGameReviewView({ ...base, reviewUnavailable: true, reviewUnavailableReason: 'failed', retryAvailable: false })!;
    expect(view.canRetry).toBe(false);
  });
});
