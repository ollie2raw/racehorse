import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../supabaseUtils', () => ({ supabaseFetch: fetchMock }));
const replayMock = vi.hoisted(() => vi.fn());
vi.mock('../realtime/gameOverPersistence', () => ({ replayGameOverCompletion: replayMock }));
const forfeitMock = vi.hoisted(() => vi.fn());
vi.mock('./ratedForfeitCompletion', () => ({ completeRatedForfeit: forfeitMock }));
vi.mock('../operationalTelemetry', () => ({ recordOperationalFailure: vi.fn() }));

import { RatingCutoverQuiescedError } from '../ranking/ratingCutoverGate';
import { strandedTerminalScanPath } from './terminalCompletionStore';
import {
  recoverStrandedTerminalCompletions,
  recoverTerminalCompletion,
  resetTerminalCompletionRecoveryForTests,
  validateTerminalReplayRow,
} from './terminalCompletionRecovery';
import { mkTerminalGameState } from './terminalCompletionTestKit';
import { buildLiveSessionRow } from './roomLivePersistence';
import { createDetachedRoom } from '../rooms';

beforeEach(() => {
  fetchMock.mockReset();
  replayMock.mockReset();
  forfeitMock.mockReset();
  resetTerminalCompletionRecoveryForTests();
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = '11111111-1111-4111-8111-111111111111';

function terminalRow(overrides: Record<string, unknown> = {}) {
  const room = createDetachedRoom('TREC1', { winningScore: 60 });
  room.matchId = MATCH;
  room.players = ['seat-a', 'seat-b'];
  room.state = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 4 });
  const row = buildLiveSessionRow(room, [
    { seatId: 'seat-a', userId: A, username: 'A' },
    { seatId: 'seat-b', userId: B, username: 'B' },
  ]);
  return { ...row, ...overrides };
}

describe('strandedTerminalScanPath (lightweight, bounded, deterministic)', () => {
  const path = strandedTerminalScanPath({ cutoffIso: '2026-10-15T00:00:00.000Z', limit: 25 });
  const params = new URL(`http://x${path}`).searchParams;

  it('selects only the lightweight projection and orders oldest-first with a stable tiebreak', () => {
    expect(params.get('select')).toBe('room_code,match_id,status,updated_at');
    expect(params.get('order')).toBe('updated_at.asc,room_code.asc');
    expect(params.get('limit')).toBe('25');
    expect(params.get('status')).toBe('in.(game_over,abandoned)');
    expect(params.get('source_type')).toBe('neq.tournament');
    expect(params.get('updated_at')).toBe('lt.2026-10-15T00:00:00.000Z');
  });

  it('excludes quarantined rows and recognizes rows written before the flag existed', () => {
    const and = params.get('and')!;
    expect(and).toContain('room_shell->>completionPending.eq.true');
    expect(and).toContain('room_shell->completionRecovery->>quarantinedAt.is.null');
    expect(and).toContain('and(status.eq.game_over,room_shell->>completionPending.is.null');
  });

  it('pages with a keyset cursor, never an offset', () => {
    const next = new URL(`http://x${strandedTerminalScanPath({ cutoffIso: 'c', limit: 25, after: { updatedAt: 'U', roomCode: 'R' } })}`).searchParams;
    expect(next.get('and')).toContain('or(updated_at.gt.U,and(updated_at.eq.U,room_code.gt."R"))');
    expect(next.has('offset')).toBe(false);
  });
});

describe('validateTerminalReplayRow', () => {
  it('accepts a well-formed game_over row and rejects structurally unusable evidence', () => {
    expect(validateTerminalReplayRow(terminalRow() as never)).toEqual({ ok: true });
    expect(validateTerminalReplayRow(terminalRow({ game_state: null }) as never)).toMatchObject({ ok: false });
    expect(validateTerminalReplayRow(terminalRow({ engine_seat_ids: ['seat-a'] }) as never)).toMatchObject({ ok: false });
    expect(validateTerminalReplayRow(terminalRow({ status: 'playing' }) as never)).toMatchObject({ ok: false, reason: 'row_not_terminal' });
    expect(validateTerminalReplayRow(terminalRow({ roster: [] }) as never)).toMatchObject({ ok: false });
  });
});

