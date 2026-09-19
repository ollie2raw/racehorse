import { describe, expect, it } from 'vitest';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { computeGameDigest } from './gameDigest';

function snap(authorityPostStateDigest: string): ReviewPositionSnapshotV2 {
  return {
    integrity: { authorityPreStateDigest: 'pre', authorityPostStateDigest },
  } as unknown as ReviewPositionSnapshotV2;
}

describe('computeGameDigest', () => {
  it('E1: hashes the full ordered array of authorityPostStateDigest, not just the last entry', () => {
    const shortGame = [snap('a'), snap('z')];
    const longerGame = [snap('a'), snap('b'), snap('c'), snap('z')];
    // Same final entry ('z'), different earlier history -- must differ.
    expect(computeGameDigest(shortGame)).not.toBe(computeGameDigest(longerGame));
  });

  it('E1: two games reaching an identical terminal state via different move sequences produce different digests', () => {
    const gameA = [snap('open1'), snap('mid1'), snap('final')];
    const gameB = [snap('open2'), snap('mid2'), snap('final')];
    expect(computeGameDigest(gameA)).not.toBe(computeGameDigest(gameB));
  });

  it('is deterministic and order-sensitive for the same snapshots', () => {
    const snapshots = [snap('a'), snap('b'), snap('c')];
    expect(computeGameDigest(snapshots)).toBe(computeGameDigest(snapshots));
    expect(computeGameDigest([snap('a'), snap('b'), snap('c')])).not.toBe(
      computeGameDigest([snap('c'), snap('b'), snap('a')]),
    );
  });

  it('returns the game-digest-v<N>:<hex> format', () => {
    expect(computeGameDigest([snap('a')])).toMatch(/^game-digest-v\d+:[0-9a-f]{8}$/);
  });

  it('hashes an empty snapshot array without throwing (defensive -- should not occur in practice)', () => {
    expect(computeGameDigest([])).toMatch(/^game-digest-v\d+:[0-9a-f]{8}$/);
  });
});
