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

const execFileAsync = promisify(execFile);
const url = process.env.RACEHORSE_REMEDIATION_TEST_DATABASE_URL;
const allowed = Boolean(url && /^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:55432\/racehorse_remediation$/.test(url));
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
    const [a, b] = await Promise.all([concurrentSql(finalize(runId, 10)), concurrentSql(finalize(runId, 20))]);
    const results = [JSON.parse(a), JSON.parse(b)];
    expect(results.map((x) => x.outcome).sort()).toEqual(['already_completed', 'applied']);
    const published = Number(sql(`select total_score from public.rush_runs where id='${runId}'`));
    expect([10, 20]).toContain(published);
    expect(Number(sql(`select raw_score from public.rush_run_puzzles where run_id='${runId}'`))).toBe(published);
    expect(JSON.parse(sql(`select public.claim_rush_completion_v2('${runId}','${userId}',999)`)).run.total_score).toBe(published);
  });

  it('serializes a report racing the completion claim', async () => {
    const runId = createRun([puzzleA]);
    const [claim, attemptedReport] = await Promise.allSettled([
      concurrentSql(`select public.claim_rush_completion_v2('${runId}','${userId}',0)`),
      concurrentSql(`select public.record_rush_report_v2('${runId}','${userId}','${puzzleA}',1,0,'[]'::jsonb,null)`),
    ]);
    expect(claim.status).toBe('fulfilled');
    expect(['fulfilled', 'rejected']).toContain(attemptedReport.status);
    expect(sql(`select completion_claimed_at is not null from public.rush_runs where id='${runId}'`)).toBe('t');
    expect(() => report(runId, puzzleA, 1)).toThrow(/rush_run_closed/);
    const count = Number(sql(`select count(*) from public.rush_run_puzzles where run_id='${runId}'`));
    expect(count).toBe(attemptedReport.status === 'fulfilled' ? 1 : 0);
  });
});
