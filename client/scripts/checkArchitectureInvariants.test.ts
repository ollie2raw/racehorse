import { describe, expect, it } from 'vitest';
import {
  findDriftedRatingConstants,
  findLenientDefaultStrictnessOptions,
  findNonIdempotentRankedGamesWrites,
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


/**
 * INV-16 — Shared rating-constant parity (ENGINEERING_GUARDRAILS.md §2,
 * narrowed to the glicko2 client/server pair). A Fritz rating or default RD
 * bumped on one side and not the other silently diverges the client's rating
 * prediction from the server's authoritative update (the RK-3 drift class).
 */
describe('INV-16 shared rating-constant parity', () => {
  const serverFixture = `
    export const DEFAULT_RD = 200;
    export const FRITZ_RATING = 1700;
    export const FRITZ_RD = 50;
    export const TAU = 0.5;
    export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';
  `;

  it('flags a client rating constant whose value drifted from the server', () => {
    const clientDrifted = `
      export const DEFAULT_RD = 200;
      export const FRITZ_RATING = 1800;
      export const FRITZ_RD = 50;
    `;
    expect(findDriftedRatingConstants(clientDrifted, serverFixture)).toEqual([
      { name: 'FRITZ_RATING', client: '1800', server: '1700' },
    ]);
  });

  it('flags a client-only rating constant the server does not declare', () => {
    const clientExtra = `
      export const FRITZ_RD = 50;
      export const FRITZ_APPRENTICE_RATING = 950;
    `;
    expect(findDriftedRatingConstants(clientExtra, serverFixture)).toEqual([
      { name: 'FRITZ_APPRENTICE_RATING', client: '950', server: null },
    ]);
  });

  it('does not flag when every client constant matches the server value', () => {
    const clientClean = `
      export const DEFAULT_RD = 200;
      export const FRITZ_RATING = 1700;
      export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';
    `;
    expect(findDriftedRatingConstants(clientClean, serverFixture)).toEqual([]);
  });

  it('does not flag a server-only constant (server is allowed a superset)', () => {
    const clientSubset = `export const FRITZ_RD = 50;`;
    expect(findDriftedRatingConstants(clientSubset, serverFixture)).toEqual([]);
  });
});


/**
 * INV-17 — Idempotent ranked_games writes only (ENGINEERING_GUARDRAILS.md §3).
 * RK-1 / RK-2 were direct `supabaseFetch` POSTs to `ranked_games` bypassing
 * `insertRankedGameIdempotent()`; one was re-runnable by an unrelated later
 * failure in the same call. This catches a third such call site.
 */
describe('INV-17 idempotent ranked_games writes', () => {
  it('flags a direct supabaseFetch POST to ranked_games outside the wrapper', () => {
    const violation = `
      export async function recordDisconnectLoss(input) {
        const rows = await supabaseFetch<Row[]>('/rest/v1/ranked_games', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });
        return rows?.[0] ?? null;
      }
    `;
    expect(findNonIdempotentRankedGamesWrites('server/src/shared/fritzMatchLifecycle.ts', violation)).toHaveLength(1);
  });

  it('does not flag the idempotent wrapper itself', () => {
    const wrapper = `
      const rows = await supabaseFetch<Row[]>('/rest/v1/ranked_games', { method: 'POST', body });
    `;
    expect(
      findNonIdempotentRankedGamesWrites('server/src/ranking/insertRankedGameIdempotent.ts', wrapper),
    ).toEqual([]);
  });

  it('does not flag a GET read of ranked_games', () => {
    const read = `
      const rows = await supabaseFetch('/rest/v1/ranked_games?player_id=eq.' + id + '&select=delta', {
        method: 'GET',
      });
    `;
    expect(findNonIdempotentRankedGamesWrites('server/src/http/routes/ranking.ts', read)).toEqual([]);
  });

  it('does not flag a ranked_games mention that only appears in a comment', () => {
    const prose = `
      // Cascades: friends, ranked_games.player_id, ghost_profiles are handled by FK.
      await supabaseFetch('/auth/v1/admin/users/' + userId, { method: 'DELETE' });
    `;
    expect(findNonIdempotentRankedGamesWrites('server/src/account/routes.ts', prose)).toEqual([]);
  });
});


/**
 * INV-18 — Strict-by-default verifier options (ENGINEERING_GUARDRAILS.md §4).
 * A verifier's `strict*` / `*Continuity` knob must default to true, so an
 * omitted option means strict and leniency is a visible opt-out. RT-2 was a
 * call site that silently omitted the option and inherited leniency.
 */
describe('INV-18 strict-by-default verifier options', () => {
  const spec = [
    { file: 'server/src/ghost/verifier.ts', fn: 'verifyPlayerMoveLog', option: 'strictHandContinuity' },
  ];

  it('accepts a `?? true` strict default', () => {
    const strict = `const strictHandContinuity = options.strictHandContinuity ?? true;`;
    expect(findLenientDefaultStrictnessOptions(strict, spec)).toEqual([]);
  });

  it('accepts a `{ strictHandContinuity = true }` destructure default', () => {
    const strict = `function verify({ strictHandContinuity = true }: Options) {}`;
    expect(findLenientDefaultStrictnessOptions(strict, spec)).toEqual([]);
  });

  it('flags a `?? false` lenient default (the pre-Guardrail-#4 shape)', () => {
    const lenient = `const strictHandContinuity = options.strictHandContinuity ?? false;`;
    expect(findLenientDefaultStrictnessOptions(lenient, spec)).toHaveLength(1);
    expect(findLenientDefaultStrictnessOptions(lenient, spec)[0]).toMatch(/lenient default/);
  });

  it('flags an option that is read with no explicit default at all (implicitly lenient)', () => {
    const implicit = `if (options.strictHandContinuity) { requireExactChain(); }`;
    expect(findLenientDefaultStrictnessOptions(implicit, spec)).toHaveLength(1);
    expect(findLenientDefaultStrictnessOptions(implicit, spec)[0]).toMatch(/no explicit strict default/);
  });

  it('is not fooled by a `{ strictHandContinuity: false }` opt-out in a doc comment', () => {
    const withCommentedOptOut = `
      // A call site that needs legacy behaviour opts out with { strictHandContinuity: false }.
      const strictHandContinuity = options.strictHandContinuity ?? true;
    `;
    expect(findLenientDefaultStrictnessOptions(withCommentedOptOut, spec)).toEqual([]);
  });
});
