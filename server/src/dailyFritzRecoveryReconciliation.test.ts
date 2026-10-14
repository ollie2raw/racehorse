import { describe, expect, it } from 'vitest';
import { summarizeDailyFritzStaleAttempt } from './dailyFritzRecoveryReconciliation';

describe('read-only stale-attempt reconciliation', () => {
  const row = { id: 'attempt', userId: 'user', runDate: '2026-01-01', startedAt: '2026-01-01T00:00:00Z', result: { version: 2, format: 'best_of_3', games: [] } };
  it('classifies all four categories without permitting automatic closure', () => {
    const incomplete = summarizeDailyFritzStaleAttempt(row);
    const qa = summarizeDailyFritzStaleAttempt(row, { email: 'test@racehorse-test.invalid' });
    const orphan = summarizeDailyFritzStaleAttempt(row, { missing: true });
    const corrupt = summarizeDailyFritzStaleAttempt({ ...row, result: { ...row.result, games: [{ malformed: true }] } });
    const complete = summarizeDailyFritzStaleAttempt({ ...row, result: { ...row.result, set_winner: 'player' } }, { email: 'test@qa.invalid' });
    expect([incomplete, qa, corrupt, complete].map((r) => r.category)).toEqual(['incomplete_potentially_resumable', 'obvious_qa_test_orphan_candidate', 'corrupt_ambiguous', 'complete_normal_recovery']);
    expect(orphan.ownershipHint).toBe('orphan_candidate');
    for (const report of [incomplete, qa, orphan, corrupt, complete]) expect(report.automaticClosureAllowed).toBe(false);
  });
});
