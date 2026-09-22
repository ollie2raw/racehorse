import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replayRecordedClientPolicy } from './replayRecordedClientPolicy.ts';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/review-engine/fixtures/recorded-client-policy');

describe('recorded client-policy replay without policy execution', () => {
  it('reconstructs every committed decision and all 90 complete games', () => {
    const expected = readdirSync(directory).filter(file => file.endsWith('.manifest.json'))
      .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')) as { gameCount: number; recordedDecisions: number });
    const positions = replayRecordedClientPolicy(directory);
    expect(positions).toHaveLength(expected.reduce((sum, manifest) => sum + manifest.recordedDecisions, 0));
    expect(new Set(positions.map(row => row.snapshot.identifiers.gameId)).size)
      .toBe(expected.reduce((sum, manifest) => sum + manifest.gameCount, 0));
    expect(expected.reduce((sum, manifest) => sum + manifest.gameCount, 0)).toBe(90);
    expect(new Set(positions.map(row => row.snapshot.identifiers.decisionId)).size).toBe(positions.length);
    for (const { snapshot, evaluation } of positions) {
      expect(snapshot.actualAction).toEqual(evaluation.played.action);
      expect(snapshot.outcome.immediatePoints).toBe(evaluation.played.immediatePoints);
    }
  });
});
