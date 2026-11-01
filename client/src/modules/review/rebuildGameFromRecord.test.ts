import { describe, expect, it } from 'vitest';
import { playSeededGame } from '../../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import { analyzeMoveLog } from '../../analyzer/moveAnalyzer';
import type { RecordMoveEntry } from '../ghost/ghostMatchHelpers';
import { computeGameDigest } from './gameDigest';
import { rebuildGameFromRecord, type SavedGameRecord } from './rebuildGameFromRecord';

/** A genuine played game: honest self-play from a deal seed, saved the way the client saves it. */
function savedGame(seed: string, dealSize: 7 | 14, winningScore: number, matchStarter: 'you' | 'bot' = 'you'): SavedGameRecord {
  const played = playSeededGame({ seed, dealSize, winningScore, matchStarter });
  const moves: RecordMoveEntry[] = played.moves;
  return {
    sourceMatchId: `src-${seed}`,
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize,
    winningScore,
    matchStarter,
    dealSeed: seed,
    result: {
      you: played.playerScore,
      opponent: played.opponentScore,
      winner: played.playerScore > played.opponentScore ? 'you' : 'opponent',
    },
    moves,
    verification: 'replay_verified',
    playedAt: '2026-11-01T00:00:00.000Z',
  };
}

const CASES: Array<[string, 7 | 14, number, 'you' | 'bot']> = [
  ['rebuild-a', 7, 25, 'you'],
  ['rebuild-b', 7, 60, 'you'],
  ['rebuild-c', 7, 60, 'bot'],
  ['rebuild-d', 14, 60, 'you'],
  ['rebuild-e', 7, 40, 'bot'],
];

describe('rebuildGameFromRecord: a saved game rebuilds exactly', () => {
  it.each(CASES)('%s (%i tiles, to %i, %s starts)', (seed, dealSize, winningScore, starter) => {
    const record = savedGame(seed, dealSize, winningScore, starter);
    const rebuilt = rebuildGameFromRecord(record);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const { game } = rebuilt;
    expect(game.finalState.gameOver).toBe(true);
    expect(game.finalState.players.you.score).toBe(record.result.you);
    expect(game.finalState.players.bot.score).toBe(record.result.opponent);
    // One snapshot per action, both seats, with contiguous action numbers.
    expect(game.snapshots).toHaveLength(record.moves.length);
    expect(game.snapshots.map((s) => s.identifiers.actionNumber)).toEqual(record.moves.map((_, i) => i + 1));
    expect(game.snapshots.every((s) => s.identifiers.decisionId.startsWith(`${record.sourceMatchId}:`))).toBe(true);
    // The recorder is the one that captured them, ready for the review hook.
    expect(game.recorder.getSnapshots()).toEqual(game.snapshots);
    expect(game.recorder.getCaptureFailures()).toHaveLength(0);
  });

  it('feeds the existing analyzer: every human decision is one analyzed row, in order', () => {
    for (const [seed, dealSize, winningScore, starter] of CASES) {
      const record = savedGame(seed, dealSize, winningScore, starter);
      const rebuilt = rebuildGameFromRecord(record);
      if (!rebuilt.ok) throw new Error(`${seed}: ${rebuilt.detail}`);
      const { moveLog, snapshots } = rebuilt.game;
      // Human rows: every play and pass, and the first draw of each run.
      const humanRows = moveLog.filter((row) => row.player === 'you');
      const analysis = analyzeMoveLog(moveLog, false, { reviewSnapshots: snapshots, winningScore });
      expect(analysis.analyzedMoves, `${seed}: analyzed rows`).toHaveLength(humanRows.length);
      const numbers = analysis.analyzedMoves.map((move) => move.moveNumber);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(numbers.length);
      // The analyzer sees every hand the game had.
      expect(new Set(moveLog.map((row) => row.handNumber)).size).toBe(analysis.hands.length);
    }
  });

  it('collapses a run of draws to its first draw, but keeps every draw as a snapshot', () => {
    let sawRun = false;
    for (const [seed, dealSize, winningScore, starter] of CASES) {
      const record = savedGame(seed, dealSize, winningScore, starter);
      const draws = record.moves.filter((move) => move.branch === 'draw').length;
      const rebuilt = rebuildGameFromRecord(record);
      if (!rebuilt.ok) throw new Error(rebuilt.detail);
      const drawRows = rebuilt.game.moveLog.filter((row) => row.action === 'draw').length;
      const drawSnapshots = rebuilt.game.snapshots.filter((s) => s.actualAction.kind === 'draw').length;
      expect(drawSnapshots).toBe(draws);
      expect(drawRows).toBeLessThanOrEqual(draws);
      if (drawRows < draws) sawRun = true;
    }
    expect(sawRun).toBe(true);
  });

  it('is deterministic: the same record always yields the same ids and the same game digest', () => {
    const record = savedGame('rebuild-b', 7, 60);
    const first = rebuildGameFromRecord(record);
    const second = rebuildGameFromRecord(record);
    if (!first.ok || !second.ok) throw new Error('rebuild failed');
    const humanOnly = (game: typeof first.game) => game.snapshots.filter((s) => s.identifiers.actorId === 'you');
    expect(humanOnly(first.game).map((s) => s.identifiers.decisionId)).toEqual(humanOnly(second.game).map((s) => s.identifiers.decisionId));
    expect(computeGameDigest(humanOnly(first.game))).toBe(computeGameDigest(humanOnly(second.game)));
  });
});

