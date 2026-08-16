import { describe, expect, it } from 'vitest';
import { isSuspiciousDailyFritzScoreAccess } from './checkArchitectureInvariants.ts';

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
