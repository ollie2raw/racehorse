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

describe('buildPostGameReviewView: the server job stage (#496) reaches the card', () => {
  const ledger0 = { scoredCount: 0, estimateCount: 0, forcedCount: 4, unavailableCount: 0, pendingCount: 46, totalDecisions: 50, entries: [] };
  const running = { stage: 'running' as const, stalled: false, sweepErrorCode: null };

  it('says Queued, not Analyzing 0 of N, while no pass holds the job; the review still opens', () => {
    const view = buildPostGameReviewView({
      ...base,
      accuracyModelPending: true,
      decisionLedger: ledger0,
      reviewWait: { stage: 'queued', stalled: false, sweepErrorCode: null },
    })!;
    expect(view.status).toBe('queued');
    expect(view.canOpen).toBe(true);
    expect(view.statusText).toMatch(/^Queued/);
    expect(view.progress).toBeNull();
  });

  it('says Analyzing once a pass holds the job, and also once decisions have completed even if the stage still says queued', () => {
    expect(buildPostGameReviewView({ ...base, accuracyModelPending: true, decisionLedger: ledger0, reviewWait: running })!.status).toBe('running');
    const progressed = buildPostGameReviewView({
      ...base,
      accuracyModelPending: true,
      decisionLedger: { ...ledger0, scoredCount: 5, pendingCount: 41 },
      reviewWait: { stage: 'queued', stalled: false, sweepErrorCode: null },
    })!;
    expect(progressed.status).toBe('running');
    expect(progressed.statusText).toBe('Analyzing 5 of 46 moves');
  });

  it('after a stall says it is taking longer and offers Try again (not Analyze again)', () => {
    const view = buildPostGameReviewView({
      ...base,
      accuracyModelPending: true,
      decisionLedger: ledger0,
      reviewWait: { stage: 'queued', stalled: true, sweepErrorCode: null },
    })!;
    expect(view.status).toBe('stalled');
    expect(view.canRetry).toBe(true);
    expect(view.retryLabel).toBe('Try again');
    expect(view.note).toMatch(/taking longer than expected/);
    expect(view.canOpen).toBe(true);
  });

  it('says the service has a setup problem, not that the game is wrong, when the server reports one', () => {
    const view = buildPostGameReviewView({
      ...base,
      accuracyModelPending: true,
      decisionLedger: ledger0,
      reviewWait: { stage: 'queued', stalled: true, sweepErrorCode: 'rpc_missing' },
    })!;
    expect(view.status).toBe('stalled');
    expect(view.note).toMatch(/setup problem/);
    expect(view.note).toMatch(/Nothing is wrong with your game/);
  });

  it('shows the restart state on a stalled retry, and no retry without a handler', () => {
    const wait = { stage: 'queued' as const, stalled: true, sweepErrorCode: null };
    const retrying = buildPostGameReviewView({ ...base, accuracyModelPending: true, decisionLedger: ledger0, reviewWait: wait, retryState: 'retrying' })!;
    expect(retrying.retrying).toBe(true);
    expect(retrying.note).toMatch(/Restarting/);
    const none = buildPostGameReviewView({ ...base, accuracyModelPending: true, decisionLedger: ledger0, reviewWait: wait, retryAvailable: false })!;
    expect(none.canRetry).toBe(false);
  });

  it('a finished review is never shown as stalled', () => {
    const view = buildPostGameReviewView({
      ...base,
      analysis: analysis({ accuracyModel: completeModel }),
      decisionLedger: { scoredCount: 30, estimateCount: 0, forcedCount: 4, unavailableCount: 0, pendingCount: 0, totalDecisions: 34, entries: [] },
      reviewWait: { stage: 'running', stalled: true, sweepErrorCode: null },
    })!;
    expect(view.status).toBe('ready');
  });
});
