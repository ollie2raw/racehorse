import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REVIEW_COVERAGE_THRESHOLD, DEFAULT_REVIEW_DISPATCH_BUDGET } from '../modules/review/reviewEngineConfig.ts';
import {
  batchTagForBotDifficulty,
  CLIENT_POLICY_HARNESS_VERSION,
  deserializeClientPolicyRecordsFromJsonl,
  isTimingSensitiveBotDifficulty,
  parseCliArgs,
  runClientPolicyCorpus,
  serializeClientPolicyRecordsToJsonl,
} from './recordClientPolicyCorpus.ts';

// Every test below that calls runClientPolicyCorpus runs the real
// chooseBotMove + real evaluateReviewPosition, no mocks -- even a single
// 'standard' game (normally ~1-2s) can exceed vitest's 5000ms default under
// full-suite parallel contention (observed directly: a single-run test
// timed out at 5000ms only when the whole client suite ran concurrently,
// never in isolation). A file-level default covers every test here instead
// of guessing which ones are "fast enough"; the two genuinely expensive
// tests ('hard'/'master' schema-valid, each running the harness twice) keep
// their own larger explicit overrides below.
vi.setConfig({ testTimeout: 30_000 });

describe('isTimingSensitiveBotDifficulty -- the reproducible manifest field is derived from this, not a literal per call site', () => {
  it('is true for hard and master (both reach botHeuristics.ts\'s wall-clock-gated Hard/Master scoring block)', () => {
    expect(isTimingSensitiveBotDifficulty('hard')).toBe(true);
    expect(isTimingSensitiveBotDifficulty('master')).toBe(true);
  });

  it('is false for casual and standard (createStatePrng-seeded only, no wall-clock deadline reachable)', () => {
    expect(isTimingSensitiveBotDifficulty('casual')).toBe(false);
    expect(isTimingSensitiveBotDifficulty('standard')).toBe(false);
  });
});

describe('batchTagForBotDifficulty -- maps BotDifficulty onto C0 section 5\'s two named categories', () => {
  it('maps master to strong-policy-top-tier', () => {
    expect(batchTagForBotDifficulty('master')).toBe('strong-policy-top-tier');
  });

  it('maps standard to ordinary-pvf-tier', () => {
    expect(batchTagForBotDifficulty('standard')).toBe('ordinary-pvf-tier');
  });

  it('tags casual and hard distinctly from the two named categories, not silently folded into either', () => {
    expect(batchTagForBotDifficulty('casual')).toBe('other-tier-casual');
    expect(batchTagForBotDifficulty('hard')).toBe('other-tier-hard');
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
    expect(options.seed).toBe('client-policy-default-seed');
    expect(options.outDir.length).toBeGreaterThan(0);
  });

  it('derives the default outDir from this module\'s own real location, not a shimmed __dirname, resolving into review-engine\'s fixtures root', () => {
    const options = parseCliArgs([]);
    expect(options.outDir.replace(/\\/g, '/')).toMatch(
      /packages\/review-engine\/fixtures\/recorded-client-policy$/,
    );
  });

  it('rejects a non-positive-integer --games value', () => {
    expect(() => parseCliArgs(['--games', '0'])).toThrow(/positive integer/);
    expect(() => parseCliArgs(['--games', 'not-a-number'])).toThrow(/positive integer/);
  });

  it('rejects a --tier value outside the real BotDifficulty union', () => {
    expect(() => parseCliArgs(['--tier', 'legendary'])).toThrow(/casual\|standard\|hard\|master/);
  });
});