describe('recoverTerminalCompletion classification', () => {
  const candidate = { room_code: 'TREC1', match_id: MATCH, status: 'game_over' as const, updated_at: '2026-10-15T00:00:00.000Z' };

  function serve(row: unknown) {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && (!init?.method || init.method === 'GET')) {
        return path.includes('select=room_shell') ? [{ room_shell: (row as { room_shell: unknown }).room_shell, updated_at: 'U1' }] : [row];
      }
      if (init?.method === 'PATCH') return [{ room_code: 'TREC1' }];
      if (init?.method === 'DELETE') return [{ room_code: 'TREC1' }];
      return [];
    });
  }

  it('a closed rating gate defers without counting a failed attempt', async () => {
    serve(terminalRow());
    replayMock.mockRejectedValue(new RatingCutoverQuiescedError('game_over_persist'));
    await expect(recoverTerminalCompletion(candidate)).resolves.toBe('deferred');
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });

  it('a transient failure records one durable attempt (and bumps updated_at for backoff/fairness)', async () => {
    serve(terminalRow());
    replayMock.mockRejectedValue(new Error('boom'));
    await expect(recoverTerminalCompletion(candidate)).resolves.toBe('failed');
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    const body = JSON.parse(String((patch[1] as RequestInit).body));
    expect(body.room_shell.completionRecovery).toMatchObject({ attempts: 1, lastError: 'boom' });
    expect(typeof body.updated_at).toBe('string');
  });

  it('a database outage is not charged to the row (the attempt cannot be recorded)', async () => {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') throw new Error('db down');
      if (path.includes('select=room_shell')) return [{ room_shell: terminalRow().room_shell, updated_at: 'U1' }];
      return [terminalRow()];
    });
    replayMock.mockRejectedValue(new Error('db down'));
    await expect(recoverTerminalCompletion(candidate)).resolves.toBe('failed');
  });

  it('a row replaced by a newer match is left alone', async () => {
    serve(terminalRow({ match_id: '22222222-2222-4222-8222-222222222222' }));
    await expect(recoverTerminalCompletion(candidate)).resolves.toBe('raced');
    expect(replayMock).not.toHaveBeenCalled();
  });

  it('an already-logged row only gets its marker repaired, never a second replay', async () => {
    const row = terminalRow();
    row.room_shell = { ...row.room_shell, matchLogged: true, completionPending: true };
    serve(row);
    await expect(recoverTerminalCompletion(candidate)).resolves.toBe('already_logged');
    expect(replayMock).not.toHaveBeenCalled();
  });

  it('a forfeit row replays through the shared rated-forfeit completion with the durable reason', async () => {
    const room = createDetachedRoom('TREC2', { winningScore: 60 });
    room.matchId = MATCH;
    room.players = ['seat-a', 'seat-b'];
    room.state = mkTerminalGameState('seat-a', 'seat-b', { a: 40, b: 10 }, { gameOver: false });
    room.abandonedAt = '2026-10-15T01:02:03.000Z';
    room.abandonedByUserId = A;
    room.abandonedReason = 'forfeit';
    room.abandonedForfeitReason = 'disconnect_timeout';
    const row = buildLiveSessionRow(room, [
      { seatId: 'seat-a', userId: A, username: 'A' },
      { seatId: 'seat-b', userId: B, username: 'B' },
    ]);
    serve(row);
    forfeitMock.mockResolvedValue({ status: 'logged', ratingResult: null });
    await expect(recoverTerminalCompletion({ ...candidate, room_code: 'TREC2', status: 'abandoned' })).resolves.toBe('recovered');
    expect(forfeitMock).toHaveBeenCalledWith(expect.objectContaining({
      forfeitReason: 'disconnect_timeout',
      playedAt: '2026-10-15T01:02:03.000Z',
      abandonerSeatId: 'seat-a',
      scoreA: 40,
      scoreB: 10,
    }));
  });
});

describe('sweep budget', () => {
  it('with nothing stranded the sweep is exactly one request', async () => {
    fetchMock.mockResolvedValue([]);
    const result = await recoverStrandedTerminalCompletions({ now: Date.now() });
    expect(result.scanned).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('concurrent triggers share one sweep (single-flight)', async () => {
    fetchMock.mockResolvedValue([]);
    const [a, b] = await Promise.all([recoverStrandedTerminalCompletions(), recoverStrandedTerminalCompletions()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
