/**
 * GC-3a (HARDENING_PLAN §7.3): the compile-time drift guard lives in
 * `coreTypeContracts.ts` (checked by `tsc -b`). This test just exercises it so
 * it also participates in the vitest run and cannot be tree-shaken to nothing.
 */
import { describe, expect, it } from 'vitest';
import { assertNoClientCoreTypeDrift } from './coreTypeContracts';

describe('client ⇄ @racehorse/game-core value types', () => {
  it('do not drift — if this file failed to compile, the 7 leaf types diverged', () => {
    expect(() => assertNoClientCoreTypeDrift()).not.toThrow();
  });
});
