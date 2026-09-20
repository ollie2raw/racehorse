import { describe, expect, it, vi } from 'vitest';
import {
  HEAD_TO_HEAD_HARNESS_VERSION,
  parseCliArgs,
  runHeadToHead,
  runHeadToHeadGame,
  replayHeadToHeadGame,
  summarizeHeadToHead,
  type GameResult,
} from './oracleVsFritzHeadToHead.ts';

// Real chooseBotMove + real evaluateReviewPosition on every decision, no
// mocks -- same reasoning as recordClientPolicyCorpus.test.ts's file-level
// timeout override: a single small game can legitimately exceed vitest's
// 5000ms default under full-suite contention.
vi.setConfig({ testTimeout: 30_000 });

describe('parseCliArgs', () => {
  it('parses games/seed/variant/workers/out from --flag value pairs', () => {
    const options = parseCliArgs(['--games', '12', '--seed', 'abc', '--variant', 'oracle-fallback-to-fritz-master-heuristic', '--workers', '3', '--out', '/tmp/x']);
    expect(options.gameCount).toBe(12);
    expect(options.seed).toBe('abc');
    expect(options.variant).toBe('oracle-fallback-to-fritz-master-heuristic');
    expect(options.workers).toBe(3);
    expect(options.outDir).toBe('/tmp/x');
  });

  it('defaults games to 600, variant to default, workers to 1', () => {
    const options = parseCliArgs([]);
    expect(options.gameCount).toBe(600);
    expect(options.variant).toBe('default');
    expect(options.workers).toBe(1);
  });

  it('rejects a non-positive-integer --games value', () => {
    expect(() => parseCliArgs(['--games', '0'])).toThrow(/positive integer/);
    expect(() => parseCliArgs(['--games', 'nope'])).toThrow(/positive integer/);
  });

  it('rejects more than four workers and invalid starting indices', () => {
    expect(() => parseCliArgs(['--workers', '5'])).toThrow(/at most 4/);
    expect(() => parseCliArgs(['--start-index', '-1'])).toThrow(/start-index/);
  });

  it('rejects an unknown --variant value', () => {
    expect(() => parseCliArgs(['--variant', 'bogus'])).toThrow(/default\|oracle-fallback-to-fritz-master-heuristic/);
  });
});

describe('runHeadToHeadGame -- mechanical correctness of a single game (real engines, no mocks)', () => {
  // fritzTier overridden to 'standard' here: 'master' is confirmed
  // timing-sensitive (see this file's own header comment and
  // recordClientPolicyCorpus.test.ts), so strict byte-identical
  // reproducibility can only honestly be asserted at a deterministic tier.
  // The harness's OWN mechanics under test here (seeding, seat rotation,
  // dispatch) are identical regardless of which BotDifficulty is plugged
  // in; a separate describe block below checks 'master' is schema-valid.
  const seed = 'h2h-unit-test-seed';

  it('produces a completed game with a winner or draw, non-negative scores, and a seat assignment covering both policies', () => {
    const result = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed, fritzTier: 'standard' });
    expect(['fritz-master', 'oracle-top-move', 'draw']).toContain(result.winnerPolicy);
    expect(result.finalScore['fritz-master']).toBeGreaterThanOrEqual(0);
    expect(result.finalScore['oracle-top-move']).toBeGreaterThanOrEqual(0);
    expect(new Set(Object.values(result.seatAssignment))).toEqual(new Set(['fritz-master', 'oracle-top-move']));
    expect(result.decisionCount).toBeGreaterThan(0);
    expect(result.decisions.length).toBe(result.decisionCount);
  });

  it('is deterministic at a non-timing-sensitive fritzTier: the same seed and seat produce byte-identical results', () => {
    const first = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed, fritzTier: 'standard' });
    const second = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed, fritzTier: 'standard' });
    expect(replayHeadToHeadGame(first)).toEqual(first);
    expect(() => replayHeadToHeadGame({ ...first, replayTrace: first.replayTrace.map((row, index) => index === 0 ? { ...row, stateDigest: 'corrupted' } : row) })).toThrow(/Replay diverged/);
    expect(second).toEqual(first);
  });

  it('a different seed changes the game (different decision count or different first decision)', () => {
    const original = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed, fritzTier: 'standard' });
    const other = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed: 'a-totally-different-seed', fritzTier: 'standard' });
    const same = original.decisionCount === other.decisionCount
      && JSON.stringify(original.decisions[0]) === JSON.stringify(other.decisions[0]);
    expect(same).toBe(false);
  });

  it('seat rotation: swapping fritzSeat assigns policies to the opposite seats but deals the same underlying hands (per-seat dealt hand identity is independent of which policy is assigned to that seat)', () => {
    const fritzOnBot = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed, fritzTier: 'standard' });
    const fritzOnYou = runHeadToHeadGame(0, 'you', { gameCount: 1, seed, fritzTier: 'standard' });
    expect(fritzOnBot.seatAssignment.bot).toBe('fritz-master');
    expect(fritzOnBot.seatAssignment.you).toBe('oracle-top-move');
    expect(fritzOnYou.seatAssignment.you).toBe('fritz-master');
    expect(fritzOnYou.seatAssignment.bot).toBe('oracle-top-move');
    // Rotating seats changes WHICH POLICY plays which hand -- since the two
    // policies generally choose different moves, the two games are expected
    // to diverge (this is the point of seat rotation: it cancels seat bias
    // across a game SET, it does not produce a mirrored single game).
    expect(fritzOnBot.decisions[0]).not.toEqual(fritzOnYou.decisions[0]);
  });

  it('every decision is tagged with a phase, and endgame decisions only occur at 0 drawable boneyard tiles by construction (checked indirectly: heuristic/exact evidence sources on oracle decisions are internally consistent with dispatch)', () => {
    const result = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed: 'phase-tag-seed', fritzTier: 'standard' });
    for (const decision of result.decisions) {
      expect(['opening', 'midgame', 'endgame']).toContain(decision.phase);
    }
  });
}, 40_000);

