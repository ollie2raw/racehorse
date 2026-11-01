import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveEntry } from '../../game/moveLogger.ts';
import { buildGameRecordBody, saveGameRecord, type GameRecordBody } from './gameRecord.ts';
import { listGameRecordOutbox, resetGameRecordOutboxForTests } from './gameRecordOutbox.ts';

const apiPost = vi.fn();
vi.mock('../../api/client.ts', () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }));
let session: { token: string | null; userId: string | null } | null = { token: 't', userId: 'user-a' };
vi.mock('../../auth/sessionToken.ts', () => ({ peekCachedSession: () => session }));

function entry(overrides: Partial<MoveEntry>): MoveEntry {
  return {
    moveNumber: 1,
    handNumber: 1,
    player: 'you',
    action: 'place',
    tile: [6, 6],
    position: 'left',
    boardEnds: [6, 6],
    handBefore: [[6, 6]],
    validMoves: [[6, 6]],
    pipDelta: 0,
    pointsScored: 0,
    boardState: [],
    boardRenderState: null,
    handSnapshot: [],
    engineBestMove: null,
    ...overrides,
  };
}

const moveLog: MoveEntry[] = [
  entry({ moveNumber: 1, player: 'you', tile: [6, 6], position: 'left', pointsScored: 0 }),
  entry({ moveNumber: 2, player: 'opponent', tile: [6, 3], position: 'right', pointsScored: 5 }),
  entry({ moveNumber: 3, player: 'you', action: 'draw', tile: undefined, position: undefined }),
  entry({ moveNumber: 4, player: 'opponent', action: 'pass', tile: undefined, position: undefined, handNumber: 2 }),
];

const base = {
  sourceMatchId: 'src-1',
  localMatchId: 'local-1',
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  matchStarter: 'you' as const,
  dealSeed: 'seed-1',
  scores: { you: 61, opponent: 40 },
  winnerId: 'you' as const,
  moveLog,
  playedAt: new Date('2026-11-01T01:00:00.000Z'),
};

describe('buildGameRecordBody', () => {
  it('keeps only what a replay needs, in the compact move shape', () => {
    const body = buildGameRecordBody(base)!;
    expect(body.moves).toEqual([
      { turn: 1, hand_number: 1, actor: 'you', tile_played: '6|6', branch: 'left', score_delta: 0 },
      { turn: 2, hand_number: 1, actor: 'fritz', tile_played: '6|3', branch: 'right', score_delta: 5 },
      { turn: 3, hand_number: 1, actor: 'you', tile_played: null, branch: 'draw', score_delta: 0 },
      { turn: 4, hand_number: 2, actor: 'fritz', tile_played: null, branch: 'pass', score_delta: 0 },
    ]);
    expect(JSON.stringify(body)).not.toContain('boardRenderState');
    expect(JSON.stringify(body)).not.toContain('handBefore');
  });

  it('carries the settings, the server-issued seed and the result', () => {
    const body = buildGameRecordBody(base)!;
    expect(body).toMatchObject({
      mode: 'pvf',
      sourceMatchId: 'src-1',
      localMatchId: 'local-1',
      fritzTier: 'elite',
      dealSize: 7,
      winningScore: 60,
      matchStarter: 'you',
      dealSeed: 'seed-1',
      result: { you: 61, opponent: 40, winner: 'you' },
      playedAt: '2026-11-01T01:00:00.000Z',
    });
  });

  it('records an opponent win, and an unranked game with no seed', () => {
    const body = buildGameRecordBody({ ...base, winnerId: 'bot', dealSeed: undefined, localMatchId: null, dealSize: 9 })!;
    expect(body.result.winner).toBe('opponent');
    expect(body.dealSeed).toBeNull();
    expect(body.localMatchId).toBeNull();
    expect(body.dealSize).toBeNull();
  });

  it('is null for a game with no actions', () => {
    expect(buildGameRecordBody({ ...base, moveLog: [] })).toBeNull();
  });
});

describe('saveGameRecord', () => {
  const body = buildGameRecordBody(base) as GameRecordBody;

  beforeEach(() => {
    vi.useFakeTimers();
    resetGameRecordOutboxForTests();
    apiPost.mockReset();
    session = { token: 't', userId: 'user-a' };
  });
  afterEach(() => vi.useRealTimers());

  it('saves once and empties the outbox', async () => {
    apiPost.mockResolvedValue({ data: {}, error: null, status: 201 });
    saveGameRecord(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/api/game-records', body);
    expect(listGameRecordOutbox()).toHaveLength(0);
  });

  it('keeps the record and retries with backoff until the server has it', async () => {
    apiPost
      .mockResolvedValueOnce({ data: null, error: 'down', status: 503 })
      .mockResolvedValueOnce({ data: null, error: 'down', status: 500 })
      .mockResolvedValue({ data: {}, error: null, status: 201 });
    saveGameRecord(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(listGameRecordOutbox()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiPost).toHaveBeenCalledTimes(3);
    expect(listGameRecordOutbox()).toHaveLength(0);
  });

  it('survives past this session: after the backoffs run out it stays queued for the next load', async () => {
    apiPost.mockResolvedValue({ data: null, error: 'down', status: 503 });
    saveGameRecord(body);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(apiPost).toHaveBeenCalledTimes(6);
    expect(listGameRecordOutbox()).toHaveLength(1);
  });

  it('drops a record the server refuses for good', async () => {
    apiPost.mockResolvedValue({ data: null, error: 'bad', status: 400 });
    saveGameRecord(body);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(listGameRecordOutbox()).toHaveLength(0);
  });

  it('saves nothing when nobody is signed in', async () => {
    session = null;
    saveGameRecord(body);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiPost).not.toHaveBeenCalled();
    expect(listGameRecordOutbox()).toHaveLength(0);
  });
});
