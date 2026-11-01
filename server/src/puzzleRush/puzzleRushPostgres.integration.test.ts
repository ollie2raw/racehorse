/** Real PostgreSQL checks for the Rush RPC boundary. Run with
 * RACEHORSE_REMEDIATION_TEST_DATABASE_URL pointing at an isolated localhost DB
 * prepared with server/test/fixtures/remediationPostgres.sql and the migration.
 */
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHighScorePuzzle, computeBestPossiblePuzzleScore } from '../generatePuzzles';
import { getLegalMoves } from '../game/engine';
import { DEFAULT_CONFIG, type GameState } from '../game/types';
import { gradeRun } from './grading';
import type { PuzzlePoolEntry } from './types';
import { holdPostgresRowLock, waitForBlockedPostgresCalls } from '../../test/support/postgresLockBarrier';

const execFileAsync = promisify(execFile);
const url = process.env.RACEHORSE_REMEDIATION_TEST_DATABASE_URL;
const allowed = Boolean(url && /^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:(?:55432|55439)\/racehorse_remediation$/.test(url));
const psqlBin = process.env.PSQL_BIN || 'psql';
const userId = randomUUID();
const puzzleA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const puzzleB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const puzzleC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function sql(query: string): string {
  if (!url || !allowed) throw new Error('Refusing nonlocal remediation test database');
  return execFileSync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url, '-c', query], {
    encoding: 'utf8', timeout: 10_000,
  }).trim();
}

async function concurrentSql(query: string): Promise<string> {
  if (!url || !allowed) throw new Error('Refusing nonlocal remediation test database');
  const result = await execFileAsync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url, '-c', query], {
    encoding: 'utf8', timeout: 10_000,
  });
  return result.stdout.trim();
}

function createRun(ids: string[]): string {
  const id = randomUUID();
  sql(`insert into public.rush_runs (id,user_id,assigned_puzzle_ids) values ('${id}','${userId}',array[${ids.map((x) => `'${x}'::uuid`).join(',')}])`);
  return id;
}

function report(runId: string, puzzleId: string, ordinal: number, line = '[]'): string {
  return sql(`select public.record_rush_report_v2('${runId}','${userId}','${puzzleId}',${ordinal},0,'${line}'::jsonb,null)`);
}

function finalize(runId: string, score: number): string {
  const grade = JSON.stringify([{ ordinal: 1, puzzleId: puzzleA, rawScore: score,
    awardedPoints: score, solved: true, perfect: false, movesUsed: 1,
    bonusSeconds: 0, submittedLine: [], gradingError: null }]);
  return `select public.finalize_rush_run_v2('${runId}','${userId}','completed',${score},1,null,'${grade}'::jsonb)`;
}

