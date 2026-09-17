import { describe, expect, it } from 'vitest';
import {
  batchTagForTier,
  deserializeSelfPlayRecordsFromJsonl,
  parseCliArgs,
  runSelfPlayCorpus,
  serializeSelfPlayRecordsToJsonl,
  type RecordedSelfPlayEvaluation,
} from '../devtools/recordSelfPlayCorpus';

describe('batchTagForTier -- maps FritzTier onto C0 section 5\'s two named categories', () => {
  it('maps master to strong-policy-top-tier', () => {
    expect(batchTagForTier('master')).toBe('strong-policy-top-tier');
  });

  it('maps standard to ordinary-pvf-tier', () => {
    expect(batchTagForTier('standard')).toBe('ordinary-pvf-tier');
  });

  it('tags rookie and elite distinctly from the two named categories, not silently folded into either', () => {
    expect(batchTagForTier('rookie')).toBe('other-tier-rookie');
    expect(batchTagForTier('elite')).toBe('other-tier-elite');
  });
});

describe('parseCliArgs', () => {
  it('parses games/tier/seed/out from --flag value pairs', () => {
    const options = parseCliArgs(['--games', '7', '--tier', 'master', '--seed', 'abc', '--out', '/tmp/x']);
    expect(options).toEqual({ gameCount: 7, tier: 'master', seed: 'abc', outDir: '/tmp/x' });
  });

  it('defaults games to 10, tier to standard, and seed to a fixed default when omitted', () => {
    const options = parseCliArgs([]);
    expect(options.gameCount).toBe(10);
    expect(options.tier).toBe('standard');
    expect(options.seed).toBe('self-play-default-seed');
    expect(options.outDir.length).toBeGreaterThan(0);
  });

  it('rejects a non-positive-integer --games value', () => {
    expect(() => parseCliArgs(['--games', '0'])).toThrow(/positive integer/);
    expect(() => parseCliArgs(['--games', 'not-a-number'])).toThrow(/positive integer/);
  });

  it('rejects a --tier value outside the real FritzTier union', () => {
    expect(() => parseCliArgs(['--tier', 'legendary'])).toThrow(/rookie\|standard\|elite\|master/);
  });
});

describe('serializeSelfPlayRecordsToJsonl / deserializeSelfPlayRecordsFromJsonl -- mechanical round-trip', () => {
  const fakeRecords = [
    { batchTag: 'ordinary-pvf-tier', tier: 'standard', seed: 's', gameIndex: 0, handNumber: 1, moveNumber: 1, actorId: 'player', evaluation: { a: 1 } },
    { batchTag: 'ordinary-pvf-tier', tier: 'standard', seed: 's', gameIndex: 0, handNumber: 1, moveNumber: 2, actorId: 'opponent', evaluation: { a: 2 } },
  ] as unknown as RecordedSelfPlayEvaluation[];

  it('serializes one JSON record per line with a trailing newline', () => {
    const jsonl = serializeSelfPlayRecordsToJsonl(fakeRecords);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(3); // 2 records + trailing empty string after the final \n
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0])).toEqual(fakeRecords[0]);
    expect(JSON.parse(lines[1])).toEqual(fakeRecords[1]);
  });

  it('serializes an empty array to an empty string, not a stray newline', () => {
    expect(serializeSelfPlayRecordsToJsonl([])).toBe('');
  });

  it('round-trips serialize -> deserialize back to the original records', () => {
    const jsonl = serializeSelfPlayRecordsToJsonl(fakeRecords);
    expect(deserializeSelfPlayRecordsFromJsonl(jsonl)).toEqual(fakeRecords);
  });

  it('deserializes an empty string to an empty array', () => {
    expect(deserializeSelfPlayRecordsFromJsonl('')).toEqual([]);
  });
});

describe('runSelfPlayCorpus -- real, deterministic, small self-play run (mechanical correctness, not game-outcome assertions)', () => {
  // Real evaluateReviewPosition calls, same as the rest of this package's
  // fixture-driven tests -- one small game is fast enough to run in a unit
  // test (a handful of seconds), and this is exactly the mechanism the
  // harness itself uses, so a mock would prove nothing about it.
  const options = { gameCount: 1, tier: 'standard' as const, seed: 'harness-unit-test-seed' };

  it('produces at least one recorded decision, all correctly tagged with the batch/tier/seed', () => {
    const records = runSelfPlayCorpus(options);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.batchTag).toBe('ordinary-pvf-tier');
      expect(record.tier).toBe('standard');
      expect(record.seed).toBe('harness-unit-test-seed');
      expect(record.gameIndex).toBe(0);
    }
  });

  it('captures decisions from BOTH players, not just one seat', () => {
    const records = runSelfPlayCorpus(options);
    const actors = new Set(records.map((record) => record.actorId));
    expect(actors.has('player')).toBe(true);
    expect(actors.has('opponent')).toBe(true);
  });

  it('assigns a strictly increasing moveNumber, starting at 1, across the whole game', () => {
    const records = runSelfPlayCorpus(options);
    const moveNumbers = records.map((record) => record.moveNumber);
    expect(moveNumbers[0]).toBe(1);
    for (let index = 1; index < moveNumbers.length; index += 1) {
      expect(moveNumbers[index]).toBe(moveNumbers[index - 1] + 1);
    }
  });

  it('assigns a non-decreasing handNumber across the recorded sequence', () => {
    const records = runSelfPlayCorpus(options);
    for (let index = 1; index < records.length; index += 1) {
      expect(records[index].handNumber).toBeGreaterThanOrEqual(records[index - 1].handNumber);
    }
  });

  it('is fully deterministic -- the same seed produces byte-identical evaluations on a second run', () => {
    const first = runSelfPlayCorpus(options);
    const second = runSelfPlayCorpus(options);
    expect(second).toEqual(first);
  });

  it('a different seed produces a different game (different move count or different first move)', () => {
    const withDifferentSeed = runSelfPlayCorpus({ ...options, seed: 'a-completely-different-seed' });
    const original = runSelfPlayCorpus(options);
    const sameLength = withDifferentSeed.length === original.length;
    const sameFirstMove = JSON.stringify(withDifferentSeed[0]?.evaluation.played) === JSON.stringify(original[0]?.evaluation.played);
    expect(sameLength && sameFirstMove).toBe(false);
  });
});
