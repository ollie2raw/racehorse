/**
 * Runs the compile-time DTO drift guard as part of the normal test suite.
 *
 * The actual type-level assertions live in ./contractsDriftTypes.ts (a
 * non-`.test.ts` file) because server/tsconfig.json excludes `**\/*.test.ts`
 * from `tsc -p tsconfig.json` (the `npm run build` step) — so a check that
 * only lived in this file would never be type-checked by a build. See that
 * file for the full rationale and the list of shapes it covers (room/match
 * action payload, daily puzzle DTOs, daily fritz set/game DTOs).
 */
import { describe, expect, it } from 'vitest';
import { assertNoServerContractDrift } from './contractsDriftTypes';

describe('shared DTO contracts are not locally re-declared (drift guard)', () => {
  it('type-level assertions in contractsDriftTypes.ts type-check', () => {
    // If any shared shape has drifted, `npm run build --prefix server`
    // (and this import) fails to type-check before this line ever runs.
    assertNoServerContractDrift();
    expect(true).toBe(true);
  });
});
