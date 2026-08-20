import { describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import type { PersistedRoomMatchLogRow } from '../../multiplayer/roomMatchLogPersistence';
import { RANKING_NOT_UPDATED_COPY } from '../../multiplayer/rankingOutcome';
import { registerPrivateMatchResultRoutes } from './privateMatchResult';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const VIEWER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPPONENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH_ID = '11111111-1111-4111-8111-111111111111';

function archive(overrides: Partial<PersistedRoomMatchLogRow> = {}): PersistedRoomMatchLogRow {
  return {
    match_id: MATCH_ID,
    room_code: 'ROOM1',
    status: 'completed',
    event_log_version: 1,
    last_event_sequence: 4,
    event_count: 4,
    started_at: '2026-08-19T00:00:00.000Z',
    archived_at: '2026-08-19T00:10:00.000Z',
    participant_user_ids: [VIEWER_ID, OPPONENT_ID],
    participants: [
      { id: 'seat-a', username: 'Alice', userId: VIEWER_ID, seatIndex: 0 },
      { id: 'seat-b', username: 'Bob', userId: OPPONENT_ID, seatIndex: 1 },
    ],
    summary: {
      status: 'completed',
      winnerId: 'seat-a',
      scores: { 'seat-a': 60, 'seat-b': 42 },
      rankingOutcome: {
        glickoEligible: true,
        glickoApplied: true,
        skipReason: null,
      },
    },
    state_snapshot: { secret: 'must-not-leak' },
    events: [{ type: 'must-not-leak' } as never],
    ...overrides,
  };
}

function makeHarness(options: {
  userId?: string | null;
  log?: PersistedRoomMatchLogRow | null;
  rankedGame?: { player_id: string; rating_before: number; rating_after: number; delta: number } | null;
  persistenceAvailable?: boolean;
} = {}) {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
  };

  const authenticatedUserId = Object.prototype.hasOwnProperty.call(options, 'userId')
    ? options.userId ?? null
    : VIEWER_ID;
  const log = Object.prototype.hasOwnProperty.call(options, 'log') ? options.log ?? null : archive();

  registerPrivateMatchResultRoutes(app as unknown as Application, {
    getAuthenticatedUserId: async () => authenticatedUserId,
    queryPersistedRoomMatchLog: async () => log,
    queryLatestPersistedRoomMatchLogByRoomCode: async () => log,
    isRoomMatchLogsPersistenceAvailable: () => options.persistenceAvailable ?? true,
    queryRankedGameForMatch: async () =>
      Object.prototype.hasOwnProperty.call(options, 'rankedGame')
        ? options.rankedGame ?? null
        : {
            player_id: VIEWER_ID,
            rating_before: 1500,
            rating_after: 1512,
            delta: 12,
          },
  });

  return async function request(query: Record<string, string> = { roomCode: 'ROOM1' }) {
    const handler = routes.get('GET /api/private-match/result');
    if (!handler) throw new Error('Missing private match result route');
    let status = 200;
    let body: unknown;
    const headers: Record<string, string> = {};
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      json(value: unknown) {
        body = value;
        return res;
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    };
    await handler({ query, headers: {}, params: {}, body: {}, method: 'GET' }, res);
    return { status, body, headers };
  };
}

describe('GET /api/private-match/result', () => {
  it('returns the product result shape for a participant, without events or state_snapshot', async () => {
    const request = makeHarness();
    const response = await request({ matchId: MATCH_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      result: {
        matchId: MATCH_ID,
        roomCode: 'ROOM1',
        terminalStatus: 'completed',
        archivedAt: '2026-08-19T00:10:00.000Z',
        you: { seatId: 'seat-a', userId: VIEWER_ID, username: 'Alice' },
        opponent: { seatId: 'seat-b', userId: OPPONENT_ID, username: 'Bob' },
        outcome: 'win',
        yourScore: 60,
        opponentScore: 42,
        ranking: {
          eligible: true,
          applied: true,
          skipReason: null,
          message: null,
          ratingBefore: 1500,
          ratingAfter: 1512,
          ratingDelta: 12,
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    expect(JSON.stringify(response.body)).not.toContain('state_snapshot');
    expect(JSON.stringify(response.body)).not.toContain('"events"');
  });

  it('returns 403 when an authenticated user is not a participant', async () => {
    const request = makeHarness({ userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    await expect(request({ roomCode: 'ROOM1' })).resolves.toMatchObject({
      status: 403,
      body: { error: 'Forbidden' },
    });
  });

  it('returns 401 when unauthenticated', async () => {
    const request = makeHarness({ userId: null });
    await expect(request({ roomCode: 'ROOM1' })).resolves.toMatchObject({
      status: 401,
      body: { error: 'Unauthorized' },
    });
  });

  it('returns 404 when no archive exists for the given id', async () => {
    const request = makeHarness({ log: null });
    await expect(request({ matchId: MATCH_ID })).resolves.toMatchObject({
      status: 404,
      body: { error: 'Match result not found.' },
    });
  });

  it('reports verification-skipped ranking with the neutral copy field', async () => {
    const request = makeHarness({
      rankedGame: null,
      log: archive({
        summary: {
          status: 'completed',
          winnerId: 'seat-a',
          scores: { 'seat-a': 60, 'seat-b': 42 },
          rankingOutcome: {
            glickoEligible: false,
            glickoApplied: false,
            skipReason: 'move_log_verification_failed',
          },
        },
      }),
    });

    const response = await request({ roomCode: 'ROOM1' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      result: {
        ranking: {
          eligible: false,
          applied: false,
          skipReason: 'move_log_verification_failed',
          message: RANKING_NOT_UPDATED_COPY,
          ratingBefore: null,
          ratingAfter: null,
          ratingDelta: null,
        },
      },
    });
  });

  /**
   * P1 scope is authed-only. Guests have `userId: null`, so they never appear in
   * `participant_user_ids`. Without a JWT they get 401. If they later sign in,
   * that new UUID is still not on the archive, so they get 403 — same as any
   * non-participant. They cannot recover a private-match result through this
   * endpoint.
   */
  it('treats guest seats as out of scope: unauthenticated 401, later account 403', async () => {
    const guestArchive = archive({
      participant_user_ids: [VIEWER_ID],
      participants: [
        { id: 'seat-a', username: 'Alice', userId: VIEWER_ID, seatIndex: 0 },
        { id: 'seat-b', username: 'Guest', userId: null, seatIndex: 1 },
      ],
    });

    const unauthenticated = makeHarness({ userId: null, log: guestArchive });
    await expect(unauthenticated({ roomCode: 'ROOM1' })).resolves.toMatchObject({
      status: 401,
      body: { error: 'Unauthorized' },
    });

    const laterAccount = makeHarness({
      userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      log: guestArchive,
    });
    await expect(laterAccount({ roomCode: 'ROOM1' })).resolves.toMatchObject({
      status: 403,
      body: { error: 'Forbidden' },
    });
  });
});
