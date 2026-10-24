/**
 * Property-based engine invariants. Games are generated from reproducible string seeds (no dependency
 * on a property-testing library: the repo has none, and a seeded generator gives exact replay).
 *
 *   ENGINE_PROPERTY_GAMES   games per (variant, policy) cell      (default 4)
 *   ENGINE_PROPERTY_SEED    seed namespace                         (default "engine-invariants-v1")
 *
 * A failure message carries `seed`, `variant`, `policy` and `step`; `playGame(seed, variant, policy)`
 * reproduces it exactly. Every generated game is checked after EVERY transition against the independent
 * rules oracle in ./support/engineOracle.ts (see compareStates in ./support/engineHarness.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyMove, canDraw, drawOne, getLegalMoves } from '../engine';
import { applyGameCommand } from '../commands';
import { canonicalJson, deepFreeze, enginePlayersFor, newCoverage, playGame, replayTranscript, VARIANTS, type Coverage, type Policy } from './support/engineHarness';

const GAMES = Number(process.env.ENGINE_PROPERTY_GAMES ?? 4);
const NS = process.env.ENGINE_PROPERTY_SEED ?? 'engine-invariants-v1';
const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch', 'lowScore'];
const SHARED: Coverage = newCoverage();

describe(`generated games vs the independent rules oracle (${NS}, ${GAMES} games per cell)`, () => {
  for (const variant of VARIANTS) {
    for (const policy of POLICIES) {
      it(`${variant.name} / ${policy}`, () => {
        for (let g = 0; g < GAMES; g += 1) {
          const seed = `${NS}:${variant.name}:${policy}:${g}`;
          const run = playGame(seed, variant, policy, { coverage: SHARED });
          // reaching here means: conservation, connectivity, legality, draw/pass, turn, scoring, terminal
          // and non-mutation invariants held after every one of this game's transitions.
          expect(run.finalState.gameOver || run.coverage.actions > 0).toBe(true);
        }
      }, 900_000);
    }
  }

  it('the generated corpus actually exercised the interesting rule paths', () => {
    // eslint-disable-next-line no-console
    console.info('[engine-property] coverage', JSON.stringify(SHARED));
    expect(SHARED.gamesCompleted).toBeGreaterThan(20);
    expect(SHARED.scoringPlays).toBeGreaterThan(200);
    expect(SHARED.doublePlays).toBeGreaterThan(100);
    expect(SHARED.branchPlays).toBeGreaterThan(20);
    expect(SHARED.explicitDraws + SHARED.forcedChainDraws).toBeGreaterThan(100);
    expect(SHARED.chainPasses).toBeGreaterThan(0);
    expect(SHARED.blockedHands).toBeGreaterThan(5);
    expect(SHARED.outHands).toBeGreaterThan(20);
    expect(SHARED.noPlayWithBoneyardLocked).toBeGreaterThan(0);
    expect(SHARED.bothEndsEqualPlays).toBeGreaterThan(0);
    expect(SHARED.tileOnTwoEndsPlays).toBeGreaterThan(0);
  });
});