describe('serializeClientPolicyRecordsToJsonl / deserializeClientPolicyRecordsFromJsonl -- mechanical round-trip (shared schema)', () => {
  const fakeRecords = [
    {
      batchTag: 'ordinary-pvf-tier',
      corpusKind: 'pvf-bot-match',
      harnessVersion: CLIENT_POLICY_HARNESS_VERSION,
      policyId: 'client-bot-v1-standard-weighted-heuristic-deterministic',
      tier: 'standard',
      seed: 's',
      gameIndex: 0,
      handNumber: 1,
      moveNumber: 1,
      actorId: 'you',
      budget: DEFAULT_REVIEW_DISPATCH_BUDGET,
      coverageThreshold: DEFAULT_REVIEW_COVERAGE_THRESHOLD,
      evaluation: { a: 1 },
    },
    {
      batchTag: 'ordinary-pvf-tier',
      corpusKind: 'pvf-bot-match',
      harnessVersion: CLIENT_POLICY_HARNESS_VERSION,
      policyId: 'client-bot-v1-standard-weighted-heuristic-deterministic',
      tier: 'standard',
      seed: 's',
      gameIndex: 0,
      handNumber: 1,
      moveNumber: 2,
      actorId: 'bot',
      budget: DEFAULT_REVIEW_DISPATCH_BUDGET,
      coverageThreshold: DEFAULT_REVIEW_COVERAGE_THRESHOLD,
      evaluation: { a: 2 },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any[];

  it('round-trips serialize -> deserialize back to the original records', () => {
    const jsonl = serializeClientPolicyRecordsToJsonl(fakeRecords);
    expect(deserializeClientPolicyRecordsFromJsonl(jsonl)).toEqual(fakeRecords);
  });

  it('serializes an empty array to an empty string, not a stray newline', () => {
    expect(serializeClientPolicyRecordsToJsonl([])).toBe('');
  });
});

describe('runClientPolicyCorpus -- real, deterministic, small client-policy run (mechanical correctness, not game-outcome assertions)', () => {
  // Real evaluateReviewPosition + real chooseBotMove calls, no mocks -- one
  // small game at 'standard' is fast enough for a unit test; 'master' is
  // tested separately below for determinism only, since its endgame
  // minimax search is much slower.
  const options = { gameCount: 1, tier: 'standard' as const, seed: 'harness-unit-test-seed' };

  it('produces at least one recorded decision, all correctly tagged with batch/corpusKind/tier/seed/harness/policy/budget', () => {
    const records = runClientPolicyCorpus(options);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.batchTag).toBe('ordinary-pvf-tier');
      expect(record.corpusKind).toBe('pvf-bot-match');
      expect(record.tier).toBe('standard');
      expect(record.seed).toBe('harness-unit-test-seed');
      expect(record.gameIndex).toBe(0);
      expect(record.harnessVersion).toBe(CLIENT_POLICY_HARNESS_VERSION);
      expect(record.policyId).toBe('client-bot-v1-standard-weighted-heuristic-deterministic');
      expect(record.budget).toEqual(DEFAULT_REVIEW_DISPATCH_BUDGET);
      expect(record.coverageThreshold).toBe(DEFAULT_REVIEW_COVERAGE_THRESHOLD);
    }
  });

  it('captures decisions from BOTH seats ("you" and "bot"), not just one', () => {
    const records = runClientPolicyCorpus(options);
    const actors = new Set(records.map((record) => record.actorId));
    expect(actors.has('you')).toBe(true);
    expect(actors.has('bot')).toBe(true);
  });

  it('assigns a strictly increasing moveNumber, starting at 1, across the whole game', () => {
    const records = runClientPolicyCorpus(options);
    const moveNumbers = records.map((record) => record.moveNumber);
    expect(moveNumbers[0]).toBe(1);
    for (let index = 1; index < moveNumbers.length; index += 1) {
      expect(moveNumbers[index]).toBe(moveNumbers[index - 1] + 1);
    }
  });

  it('assigns a non-decreasing handNumber across the recorded sequence', () => {
    const records = runClientPolicyCorpus(options);
    for (let index = 1; index < records.length; index += 1) {
      expect(records[index].handNumber).toBeGreaterThanOrEqual(records[index - 1].handNumber);
    }
  });

  // Runs the real harness twice (casual + hard) -- under full-suite load this
  // legitimately exceeds vitest's 5000ms default (observed 6.5s), same class
  // of CI-timing finding as C2a-2's own determinism tests.
  it('tags every record with the tier-specific policyId, distinguishing all four tier formulas', () => {
    expect(runClientPolicyCorpus({ ...options, tier: 'casual', gameCount: 1 })[0]?.policyId).toBe(
      'client-bot-v1-casual-flat-immediate-unload-randomized',
    );
    expect(runClientPolicyCorpus({ ...options, tier: 'hard', gameCount: 1 })[0]?.policyId).toBe(
      'client-bot-v1-hard-strategic-plus-mc8-blend035',
    );
  }, 40_000);

  // Real chooseBotMove call twice per test, plus real evaluateReviewPosition
  // for every decision -- legitimately slower than vitest's 5000ms default.
  it('is fully deterministic at "standard" -- the same seed produces byte-identical evaluations on a second run', () => {
    const first = runClientPolicyCorpus(options);
    const second = runClientPolicyCorpus(options);
    expect(second).toEqual(first);
  }, 40_000);

  it('a different seed produces a different game (different move count or different first move)', () => {
    const withDifferentSeed = runClientPolicyCorpus({ ...options, seed: 'a-completely-different-seed' });
    const original = runClientPolicyCorpus(options);
    const sameLength = withDifferentSeed.length === original.length;
    const sameFirstMove = JSON.stringify(withDifferentSeed[0]?.evaluation.played) === JSON.stringify(original[0]?.evaluation.played);
    expect(sameLength && sameFirstMove).toBe(false);
  }, 40_000);
});