describe.skipIf(!allowed)('Puzzle Rush real PostgreSQL assignment and completion', () => {
  beforeAll(() => sql(`insert into auth.users (id) values ('${userId}')`));
  it('rejects a valid unassigned pool puzzle and completes with the served puzzle solution', () => {
    let generated: ReturnType<typeof createHighScorePuzzle> | null = null;
    for (let attempt = 1; attempt <= 40 && !generated; attempt += 1) {
      try { generated = createHighScorePuzzle(`assignment-contract:${attempt}`, attempt, 3, 4, 5); }
      catch { /* generator legitimately rejects some seeds */ }
    }
    if (!generated) throw new Error('No valid puzzle generated for assignment contract');
    const board = generated.startingBoard;
    const hand = generated.startingHand;
    const bestPossibleScore = computeBestPossiblePuzzleScore(generated);
    const state = {
      config: { ...DEFAULT_CONFIG, tilesPerPlayer: hand.length, deadTileCount: 0, winningScore: 999 },
      playerIds: ['you', 'bot'],
      players: { you: { id: 'you', hand, score: 0 }, bot: { id: 'bot', hand: [], score: 0 } },
      board, boneyard: [], deadTiles: [], currentPlayerIndex: 0, handNumber: 1,
      handOpen: true, handOver: false, gameOver: false, winnerId: null,
      consecutivePasses: 0, sequence: 0,
    } as GameState;
    const move = getLegalMoves(state, 'you').find((candidate) => candidate.type === 'play');
    if (!move || move.type !== 'play') throw new Error('Generated puzzle had no legal solution');
    const line = [{ tile: move.tile, position: move.position }];
    const encodedLine = JSON.stringify(line).replaceAll("'", "''");
    const entry: PuzzlePoolEntry = {
      id: puzzleA, source: 'daily_puzzles', sourcePuzzleId: null,
      startingBoard: board, startingHand: hand, maxMoves: 1,
      puzzleType: 'one_turn_high_score', tier: 'quick_line', dealSize: 14,
      targetScore: 999, bestPossibleScore, difficultyScore: 100,
      playCount: 0, enabled: true,
    };
    const runId = createRun([puzzleA]);
    expect(() => report(runId, puzzleC, 1, encodedLine)).toThrow(/rush_assignment_mismatch/);
    expect(JSON.parse(report(runId, puzzleA, 1, encodedLine)).puzzle_id).toBe(puzzleA);
    sql(`select public.claim_rush_completion_v2('${runId}','${userId}',0)`);
    const grade = gradeRun({
      reported: [{ ordinal: 1, puzzleId: puzzleA, submittedLine: line, clientRawScore: 0 }],
      poolById: new Map([[puzzleA, entry]]), clientReportedScore: 0, runDurationSeconds: 1,
    });
    expect(grade.valid).toBe(true);
    expect(grade.puzzles[0].gradingError).toBeNull();
    const graded = JSON.stringify(grade.puzzles).replaceAll("'", "''");
    const final = JSON.parse(sql(`select public.finalize_rush_run_v2('${runId}','${userId}',
      'completed',${grade.totalScore},${grade.puzzlesSolved},null,'${graded}'::jsonb)`));
    expect(final.outcome).toBe('applied');
    expect(final.run.status).toBe('completed');
    expect(final.run.total_score).toBe(grade.totalScore);
  });
  it('rejects pool puzzles not assigned to the ordinal, repeats, and reports after claim', () => {
    const runId = createRun([puzzleA, puzzleB]);
    expect(JSON.parse(report(runId, puzzleA, 1)).puzzle_id).toBe(puzzleA);
    for (const [puzzle, ordinal] of [[puzzleC, 2], [puzzleA, 2], [puzzleB, 1], [puzzleB, 3]] as const) {
      expect(() => report(runId, puzzle, ordinal)).toThrow(/rush_assignment_mismatch/);
    }
    expect(JSON.parse(report(runId, puzzleA, 1)).ordinal).toBe(1);
    expect(() => report(runId, puzzleA, 1, '[{"tile":"other"}]')).toThrow(/rush_duplicate_ordinal/);
    const claim = JSON.parse(sql(`select public.claim_rush_completion_v2('${runId}','${userId}',0)`));
    expect(claim.outcome).toBe('claimed');
    expect(() => report(runId, puzzleB, 2)).toThrow(/rush_run_closed/);
    const result = JSON.parse(sql(finalize(runId, 10)));
    expect(result.outcome).toBe('applied');
    expect(result.run.total_score).toBe(10);
    const replay = JSON.parse(sql(finalize(runId, 999)));
    expect(replay.outcome).toBe('already_completed');
    expect(replay.run.total_score).toBe(10);
    expect(sql(`select raw_score from public.rush_run_puzzles where run_id='${runId}' and ordinal=1`)).toBe('10');
  });

  it('publishes exactly one result when two completions race', async () => {
    const runId = createRun([puzzleA]);
    report(runId, puzzleA, 1);
    sql(`select public.claim_rush_completion_v2('${runId}','${userId}',0)`);
    const release = await holdPostgresRowLock(url!, `select 1 from public.rush_runs where id='${runId}' for update`, psqlBin);
    const racing = Promise.all([concurrentSql(finalize(runId, 10)), concurrentSql(finalize(runId, 20))]);
    try {
      await waitForBlockedPostgresCalls(url!, 'finalize_rush_run_v2', 2, psqlBin);
    } finally {
      await release();
    }
    const [a, b] = await racing;
    const results = [JSON.parse(a), JSON.parse(b)];
    expect(results.map((x) => x.outcome).sort()).toEqual(['already_completed', 'applied']);
    const published = Number(sql(`select total_score from public.rush_runs where id='${runId}'`));
    expect([10, 20]).toContain(published);
    expect(Number(sql(`select raw_score from public.rush_run_puzzles where run_id='${runId}'`))).toBe(published);
    expect(JSON.parse(sql(`select public.claim_rush_completion_v2('${runId}','${userId}',999)`)).run.total_score).toBe(published);
  });

  it('serializes a report racing the completion claim', async () => {
    const runId = createRun([puzzleA]);
    const release = await holdPostgresRowLock(url!, `select 1 from public.rush_runs where id='${runId}' for update`, psqlBin);
    const racing = Promise.allSettled([
      concurrentSql(`select public.claim_rush_completion_v2('${runId}','${userId}',0)`),
      concurrentSql(`select public.record_rush_report_v2('${runId}','${userId}','${puzzleA}',1,0,'[]'::jsonb,null)`),
    ]);
    try {
      await waitForBlockedPostgresCalls(url!, 'claim_rush_completion_v2', 1, psqlBin);
      await waitForBlockedPostgresCalls(url!, 'record_rush_report_v2', 1, psqlBin);
    } finally {
      await release();
    }
    const [claim, attemptedReport] = await racing;
    expect(claim.status).toBe('fulfilled');
    expect(['fulfilled', 'rejected']).toContain(attemptedReport.status);
    expect(sql(`select completion_claimed_at is not null from public.rush_runs where id='${runId}'`)).toBe('t');
    expect(() => report(runId, puzzleA, 1)).toThrow(/rush_run_closed/);
    const count = Number(sql(`select count(*) from public.rush_run_puzzles where run_id='${runId}'`));
    expect(count).toBe(attemptedReport.status === 'fulfilled' ? 1 : 0);
  });
});


