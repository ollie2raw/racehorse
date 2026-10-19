/**
 * Multiplayer avgMoveQuality: legacy analyzer vs the V2 authoritative definition, on deterministic completed games.
 *
 * Namespace `multiplayer-quality-v2:<n>` (replay any game with `makeGame('multiplayer-quality-v2', n)`); both seats of every game;
 * four play policies (random / score / doubles / branch) that cover excellent and poor play, branches, doubles, long draw runs,
 * blocked hands, multiple hands and terminal scoring.
 *
 *   legacy  = what MultiplayerGameShell used to POST: analyzeMoveLog(log, true, { oracleMode: 'tier', tierPlayed: 'standard' })
 *             .accuracy for the seat's own ('you') moves, Fritz-Master reference, no review snapshots.
 *   V2      = authoritativeMoveQuality(job), the job run by the real durable completion pass over that seat's snapshots.
 *
 * Default run: a fast structural check that the legacy path really consults the wall clock. The full both-seat differential is an
 * explicit opt-in audit (minutes per game: the V2 job solves every position exactly):
 *
 *   MQ_DIFFERENTIAL=1 MQ_GAMES=24 MQ_OUT=/tmp/mq.jsonl npx vitest run src/analyzer/multiplayerMoveQuality.differential.test.ts
 *
 * Each line of MQ_OUT is one game-seat; client/scripts/summarizeMoveQualityDifferential.mjs turns it into the report.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  authoritativeMoveQuality,
  createReviewCompletionJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
} from '@racehorse/review-engine';
import { makeGame, type GeneratedGame } from '../../../packages/review-engine/src/__tests__/support/reviewIntegrityHarness';
import { snapshotBoardState, toTileTuple, type MoveEntry } from '../game/moveLogger';
import { analyzeMoveLog } from './moveAnalyzer';

const NS = 'multiplayer-quality-v2';
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Production-shaped rows from `seat`'s point of view: one per play/pass, one per draw run (as the client move log records them). */
function logOf(game: GeneratedGame, seat: string): MoveEntry[] {
  const entries: MoveEntry[] = [];
  const acts = game.actions;
  acts.forEach((a, i) => {
    const hand = a.preState.players[a.actor]!.hand.map((t) => toTileTuple(t));
    const base = {
      handNumber: a.handNumber, player: a.actor === seat ? ('you' as const) : ('opponent' as const),
      boardEnds: [-1, -1] as [number, number], handBefore: hand, pipDelta: 0, pointsScored: a.snapshot.outcome.immediatePoints,
      boardState: snapshotBoardState(a.preState.board), boardRenderState: a.preState.board, handSnapshot: hand, engineBestMove: null,
    };
    if (a.action.kind === 'draw') {
      const prev = acts[i - 1];
      if (prev && prev.actor === a.actor && prev.action.kind === 'draw' && prev.handNumber === a.handNumber) return;
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'draw', validMoves: [], pointsScored: 0 });
    } else if (a.action.kind === 'play') {
      const plays = a.snapshot.legalActions.flatMap((x) => (x.kind === 'play' ? [toTileTuple(x.tile)] : []));
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'place', tile: toTileTuple(a.action.tile), position: a.action.position, validMoves: plays });
    } else {
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'pass', validMoves: [], pointsScored: 0 });
    }
  });
  return entries;
}

/** The legacy persisted value exactly as the client derived it (null when there was nothing to grade), plus what fed it. */
function legacyAvgMoveQuality(game: GeneratedGame, seat: string): number | null {
  return legacyDetail(game, seat).value;
}

function legacyDetail(game: GeneratedGame, seat: string) {
  const analysis = analyzeMoveLog(logOf(game, seat), true, { oracleMode: 'tier', tierPlayed: 'standard' });
  const moves = analysis.analyzedMoves;
  const has = (text: string) => moves.filter((m) => m.explanation.includes(text)).length;
  return {
    value: moves.length > 0 && analysis.accuracy > 0 ? analysis.accuracy : null,
    moves: moves.length,
    // fixed constants the formula averages in as if they were evaluations
    onlyLegalConst80: has('Only legal move available'),
    forcedDrawPassConst84: has('No legal plays — forced draw or pass'),
    noEngineConst72: has('No engine evaluation available') + has('No legal plays recorded'),
    nonPlayWithPlays46: has('Non-play action when plays were available'),
  };
}

/** V2: a real durable completion job over the seat's own decisions, run until it is authoritatively complete. */
async function v2Job(game: GeneratedGame, seat: string) {
  const snapshots = game.actions.filter((a) => a.actor === seat).map((a) => a.snapshot);
  const ids = snapshots.map((s) => s.identifiers.decisionId);
  const job = createReviewCompletionJob({ gameDigest: `${game.id}:${seat}`, sourceMatchId: game.id, userId: seat, snapshots, expectedDecisionIds: ids });
  const store = new InMemoryCheckpointStore();
  await store.put(job);
  let current = job;
  for (let pass = 0; pass < 8 && !jobAuthoritativeComplete(current); pass += 1) {
    // `now` moves past every retry backoff, as consecutive sweeps would
    current = (await runReviewCompletionPass({ store, jobId: job.jobId, claimToken: `mq-${pass}`, concurrency: 1, now: Date.now() + pass * 3_600_000 })).job;
  }
  return current;
}

