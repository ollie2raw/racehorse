/**
 * Independent best-move / value oracle for the review engine's exact (locked-yard) path.
 *
 * The oracle does NOT call solveExactEndgame, searchGameTree, resolveHiddenPoolEligibility or combinations.ts. It trusts only
 * the authoritative engine for legal actions and transitions, and re-derives the documented objective from scratch:
 *
 *   value(action) = mean over EVERY opponent hand the public information allows of
 *                   ( final actor-minus-opponent score at the hand's end under perfect play - the differential already on the board )
 *   perfect play  = the reviewed player maximises, the opponent minimises (both see the allocated hands)
 *
 * Positions come from deterministic generated games (`review-oracle-v1:<n>`), reviewing BOTH seats, so a player-perspective
 * inversion cannot hide behind one seat. Every failure message carries `<namespace>:<n>@<action index>`.
 *
 *   REVIEW_ORACLE_GAMES  number of generated games (default 40)   REVIEW_ORACLE_NS  namespace (default review-oracle-v1)
 */
import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  generateFullSet,
  getLegalMoves,
  GAME_COMMAND_VERSION,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { actionKey, makeGame, type LoggedAction } from './support/reviewIntegrityHarness';
import { oracleFor, tk, type Oracle } from './support/lockedYardOracle';

const GAMES = Number(process.env.REVIEW_ORACLE_GAMES ?? 40);
const NS = process.env.REVIEW_ORACLE_NS ?? 'review-oracle-v1';

const BUDGET = { maxNodes: 400_000_000, maxHiddenStateSamples: 1_000_000, maxPlyDepth: 12, seed: 'review-oracle', maxWallClockMs: 3_600_000 } as const;
const ZERO_CLOCK = () => 0;

function lockedSnapshots(): Array<{ a: LoggedAction; oracle: Oracle }> {
  const out: Array<{ a: LoggedAction; oracle: Oracle }> = [];
  for (let n = 0; n < GAMES; n += 1) {
    for (const a of makeGame(NS, n).actions) {
      if (a.snapshot.preAction.boneyard.drawableCount !== 0) continue;
      if (a.snapshot.legalActions.length < 2) continue; // forced decisions are covered separately
      const oracle = oracleFor(a.snapshot);
      if (oracle) out.push({ a, oracle });
    }
  }
  return out;
}

let memo: ReturnType<typeof lockedSnapshots> | null = null;
const positions = () => (memo ??= lockedSnapshots());