/** Needs supabase/migrations/2026-11-02_rush_leaderboard_ranked_v1.sql applied to the prepared database. */
describe.skipIf(!allowed)('Puzzle Rush ranked leaderboard function (real PostgreSQL)', () => {
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const [alpha, bravo, charlie, delta, echo, foxtrot] = ids;
  const insertRun = (user: string, status: string, endedAt: string | null, score: number, solved: number) =>
    sql(`insert into public.rush_runs (user_id,username,status,ended_at,total_score,puzzles_solved) values ('${user}','${user.slice(0, 4)}','${status}',${endedAt ? `'${endedAt}'` : 'null'},${score},${solved})`);
  // The database is shared with other tests, so only this test's own players are looked at.
  const board = (limit = 100, offset = 0, self = 'null') => {
    const raw = JSON.parse(sql(`select public.rush_leaderboard_ranked_v1(${limit},${offset},${self})::text`));
    return raw as { rows: Array<{ userId: string; rank: number }>; totalPlayers: number; self: { rank: number } | null };
  };
  const mine = (rows: Array<{ userId: string; rank: number }>) => rows.filter((row) => ids.includes(row.userId)).map((row) => row.userId);

  beforeAll(() => {
    sql(`insert into auth.users (id) values ${ids.map((id) => `('${id}')`).join(',')}`);
    // alpha has three completed runs: only the best may count, and it must not take extra rows
    insertRun(alpha, 'completed', '2099-01-01 10:00', 2_000_000, 9);
    insertRun(alpha, 'completed', '2099-01-01 11:00', 1_999_990, 9);
    insertRun(alpha, 'completed', '2099-01-01 12:00', 1_999_980, 9);
    insertRun(bravo, 'completed', '2099-01-01 10:00', 1_999_970, 8);
    // charlie and delta tie on score and solved: the earlier finish ranks higher
    insertRun(charlie, 'completed', '2099-01-01 12:00', 1_999_960, 8);
    insertRun(delta, 'completed', '2099-01-01 09:00', 1_999_960, 8);
    // an invalidated run with a huge score and an open run never appear
    insertRun(echo, 'invalidated', '2099-01-01 08:00', 9_000_000, 99);
    sql(`insert into public.rush_runs (user_id,username,status,total_score) values ('${foxtrot}','fox','in_progress',8000000)`);
  });

  it('ranks one best completed run per player in the app\'s order, leaving out invalidated and open runs', () => {
    expect(mine(board().rows)).toEqual([alpha, bravo, delta, charlie]);
  });

  it('reports the board length and the caller\'s own rank wherever it falls', () => {
    const full = board();
    expect(full.totalPlayers).toBeGreaterThanOrEqual(4);
    const deltaRank = board(1, 0, `'${delta}'`).self?.rank;
    expect(deltaRank).toBe(board().rows.find((row) => row.userId === delta)?.rank);
    // a player with no completed run has no rank
    expect(board(50, 0, `'${echo}'`).self).toBeNull();
  });

  it('pages without overlap or gaps, clamps its limits, and gives an empty list past the end', () => {
    const all = board().rows.map((row) => row.rank);
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(new Set(all).size).toBe(all.length);
    const pageTwo = board(2, 2).rows.map((row) => row.rank);
    expect(pageTwo).toEqual(all.slice(2, 4));
    expect(board(0, 0).rows).toHaveLength(1);
    expect(board(2, -5).rows).toHaveLength(2);
    expect(board(10, 1_000_000).rows).toEqual([]);
  });

  it('is executable by the service role only', () => {
    const can = (role: string) => sql(`select has_function_privilege('${role}', 'public.rush_leaderboard_ranked_v1(integer,integer,uuid)', 'execute')`);
    expect([can('anon'), can('authenticated'), can('service_role')]).toEqual(['f', 'f', 't']);
  });
});