function shape(game: GeneratedGame, seat: string) {
  const own = game.actions.filter((a) => a.actor === seat);
  return {
    policy: game.policies[seat],
    hands: game.hands,
    decisions: own.length,
    draws: own.filter((a) => a.action.kind === 'draw').length,
    passes: own.filter((a) => a.action.kind === 'pass').length,
    plays: own.filter((a) => a.action.kind === 'play').length,
    doubles: own.filter((a) => a.action.kind === 'play' && a.action.tile.low === a.action.tile.high).length,
    branchPlays: own.filter((a) => a.action.kind === 'play' && String(a.action.position).startsWith('branch-')).length,
    winner: Object.entries(game.finalState.players).sort((x, y) => y[1].score - x[1].score)[0]![0],
    finalScores: Object.fromEntries(Object.entries(game.finalState.players).map(([id, p]) => [id, p.score])),
  };
}

describe('legacy avgMoveQuality consults the wall clock', () => {
  it('the legacy analyzer reads performance.now (Fritz Master search deadlines); V2 has no clock input', () => {
    const game = makeGame(NS, 0);
    const calls: Record<string, number> = {};
    const values: Record<string, number | null> = {};
    for (const [name, step] of [['frozen', 0], ['slow-machine', 5]] as const) {
      let t = 0;
      const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += step));
      try {
        values[name] = legacyAvgMoveQuality(game, 'you');
        calls[name] = spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }
    // The Master reference search runs against a wall-clock deadline (90 ms endgame, 45 ms exact chain). On a slow clock the search
    // is cut short: here it reads the clock ~276x less (3,206 vs 884,400 reads), i.e. it does a small fraction of the work. The
    // headline number happens to agree on this game (the cut search still picks the same replies), which is luck of the position,
    // not a guarantee: the stat depends on how fast the machine is, and nothing in the persisted value records that it did.
    expect(calls.frozen, 'legacy path consults performance.now').toBeGreaterThan(0);
    expect(calls['slow-machine'], 'a slow clock binds the deadline and cuts the search').toBeLessThan(calls.frozen! / 10);
    expect(values.frozen).toBe(values['slow-machine']);
  }, 60_000);

  it('repeat analysis of the same game gives the same legacy number on an unloaded machine', () => {
    const game = makeGame(NS, 1);
    expect(legacyAvgMoveQuality(game, 'you')).toBe(legacyAvgMoveQuality(game, 'you'));
  }, 60_000);
});

const AUDIT_ENABLED = env.MQ_DIFFERENTIAL === '1';

describe.runIf(AUDIT_ENABLED)('[opt-in audit] legacy vs V2 avgMoveQuality on multiplayer-quality-v2', () => {
  it('computes both stats for both seats of every game and writes one JSON line per game-seat to MQ_OUT', async () => {
    const games = Number(env.MQ_GAMES ?? 6);
    const out = env.MQ_OUT;
    if (!out) throw new Error('set MQ_OUT to a writable .jsonl path');
    const moduleName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ moduleName)) as { appendFileSync: (path: string, data: string) => void };
    for (let n = 0; n < games; n += 1) {
      const game = makeGame(NS, n);
      for (const seat of ['you', 'bot']) {
        const startedAt = Date.now();
        const job = await v2Job(game, seat);
        const v2 = authoritativeMoveQuality(job);
        const legacy = legacyDetail(game, seat);
        const repeat = authoritativeMoveQuality(JSON.parse(JSON.stringify(job)));
        fs.appendFileSync(out, `${JSON.stringify({
          id: game.id, seat, ...shape(game, seat), legacy: legacy.value, legacyDetail: legacy, v2: v2.status === 'available' ? v2.avgMoveQuality : null, v2Status: v2.status,
          v2Reason: v2.status === 'unavailable' ? v2.reason : null, v2Graded: v2.status === 'available' ? v2.gradedDecisionCount : 0,
          v2Forced: v2.status === 'available' ? v2.forcedDecisionCount : 0, v2RoundTripEqual: JSON.stringify(repeat) === JSON.stringify(v2),
          ms: Date.now() - startedAt,
        })}\n`);
        expect(job.decisions.length).toBe(game.actions.filter((a) => a.actor === seat).length);
      }
    }
  }, 6 * 3_600_000);

  it('machine speed: on a slow clock the V2 stat is the identical number or explicitly unavailable, never a different number', async () => {
    const game = makeGame(NS, 1);
    const baseline = authoritativeMoveQuality(await v2Job(game, 'you'));
    expect(baseline.status).toBe('available');
    // A slow machine: the evaluator's deadlines (performance.now in the search tiers, Date.now in the exact solver) arrive after
    // far less work. A position that cannot finish is not scored (the job stays incomplete), it is never scored on partial search.
    let t = 0;
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => (t += 2));
    const date = vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + (t += 2));
    try {
      const slow = authoritativeMoveQuality(await v2Job(game, 'you'));
      if (slow.status === 'available') expect(slow.avgMoveQuality).toBe((baseline as { avgMoveQuality: number }).avgMoveQuality);
      else {
        // a position the clock cut short carries the ceiling diagnostic; that makes the stat unavailable, not different
        expect(slow).toMatchObject({ status: 'unavailable', avgMoveQuality: null });
        expect(['wall-clock-truncated', 'review-incomplete']).toContain((slow as { reason: string }).reason);
      }
      const moduleName = 'node:fs';
      const fs = (await import(/* @vite-ignore */ moduleName)) as { appendFileSync: (path: string, data: string) => void };
      if (env.MQ_OUT) fs.appendFileSync(env.MQ_OUT, `${JSON.stringify({ machineSpeed: { id: game.id, seat: 'you', baseline, slow } })}\n`);
    } finally {
      perf.mockRestore();
      date.mockRestore();
    }
  }, 3_600_000);
});