describe(`review oracle: exact path vs an independent minimax (${NS}, ${GAMES} games, both seats)`, () => {
  it('has a meaningful corpus of non-forced locked-yard decisions, on both seats', () => {
    const list = positions();
    const seats = new Set(list.map((p) => p.a.actor));
    process.stdout.write(`[review-oracle] ${list.length} non-forced locked-yard positions from ${GAMES} games, seats ${[...seats].join(',')}, allocations up to ${Math.max(...list.map((p) => p.oracle.allocations))}\n`);
    expect(list.length).toBeGreaterThan(30);
    expect(seats.size).toBe(2);
  }, 900_000);

  it('every candidate value, the best move, the played value and the loss equal the independent oracle', () => {
    let tied = 0;
    for (const { a, oracle } of positions()) {
      const ctx = `${a.snapshot.identifiers.gameId}@${a.index}`;
      const ev = evaluateReviewPosition(a.snapshot, BUDGET, 0.02, ZERO_CLOCK);
      expect(ev.evidence.source, `${ctx} evidence`).toBe('exact');
      expect(ev.search.complete, `${ctx} complete`).toBe(true);
      // candidate set is exactly the legal action set (nothing dropped, nothing invented, no duplicates)
      expect(ev.candidates.map((c) => actionKey(c.action)).sort(), `${ctx} candidate set`).toEqual([...oracle.values.keys()].sort());
      for (const c of ev.candidates) {
        expect(c.value.expectedPointDifferential, `${ctx} value of ${actionKey(c.action)}`).toBeCloseTo(oracle.values.get(actionKey(c.action))!, 9);
      }
      expect(ev.best.value.expectedPointDifferential, `${ctx} best value`).toBeCloseTo(oracle.max, 9);
      expect(oracle.argmax.has(actionKey(ev.best.action)), `${ctx}: recommended ${actionKey(ev.best.action)} is not among the oracle's best ${[...oracle.argmax].join(' ; ')}`).toBe(true);
      const playedOracle = oracle.values.get(actionKey(a.snapshot.actualAction))!;
      expect(ev.played.value.expectedPointDifferential, `${ctx} played value`).toBeCloseTo(playedOracle, 9);
      expect(ev.loss.expectedPointDifferential, `${ctx} loss`).toBeCloseTo(oracle.max - playedOracle, 9);
      expect(ev.loss.expectedPointDifferential, `${ctx} loss sign`).toBeGreaterThanOrEqual(-1e-12);
      if (oracle.argmax.size > 1) tied += 1;
    }
    process.stdout.write(`[review-oracle] values/best/loss agree on ${positions().length} positions (${tied} with a tied best set)\n`);
  }, 900_000);

  it('an equally optimal legal action is never penalised: any member of the oracle best set has loss 0', () => {
    let equalButDifferent = 0;
    let sameTileOtherPlacement = 0;
    for (const { a, oracle } of positions()) {
      if (oracle.argmax.size < 2) continue;
      const ev = evaluateReviewPosition(a.snapshot, BUDGET, 0.02, ZERO_CLOCK);
      for (const key of oracle.argmax) {
        const candidate = ev.candidates.find((c) => actionKey(c.action) === key)!;
        expect(Math.abs(ev.best.value.expectedPointDifferential - candidate.value.expectedPointDifferential), `${a.snapshot.identifiers.gameId}@${a.index} ${key}`).toBeLessThan(1e-12);
        equalButDifferent += 1;
      }
      const played = a.snapshot.actualAction;
      if (oracle.argmax.has(actionKey(played))) {
        expect(ev.loss.expectedPointDifferential, `${a.snapshot.identifiers.gameId}@${a.index}: played an optimal action`).toBeLessThan(1e-12);
        if (actionKey(played) !== actionKey(ev.best.action)) sameTileOtherPlacement += 1;
      }
    }
    process.stdout.write(`[review-oracle] tied-best checks: ${equalButDifferent} candidates, ${sameTileOtherPlacement} played-optimal-but-not-the-shown-best\n`);
    expect(equalButDifferent).toBeGreaterThan(0);
  }, 900_000);

  it('the production adaptive entry point returns the same numbers as the base dispatcher on these positions', () => {
    let checked = 0;
    for (const { a, oracle } of positions().slice(0, 40)) {
      const adaptive = adaptiveEvaluateReviewPosition(a.snapshot, { phase: 'completion' });
      const ctx = `${a.snapshot.identifiers.gameId}@${a.index}`;
      expect(adaptive.lifecycle, `${ctx} lifecycle`).toBe('SCORED');
      const ev = adaptive.evaluation;
      expect(ev.best.value.expectedPointDifferential, `${ctx} best`).toBeCloseTo(oracle.max, 9);
      expect(ev.loss.expectedPointDifferential, `${ctx} loss`).toBeCloseTo(oracle.max - oracle.values.get(actionKey(a.snapshot.actualAction))!, 9);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  }, 900_000);
});

describe('review oracle: the snapshot\'s stored ruleset is honoured, not replaced by the defaults', () => {
  const VARIANTS: Array<{ name: string; config: Parameters<typeof makeGame>[2] }> = [
    { name: 'blocked hands score nothing', config: { config: { blockedHandRule: 'noScore' } } },
    { name: 'no end-of-hand bonus', config: { config: { endHandBonus: 'none' } } },
  ];
  for (const variant of VARIANTS) {
    it(`${variant.name}: exact values, best move and loss follow the stored rules`, () => {
      let compared = 0;
      let differsFromDefaultRules = 0;
      for (let n = 0; n < Math.max(GAMES * 3, 120); n += 1) {
        for (const a of makeGame(`${NS}:ruleset`, n, variant.config).actions) {
          if (a.snapshot.preAction.boneyard.drawableCount !== 0 || a.snapshot.legalActions.length < 2) continue;
          const oracle = oracleFor(a.snapshot);
          if (!oracle) continue;
          const ev = evaluateReviewPosition(a.snapshot, BUDGET, 0.02, ZERO_CLOCK);
          const ctx = `${a.snapshot.identifiers.gameId}@${a.index} [${variant.name}]`;
          for (const c of ev.candidates) {
            expect(c.value.expectedPointDifferential, `${ctx} value of ${actionKey(c.action)} must follow ${JSON.stringify(a.snapshot.rulesetConfig)}`).toBeCloseTo(oracle.values.get(actionKey(c.action))!, 9);
          }
          expect(oracle.argmax.has(actionKey(ev.best.action)), `${ctx}: recommended move is not optimal under the stored rules`).toBe(true);
          compared += 1;
          if (oracle.max !== 0) differsFromDefaultRules += 1;
        }
      }
      process.stdout.write(`[review-oracle] ruleset "${variant.name}": ${compared} positions compared\n`);
      expect(compared).toBeGreaterThan(5);
      void differsFromDefaultRules;
    }, 900_000);
  }
});
