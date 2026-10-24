import { describe, expect, it } from 'vitest';
import { computeOpenEndsSum, getScoringOpenEndPips, hydrateBoardForOpenEnds } from './openEndsGeometry';
import { playGame, VARIANTS, type Policy } from '../../../packages/game-core/src/__tests__/support/engineHarness';
import type { BoardState } from '../types';

// The client carries its own copy of the open-ends geometry (UI counts, hints, analyzer). It must agree with
// the independent rules oracle on every board a generated game can reach, exactly like the authoritative engine.
const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];

describe('client openEndsGeometry == independent oracle on generated boards', () => {
  it('computeOpenEndsSum, the per-pip breakdown and hydrate() all agree with the oracle sum', () => {
    let boards = 0;
    for (const variant of VARIANTS.slice(0, 3)) {
      for (const policy of POLICIES) {
        for (let g = 0; g < 8; g += 1) {
          const seed = `engine-invariants-v1:client-geometry:${variant.name}:${policy}:${g}`;
          const run = playGame(seed, variant, policy, { keepStates: true });
          run.states.forEach((state, i) => {
            const expected = run.openEndsSums[i];
            if (!state.board || expected === null) return;
            const board = state.board as unknown as BoardState;
            const ctx = `${seed}#${i}`;
            expect(computeOpenEndsSum(board), ctx).toBe(expected);
            expect(getScoringOpenEndPips(board).reduce((a, b) => a + b, 0), `${ctx} pip breakdown`).toBe(expected);
            expect(computeOpenEndsSum(hydrateBoardForOpenEnds(board)), `${ctx} hydrated`).toBe(expected);
            boards += 1;
          });
        }
      }
    }
    expect(boards).toBeGreaterThan(1500);
  }, 300_000);
});
