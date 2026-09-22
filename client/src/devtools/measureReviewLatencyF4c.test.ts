import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  F4C_GAME_ID,
  F4C_MEASURED_RUNS,
  F4C_WARMUPS,
  loadF4cMasterGameSnapshots,
} from './measureReviewLatencyF4c.ts';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/review-engine/fixtures/recorded-client-policy',
);

describe('F4c measurement harness', () => {
  it('loads the fixed master-tier game with a stable decision count', () => {
    const snapshots = loadF4cMasterGameSnapshots(FIXTURES);
    expect(snapshots.length).toBeGreaterThan(50);
    expect(snapshots.every((s) => s.identifiers.gameId === F4C_GAME_ID)).toBe(true);
    expect(new Set(snapshots.map((s) => s.identifiers.decisionId)).size).toBe(snapshots.length);
  });

  it('uses the predeclared warm-up / measured-run protocol constants', () => {
    expect(F4C_WARMUPS).toBe(1);
    expect(F4C_MEASURED_RUNS).toBe(5);
  });
});
