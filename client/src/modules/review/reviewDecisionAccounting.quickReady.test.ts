import { describe, expect, it } from 'vitest';
import type { AnalyzedMove } from '../../analyzer/moveAnalyzer';
import { buildPlayerDecisionLedger } from './reviewDecisionAccounting';

describe('buildPlayerDecisionLedger: quick-ready decisions (the device\'s provisional verdicts)', () => {
  const moves = [1, 2, 3].map((moveNumber) => ({ moveNumber }) as unknown as AnalyzedMove);
  const ids = new Map([[1, 'd1'], [2, 'd2'], [3, 'd3']]);

  it('counts a quick-judged decision as quick-ready but still PENDING: scored means the server\'s verdict only', () => {
    const summary = buildPlayerDecisionLedger({
      analyzedMoves: moves,
      decisionIdByMoveNumber: ids,
      resultsByDecisionId: new Map(),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(['d1', 'd2', 'd3']),
      batchDone: false,
      quickDecisionIds: new Set(['d1', 'd2']),
    });
    expect(summary.scoredCount).toBe(0);
    expect(summary.pendingCount).toBe(3);
    expect(summary.quickReadyCount).toBe(2);
  });

  it('has no quick-ready count when there are no quick decisions', () => {
    const summary = buildPlayerDecisionLedger({
      analyzedMoves: moves,
      decisionIdByMoveNumber: ids,
      resultsByDecisionId: new Map(),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(['d1']),
      batchDone: false,
    });
    expect(summary.quickReadyCount).toBeUndefined();
  });
});
