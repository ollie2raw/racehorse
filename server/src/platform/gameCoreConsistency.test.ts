/**
 * GC-1 / GC-9 (HARDENING_PLAN §7.3). Proves the deployed-engine assertion:
 * `resolveGameCoreConsistency` flags a `dist/` whose stamp does not match the
 * on-disk `src/`, and degrades gracefully when either input is absent.
 */
import path from 'path';
import { describe, expect, it } from 'vitest';
import { hashGameCoreSrc, resolveGameCoreConsistency } from './gameCoreConsistency';

const REAL_SRC_DIR = path.resolve(__dirname, '../../../packages/game-core/src');

describe('game-core consistency check', () => {
  it('hashes the on-disk src deterministically and stably', () => {
    const a = hashGameCoreSrc(REAL_SRC_DIR);
    const b = hashGameCoreSrc(REAL_SRC_DIR);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('reports `consistent: true` when the stamp matches the real src hash', () => {
    const srcSha256 = hashGameCoreSrc(REAL_SRC_DIR)!;
    const result = resolveGameCoreConsistency({
      stamp: { srcSha256, builtAt: '2026-09-04T00:00:00.000Z' },
      srcDir: REAL_SRC_DIR,
      softInvariants: false,
    });
    expect(result).toMatchObject({ consistent: true, reason: 'match', srcSha256, distSrcSha256: srcSha256 });
  });

  it('reports `consistent: false` when the stamp is hand-corrupted', () => {
    const result = resolveGameCoreConsistency({
      stamp: { srcSha256: 'deadbeef'.repeat(8), builtAt: '2026-09-04T00:00:00.000Z' },
      srcDir: REAL_SRC_DIR,
      softInvariants: false,
    });
    expect(result.consistent).toBe(false);
    expect(result.reason).toBe('sha-mismatch');
    expect(result.srcSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.distSrcSha256).toBe('deadbeef'.repeat(8));
  });

  it('reports `unverifiable / no-build-stamp` when the dist has no stamp', () => {
    const result = resolveGameCoreConsistency({ stamp: null, srcDir: REAL_SRC_DIR });
    expect(result.consistent).toBe('unverifiable');
    expect(result.reason).toBe('no-build-stamp');
  });

  it('reports `unverifiable / no-src` when the source tree is absent (future Docker)', () => {
    const result = resolveGameCoreConsistency({
      stamp: { srcSha256: 'x'.repeat(64), builtAt: '2026-09-04T00:00:00.000Z' },
      srcDir: path.join(REAL_SRC_DIR, '__does_not_exist__'),
    });
    expect(result.consistent).toBe('unverifiable');
    expect(result.reason).toBe('no-src');
  });

  it('surfaces the SOFT_GAME_INVARIANTS posture', () => {
    expect(resolveGameCoreConsistency({ stamp: null, softInvariants: true }).softInvariants).toBe(true);
    expect(resolveGameCoreConsistency({ stamp: null, softInvariants: false }).softInvariants).toBe(false);
  });
});
