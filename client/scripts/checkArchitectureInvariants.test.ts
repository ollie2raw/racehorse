import { describe, expect, it } from 'vitest';
import {
  findUnguardedFloatingImports,
  isSuspiciousDailyFritzScoreAccess,
} from './checkArchitectureInvariants.ts';

// INV-13 — Daily Fritz Score Trust. This test proves the hard-fail detection
// path fires on an injected violation (client-supplied score/result read
// from req.body with no verifier reference nearby) without needing to spawn
// the full architecture script or leave a fixture route file in the repo.
describe('INV-13 Daily Fritz Score Trust heuristic', () => {
  it('flags an unverified req.body score read as suspicious', () => {
    const violation = `
      export function recordGame(req, res) {
        const score = req.body.score;
        res.json({ score });
      }
    `;
    expect(isSuspiciousDailyFritzScoreAccess(violation)).toBe(true);
  });

  it('flags an unverified req.body result read as suspicious', () => {
    const violation = `
      export function completeMatch(req, res) {
        return res.json({ result: req.body.result });
      }
    `;
    expect(isSuspiciousDailyFritzScoreAccess(violation)).toBe(true);
  });

  it('does not flag a req.body score read when a verifier is referenced in the file', () => {
    const legitimate = `
      import { verifyDailyFritzScore } from './dailyFritzVerificationGlue.ts';

      export function recordGame(req, res) {
        const score = req.body.score;
        verifyDailyFritzScore(score);
        res.json({ score });
      }
    `;
    expect(isSuspiciousDailyFritzScoreAccess(legitimate)).toBe(false);
  });

  it('does not flag files with no score/result body access at all', () => {
    const unrelated = `
      export function ping(req, res) {
        res.json({ ok: true });
      }
    `;
    expect(isSuspiciousDailyFritzScoreAccess(unrelated)).toBe(false);
  });
});


/**
 * INV-15 — Guarded floating imports.
 *
 * A dynamic import kicked off as a floating promise has nowhere to report a
 * failure, so a failed chunk fetch became an unhandled rejection. That is what
 * the global module-import-recovery handler saw, and it could not tell a
 * telemetry chunk from a chunk the UI needs.
 */
describe('INV-15 guarded floating imports', () => {
  it('flags a void import with no catch', () => {
    const violation = `
      void import('./statsApi').then(({ fetchWeeklyRecap }) => {
        setRecap(fetchWeeklyRecap());
      });
    `;
    expect(findUnguardedFloatingImports(violation)).toEqual(["import('./statsApi')"]);
  });

  it('accepts a void import whose chain ends in a catch', () => {
    const guarded = `
      void import('./statsApi')
        .then(({ fetchWeeklyRecap }) => setRecap(fetchWeeklyRecap()))
        .catch(() => setRecap(null));
    `;
    expect(findUnguardedFloatingImports(guarded)).toEqual([]);
  });

  it('does not credit one statement with a later statement catch', () => {
    const violation = `
      void import('./a').then(useA);
      void import('./b').then(useB).catch(noop);
    `;
    expect(findUnguardedFloatingImports(violation)).toEqual(["import('./a')"]);
  });

  it('ignores an awaited import, which the enclosing try/catch owns', () => {
    const awaited = `
      const mod = await import('web-vitals');
      mod.onCLS(report);
    `;
    expect(findUnguardedFloatingImports(awaited)).toEqual([]);
  });

  it('ignores React.lazy, whose failures reach an ErrorBoundary', () => {
    const lazy = `const Screen = React.lazy(() => import('../screens/SettingsScreen'));`;
    expect(findUnguardedFloatingImports(lazy)).toEqual([]);
  });

  it('finds every violation in a file, not just the first', () => {
    const violation = `
      void import('./a').then(useA);
      void import('./b').then(useB);
    `;
    expect(findUnguardedFloatingImports(violation)).toEqual(["import('./a')", "import('./b')"]);
  });
});
