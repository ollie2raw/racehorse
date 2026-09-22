import { describe, expect, it, vi } from 'vitest';
import type { ReviewAction, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import {
  actionKey,
  assertContinuationPolicyIndependence,
  CONTINUATION_POLICY_AUDIT,
  freezeDisagreementActions,
  tierReport,
  type AdjudicationRow,
} from './adjudicateOracleDisagreements.ts';

function play(low: number, high: number, position: 'left' | 'right' = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

function row(gameId: string, means: [number, number], tier = 'search'): AdjudicationRow {
  const oracleAction = play(1, 2, 'left');
  const fritzAction = play(3, 4, 'left');
  return {
    decisionId: `${gameId}:decision`,
    gameId,
    tier,
    method: 'paired-rollouts',
    oracleAction,
    fritzAction,
    means,
    intervals: means.map((value) => [value, value]),
    indistinguishable: Math.min(...means) <= 0 && Math.max(...means) >= 0,
    samplesPerPolicy: 128,
  };
}

describe('D2 continuation-policy independence', () => {
  it('documents ≥1 non-Fritz and ≥1 non-oracle continuation policy', () => {
    expect(CONTINUATION_POLICY_AUDIT.some((p) => !p.importsFritzLogic)).toBe(true);
    expect(CONTINUATION_POLICY_AUDIT.some((p) => !p.importsOracleReviewRankingOrSearch)).toBe(true);
    expect(() => assertContinuationPolicyIndependence()).not.toThrow();
  });
});

describe('D2 action identity and freezing', () => {
  it('distinguishes same tile / different end', () => {
    expect(actionKey(play(2, 2, 'left'))).not.toBe(actionKey(play(2, 2, 'right')));
    expect(actionKey(play(1, 5, 'left'))).toBe(actionKey(play(5, 1, 'left')));
  });

  it('freezes oracle + Fritz once per decision (Fritz resolver called once)', () => {
    const oracleAction = play(0, 1, 'left');
    const fritzAction = play(2, 3, 'right');
    const resolveFritz = vi.fn(() => ({ action: fritzAction, immediatePoints: 0, isMinimaxEndgame: false }));
    const snapshot = {
      identifiers: { decisionId: 'd-freeze' },
    } as ReviewPositionSnapshotV2;
    const evaluation = {
      best: { action: oracleAction },
    } as ReviewEvaluationV1;
    const frozen = freezeDisagreementActions(snapshot, evaluation, resolveFritz);
    expect(resolveFritz).toHaveBeenCalledTimes(1);
    expect(frozen).toEqual({
      decisionId: 'd-freeze',
      oracleAction,
      fritzAction,
    });
    // Reuse frozen actions — no further Fritz calls.
    expect(frozen!.oracleAction).toBe(oracleAction);
    expect(frozen!.fritzAction).toBe(fritzAction);
    expect(resolveFritz).toHaveBeenCalledTimes(1);
  });

  it('returns null when engines already agree (no disagreement to adjudicate)', () => {
    const action = play(1, 2, 'left');
    const frozen = freezeDisagreementActions(
      { identifiers: { decisionId: 'agree' } } as ReviewPositionSnapshotV2,
      { best: { action } } as ReviewEvaluationV1,
      () => ({ action, immediatePoints: 0, isMinimaxEndgame: false }),
    );
    expect(frozen).toBeNull();
  });
});

describe('D2 game-cluster decision-rule reporting', () => {
  it('reports encountered but excluded disagreements without inventing results', () => {
    expect(tierReport([], 'search', 3)).toMatchObject({
      disagreements: 3,
      adjudicated: 0,
      excluded: 3,
      games: 0,
      winner: 'unresolved',
      ci95: null,
      meanValueGap: null,
    });
  });

  it('does not treat multiple decisions from one game as independent games', () => {
    const first = row('one-game', [5, 5]);
    const second = { ...first, decisionId: 'another-decision' };
    expect(tierReport([first, second], 'search')).toMatchObject({
      adjudicated: 2,
      games: 1,
      winner: 'unresolved',
      ci95: null,
      meanValueGap: 5,
    });
  });

  it('favors oracle only when both policy intervals are positive (sign: oracle − Fritz)', () => {
    expect(tierReport([row('a', [2, 3]), row('b', [4, 5])], 'search', 3)).toMatchObject({
      disagreements: 3,
      adjudicated: 2,
      excluded: 1,
      games: 2,
      winner: 'oracle',
    });
  });

  it('favors Fritz only when both policy intervals are negative', () => {
    expect(tierReport([row('a', [-2, -3]), row('b', [-4, -5])], 'search').winner).toBe('fritz');
  });

  it('keeps opposite-policy signs contested instead of averaging away disagreement', () => {
    const report = tierReport([row('a', [10, -1]), row('b', [10, -1])], 'search');
    expect(report).toMatchObject({
      meanValueGap: 4.5,
      ci95: [-1, 10],
      winner: 'contested-cap-Inaccuracy',
      indistinguishableShare: 1,
    });
  });

  it('treats an interval touching zero as contested', () => {
    expect(tierReport([row('a', [0, 1]), row('b', [0, 1])], 'search').winner).toBe(
      'contested-cap-Inaccuracy',
    );
  });

  it('does not mix other tiers into the requested tier', () => {
    const rows = [row('a', [2, 2]), row('b', [3, 3]), row('c', [-100, -100], 'heuristic')];
    expect(tierReport(rows, 'search')).toMatchObject({ disagreements: 2, games: 2, winner: 'oracle' });
  });

  it('reproduces the bootstrap report byte-for-byte with its fixed seed', () => {
    const rows = [row('a', [-2, -1]), row('b', [3, 4]), row('c', [0, 1])];
    expect(JSON.stringify(tierReport(rows, 'search'))).toBe(JSON.stringify(tierReport(rows, 'search')));
  });
});