describe('runClientPolicyCorpus -- determinism at "casual" (not timing-sensitive, same guarantee as "standard")', () => {
  it('is fully deterministic -- the same seed produces byte-identical evaluations on a second run', () => {
    const options = { gameCount: 1, tier: 'casual' as const, seed: 'casual-determinism-seed' };
    const first = runClientPolicyCorpus(options);
    const second = runClientPolicyCorpus(options);
    expect(second).toEqual(first);
  }, 40_000);
});

/**
 * C2a-3 finding (2026-09-17), confirmed empirically, not assumed from
 * reading the code: chooseBotMove's 'hard' and 'master' tiers pass through
 * botHeuristics.ts's shared "Hard/Master" scoring block, which runs
 * searchExactTurnChain under a REAL WALL-CLOCK deadline
 * (EXACT_CHAIN_BUDGET_MS, not a node/iteration budget) once
 * totalTiles <= 16; 'master' additionally has its own endgame-only
 * wall-clock budget (MASTER_ENDGAME_BUDGET_MS) once totalTiles <= 12,
 * gating a sampled-opponent-hand minimax search. Two identically-seeded
 * runs at 'master' (seed "master-determinism-seed", 1 game) diverged
 * mid-game (hand 7, ~move 148 vs ~move 155 -- a real trajectory
 * difference). The same two-run comparison at 'hard' came back
 * byte-identical in practice (two different seeds, 1 and 3 games, 0 diff
 * both times) -- but 'hard' shares the exact same wall-clock-gated code
 * path, so that is not proof of determinism, only an observation that it
 * didn't manifest at that budget in this sample. Byte-identical equality is
 * therefore NOT asserted for either tier here -- only that both runs
 * produce a real, non-empty, schema-valid sequence. Do not "fix" this by
 * loosening it further or by asserting equality again without first
 * changing how botHeuristics.ts schedules its search (out of scope for
 * this harness) -- see isTimingSensitiveBotDifficulty's own doc comment.
 */
describe('runClientPolicyCorpus -- "hard"/"master" are timing-sensitive: schema-valid on every run, NOT asserted byte-identical', () => {
  function expectSchemaValidRun(records: ReturnType<typeof runClientPolicyCorpus>, tier: 'hard' | 'master') {
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.batchTag).toBe(tier === 'master' ? 'strong-policy-top-tier' : 'other-tier-hard');
    expect(new Set(records.map((record) => record.policyId)).size).toBe(1);
    expect(records[0]?.tier).toBe(tier);
    const moveNumbers = records.map((record) => record.moveNumber);
    expect(moveNumbers[0]).toBe(1);
    for (let index = 1; index < moveNumbers.length; index += 1) {
      expect(moveNumbers[index]).toBe(moveNumbers[index - 1] + 1);
    }
    const actors = new Set(records.map((record) => record.actorId));
    expect(actors.has('you')).toBe(true);
    expect(actors.has('bot')).toBe(true);
  }

  it('"hard": two independent runs both produce schema-valid output', () => {
    const options = { gameCount: 1, tier: 'hard' as const, seed: 'hard-schema-check-seed' };
    expectSchemaValidRun(runClientPolicyCorpus(options), 'hard');
    expectSchemaValidRun(runClientPolicyCorpus(options), 'hard');
  }, 60_000);

  it('"master": two independent runs both produce schema-valid output (even though their content may legitimately differ)', () => {
    const options = { gameCount: 1, tier: 'master' as const, seed: 'master-determinism-seed' };
    expectSchemaValidRun(runClientPolicyCorpus(options), 'master');
    expectSchemaValidRun(runClientPolicyCorpus(options), 'master');
  }, 120_000);
});