describe('rebuildGameFromRecord: honest failures', () => {
  const base = () => savedGame('rebuild-b', 7, 60);

  it('refuses a record with no deal seed', () => {
    const result = rebuildGameFromRecord({ ...base(), dealSeed: null });
    expect(result).toMatchObject({ ok: false, reason: 'no_deal_seed' });
  });

  it('refuses a tampered action, naming where it broke', () => {
    const record = base();
    const index = record.moves.findIndex((move) => move.tile_played);
    const original = record.moves[index]!.tile_played;
    const moves = record.moves.map((move, i) => (i === index ? { ...move, tile_played: original === '0|0' ? '6|6' : '0|0' } : move));
    const result = rebuildGameFromRecord({ ...record, moves });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_replayable');
    expect(result.entryIndex).toBe(index);
  });

  it('refuses a record that stops before the game is over', () => {
    const record = base();
    const result = rebuildGameFromRecord({ ...record, moves: record.moves.slice(0, 20) });
    expect(result).toMatchObject({ ok: false, reason: 'incomplete_game' });
  });

  it('refuses a record whose result does not match the replay', () => {
    const record = base();
    const result = rebuildGameFromRecord({ ...record, result: { ...record.result, you: record.result.you + 5 } });
    expect(result).toMatchObject({ ok: false, reason: 'result_mismatch' });
  });

  it('ignores a stray pass from a seat that is not on turn, as the server replayer does', () => {
    const record = base();
    const first = record.moves[0]!;
    const stray: RecordMoveEntry = { turn: first.turn, hand_number: 1, actor: first.actor === 'you' ? 'fritz' : 'you', tile_played: null, branch: 'pass', score_delta: 0 };
    const withStray = rebuildGameFromRecord({ ...record, moves: [stray, ...record.moves] });
    const clean = rebuildGameFromRecord(record);
    if (!withStray.ok || !clean.ok) throw new Error('rebuild failed');
    expect(withStray.game.snapshots).toHaveLength(clean.game.snapshots.length);
    expect(withStray.game.finalState.players.you.score).toBe(record.result.you);
  });

  it('refuses a record that keeps going after the game ended', () => {
    const record = base();
    const result = rebuildGameFromRecord({ ...record, moves: [...record.moves, record.moves[0]!] });
    expect(result).toMatchObject({ ok: false, reason: 'not_replayable' });
  });
});