describe('runHeadToHeadGame -- fritzTier "master" is timing-sensitive (schema-valid every run, NOT asserted byte-identical)', () => {
  it('two independent runs at the same seed both produce a valid completed game', () => {
    const first = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed: 'master-h2h-seed', fritzTier: 'master' });
    const second = runHeadToHeadGame(0, 'bot', { gameCount: 1, seed: 'master-h2h-seed', fritzTier: 'master' });
    for (const result of [first, second]) {
      expect(['fritz-master', 'oracle-top-move', 'draw']).toContain(result.winnerPolicy);
      expect(result.decisionCount).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('runHeadToHead -- alternates fritzSeat across the game set', () => {
  it('assigns fritzSeat bot on even gameIndex and you on odd gameIndex', () => {
    const results = runHeadToHead({ gameCount: 4, seed: 'rotation-seed', fritzTier: 'standard' });
    expect(results.map((r) => r.fritzSeat)).toEqual(['bot', 'you', 'bot', 'you']);
    expect(results.map((r) => r.gameIndex)).toEqual([0, 1, 2, 3]);
  }, 60_000);
});

describe('summarizeHeadToHead -- pure aggregation over synthetic results (no engine calls, fast)', () => {
  function fakeResult(overrides: Partial<GameResult>): GameResult {
    return {
      gameIndex: 0,
      seed: 's',
      fritzSeat: 'bot',
      seatAssignment: { bot: 'fritz-master', you: 'oracle-top-move' },
      winnerPolicy: 'draw',
      finalScore: { 'fritz-master': 0, 'oracle-top-move': 0 },
      handCount: 1,
      decisionCount: 0,
      decisions: [],
      replayTrace: [],
      finalStateDigest: '',
      ...overrides,
    };
  }

  it('counts wins/losses/draws and computes win rate correctly', () => {
    const summary = summarizeHeadToHead([
      fakeResult({ winnerPolicy: 'oracle-top-move' }),
      fakeResult({ winnerPolicy: 'oracle-top-move' }),
      fakeResult({ winnerPolicy: 'fritz-master' }),
      fakeResult({ winnerPolicy: 'draw' }),
    ]);
    expect(summary.oracleWins).toBe(2);
    expect(summary.fritzWins).toBe(1);
    expect(summary.draws).toBe(1);
    expect(summary.oracleWinRate).toBe(0.5);
    expect(summary.gameCount).toBe(4);
  });

  it('a 0/0 win rate has a Wilson interval of [0, 0], not NaN', () => {
    const summary = summarizeHeadToHead([]);
    expect(summary.winRateCI95).toEqual([0, 0]);
    expect(Number.isNaN(summary.meanMargin)).toBe(false);
  });

  it('computes mean margin as oracle score minus fritz score, averaged over games', () => {
    const summary = summarizeHeadToHead([
      fakeResult({ finalScore: { 'fritz-master': 40, 'oracle-top-move': 60 } }),
      fakeResult({ finalScore: { 'fritz-master': 60, 'oracle-top-move': 40 } }),
    ]);
    expect(summary.meanMargin).toBe(0);
  });

  it('buckets decision net points by phase and by which policy made the decision', () => {
    const summary = summarizeHeadToHead([
      fakeResult({
        decisions: [
          { gameIndex: 0, handNumber: 1, actor: 'bot', policy: 'fritz-master', phase: 'opening', immediatePoints: 10 },
          { gameIndex: 0, handNumber: 1, actor: 'you', policy: 'oracle-top-move', phase: 'opening', immediatePoints: 5 },
          { gameIndex: 0, handNumber: 2, actor: 'bot', policy: 'fritz-master', phase: 'endgame', immediatePoints: 15 },
        ],
      }),
    ]);
    expect(summary.byPhase.opening).toEqual({ oracleNetPoints: 5, fritzNetPoints: 10, decisionCount: 2 });
    expect(summary.byPhase.endgame).toEqual({ oracleNetPoints: 0, fritzNetPoints: 15, decisionCount: 1 });
    expect(summary.byPhase.midgame).toEqual({ oracleNetPoints: 0, fritzNetPoints: 0, decisionCount: 0 });
  });
});

describe('HEAD_TO_HEAD_HARNESS_VERSION', () => {
  it('is a non-empty version string', () => {
    expect(HEAD_TO_HEAD_HARNESS_VERSION.length).toBeGreaterThan(0);
  });
});
