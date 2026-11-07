import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { mergeQuickReviewResults } from './mergeQuickReviewResults';

const evaluation = (label: string) => ({ label }) as unknown as ReviewEvaluationV1;
const map = (entries: Array<[string, string]>) => new Map(entries.map(([id, label]) => [id, evaluation(label)] as const));
const labelOf = (result: { resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1> }, id: string) =>
  (result.resultsByDecisionId.get(id) as unknown as { label: string } | undefined)?.label;

describe('mergeQuickReviewResults', () => {
  const allDecisionIds = ['d1', 'd2', 'd3', 'd4'];

  it('a quick verdict fills a decision the server has not finished, and is marked quick', () => {
    const merged = mergeQuickReviewResults({
      allDecisionIds,
      serverResults: map([]),
      serverPendingIds: new Set(),
      serverComplete: false,
      quickResults: map([['d1', 'quick-1'], ['d2', 'quick-2']]),
    });
    expect(labelOf(merged, 'd1')).toBe('quick-1');
    expect([...merged.quickDecisionIds].sort()).toEqual(['d1', 'd2']);
    // Decisions with neither verdict are pending, even before the server has listed them.
    expect([...merged.pendingDecisionIds].sort()).toEqual(['d3', 'd4']);
  });

  it('a final server verdict wins over the quick one and is not marked quick', () => {
    const merged = mergeQuickReviewResults({
      allDecisionIds,
      serverResults: map([['d1', 'server-1']]),
      serverPendingIds: new Set(['d2', 'd3', 'd4']),
      serverComplete: false,
      quickResults: map([['d1', 'quick-1'], ['d2', 'quick-2']]),
    });
    expect(labelOf(merged, 'd1')).toBe('server-1');
    expect(merged.quickDecisionIds.has('d1')).toBe(false);
    expect(labelOf(merged, 'd2')).toBe('quick-2');
    expect(merged.quickDecisionIds.has('d2')).toBe(true);
  });

  it('a pending server placeholder does not shadow the quick verdict', () => {
    const merged = mergeQuickReviewResults({
      allDecisionIds,
      serverResults: map([['d2', 'server-placeholder']]),
      serverPendingIds: new Set(['d2']),
      serverComplete: false,
      quickResults: map([['d2', 'quick-2']]),
    });
    expect(labelOf(merged, 'd2')).toBe('quick-2');
    expect(merged.pendingDecisionIds.has('d2')).toBe(false);
  });

  it('once the server completes, the result is exactly the server\'s: no quick verdict survives into the authoritative set', () => {
    const server = map([['d1', 'server-1'], ['d2', 'server-2']]);
    const merged = mergeQuickReviewResults({
      allDecisionIds,
      serverResults: server,
      serverPendingIds: new Set(),
      serverComplete: true,
      quickResults: map([['d1', 'quick-1'], ['d3', 'quick-3']]),
    });
    expect(merged.resultsByDecisionId).toBe(server);
    expect(merged.resultsByDecisionId.has('d3')).toBe(false);
    expect(merged.quickDecisionIds.size).toBe(0);
  });

  it('with no quick results it is the server state unchanged (a quick pass that failed costs nothing)', () => {
    const merged = mergeQuickReviewResults({
      allDecisionIds,
      serverResults: map([['d1', 'server-1']]),
      serverPendingIds: new Set(['d2']),
      serverComplete: false,
      quickResults: new Map(),
    });
    expect([...merged.resultsByDecisionId.keys()]).toEqual(['d1']);
    expect(merged.quickDecisionIds.size).toBe(0);
    expect([...merged.pendingDecisionIds].sort()).toEqual(['d2', 'd3', 'd4']);
  });
});
