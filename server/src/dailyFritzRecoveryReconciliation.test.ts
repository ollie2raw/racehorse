import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  it('reports a malformed numeric object as ambiguous and continues with later rows', () => {
    const game = { gameNumber: 1, seed: 'seed', playerWon: true, playerScore: 60, fritzScore: 20, pointDiff: 40, completedAt: row.startedAt };
    const malformed = { ...row, id: 'malformed', result: { ...row.result, setWinner: 'player', games: [{ ...game, playerScore: { toString: 'invalid', valueOf: 'invalid' } }] } };
    const complete = { ...row, id: 'complete', result: { ...row.result, games: [game, { ...game, gameNumber: 2 }] } };
    const before = structuredClone(malformed);
    const reports = [malformed, complete, row].map((attempt) => summarizeDailyFritzStaleAttempt(attempt));
    expect(reports.map((report) => report.category)).toEqual(['corrupt_ambiguous', 'complete_normal_recovery', 'incomplete_potentially_resumable']);
    expect(reports[0]).toMatchObject({ eligibility: 'ambiguous', recommendedAction: 'operator_review', automaticClosureAllowed: false });
    expect(malformed).toEqual(before);
  });

  it('the GET-only report CLI includes malformed rows without aborting or making network requests', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'daily-fritz-report-'));
    try {
      const input = path.join(directory, 'input.json');
      const game = { gameNumber: 1, seed: 'seed', playerWon: true, playerScore: 60, fritzScore: 20, pointDiff: 40, completedAt: row.startedAt };
      writeFileSync(input, JSON.stringify([
        { ...row, id: 'malformed', result: { ...row.result, games: [{ ...game, pointDiff: { toString: 'invalid', valueOf: 'invalid' } }] } },
        { ...row, id: 'complete', result: { ...row.result, games: [game, { ...game, gameNumber: 2 }] } },
      ]));
      const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); }; await import('./scripts/reportDailyFritzStaleAttempts.ts');", '--', '--input', input], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000,
      });
      expect(run.status, run.stderr).toBe(0);
      const report = JSON.parse(run.stdout);
      expect(report.readOnly).toBe(true);
      expect(report.attempts.map((attempt: { category: string }) => attempt.category)).toEqual(['corrupt_ambiguous', 'complete_normal_recovery']);
      expect(report.attempts.every((attempt: { automaticClosureAllowed: boolean }) => attempt.automaticClosureAllowed === false)).toBe(true);
      expect(run.stderr).not.toContain('NETWORK_FORBIDDEN');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
