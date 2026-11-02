import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const { authUserMock, getAttemptByIdMock, getRunMock, listAttemptsMock, loadRecordsMock, listDigestsMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getRunMock: vi.fn(),
  listAttemptsMock: vi.fn(),
  loadRecordsMock: vi.fn(),
  listDigestsMock: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));
vi.mock('../stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined),
  countRecentDailyFritzVerificationFailures: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: authUserMock }));
vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>('../stores/dailyFritzStore');
  return { ...actual, getDailyFritzAttemptById: getAttemptByIdMock, getDailyFritzRun: getRunMock, listDailyFritzAttemptsForUser: listAttemptsMock };
});
vi.mock('../../dailyFritzHandRecords', async () => {
  const actual = await vi.importActual<typeof import('../../dailyFritzHandRecords')>('../../dailyFritzHandRecords');
  return { ...actual, loadDailyFritzHandRecords: loadRecordsMock, listDailyFritzHandDigests: listDigestsMock };
});
vi.mock('./dailyFritzPublishedAuthority', () => ({ loadDailyFritzPublishedAuthority: vi.fn().mockResolvedValue(null) }));

import { registerDailyFritzGameRecordRoutes } from './dailyFritzGameRecordRoute';
import { ATTEMPT_ID, USER_ID, run, verifiedGame } from '../../dailyFritzVerifiedGame.testkit';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function harness() {
  const routes = new Map<string, Handler>();
  registerDailyFritzGameRecordRoutes({ get: (path: string, h: Handler) => routes.set(`GET ${path}`, h) } as unknown as Application);
  return async (path: string, query: Record<string, string> = {}) => {
    const handler = routes.get(`GET ${path}`);
    if (!handler) throw new Error(`Missing route GET ${path}`);
    let status = 200;
    let body: any;
    const headers: Record<string, string> = {};
    const res = {
      headersSent: false,
      locals: {},
      getHeader: () => undefined,
      setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
      status(code: number) { status = code; return res; },
      json(payload: unknown) { body = payload; return res; },
    };
    await handler({ query, headers: {}, params: {} }, res);
    return { status, body, headers };
  };
}

const game1 = verifiedGame(1, 'first_legal');
const hand1 = game1.attempt;

describe('GET /api/daily-fritz/games and /game-record (DF-3b)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('both refuse a signed-out request', async () => {
    authUserMock.mockResolvedValue(null);
    const get = harness();
    expect((await get('/api/daily-fritz/games')).status).toBe(401);
    expect((await get('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '1' })).status).toBe(401);
    expect(loadRecordsMock).not.toHaveBeenCalled();
  });

  it('lists the signed-in player\'s verified games with whether each can be reviewed', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    listAttemptsMock.mockResolvedValue([hand1]);
    listDigestsMock.mockResolvedValue(game1.rows.map((r) => ({ attempt_id: ATTEMPT_ID, game_number: 1, transcript_digest: r.transcript_digest })));
    const { status, body, headers } = await harness()('/api/daily-fritz/games');
    expect(status).toBe(200);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(listAttemptsMock).toHaveBeenCalledWith(USER_ID, 30);
    expect(listDigestsMock).toHaveBeenCalledWith(USER_ID, [ATTEMPT_ID]);
    expect(body.games).toEqual([
      expect.objectContaining({ sourceMatchId: `dfz:${ATTEMPT_ID}:1`, attemptId: ATTEMPT_ID, gameNumber: 1, hands: game1.rows.length, reviewable: true, result: expect.objectContaining({ you: game1.you, opponent: game1.fritz }) }),
    ]);
  });

  it('marks a game not reviewable when a hand was not kept (played before hands were stored)', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    listAttemptsMock.mockResolvedValue([hand1]);
    listDigestsMock.mockResolvedValue(game1.rows.slice(1).map((r) => ({ attempt_id: ATTEMPT_ID, game_number: 1, transcript_digest: r.transcript_digest })));
    const { body } = await harness()('/api/daily-fritz/games');
    expect(body.games[0].reviewable).toBe(false);
  });

  it('returns one game in full, reading only the signed-in player\'s own stored hands', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    getAttemptByIdMock.mockResolvedValue(hand1);
    getRunMock.mockResolvedValue(run);
    loadRecordsMock.mockResolvedValue(game1.rows);
    const { status, body, headers } = await harness()('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '1' });
    expect(status).toBe(200);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(getAttemptByIdMock).toHaveBeenCalledWith(ATTEMPT_ID, USER_ID);
    expect(loadRecordsMock).toHaveBeenCalledWith(USER_ID, ATTEMPT_ID, 1);
    expect(body).toMatchObject({ mode: 'dfz', opponentName: 'Fritz', verification: 'replay_verified', result: { you: game1.you, opponent: game1.fritz } });
    expect(body.record.players).toEqual(['you', 'opponent']);
  });

  it('treats a bad request as 400 and someone else\'s attempt as not found', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    const get = harness();
    expect((await get('/api/daily-fritz/game-record', { attempt_id: 'nope', game_number: '1' })).status).toBe(400);
    expect((await get('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '7' })).status).toBe(400);
    getAttemptByIdMock.mockResolvedValue(null);
    const other = await get('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '1' });
    expect(other.status).toBe(404);
    expect(loadRecordsMock).not.toHaveBeenCalled();
  });

  it('says why a game cannot be reviewed instead of failing', async () => {
    authUserMock.mockResolvedValue(USER_ID);
    getAttemptByIdMock.mockResolvedValue(hand1);
    getRunMock.mockResolvedValue(run);
    loadRecordsMock.mockResolvedValue([]);
    const { status, body } = await harness()('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '1' });
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Review is not available for this game.', reason: 'missing_hand_record:0' });
  });

  it('an internal failure answers 500 with a fixed sentence, never the underlying error text (as in production)', async () => {
    vi.stubEnv('NODE_ENV', 'production'); // the shared helper shows the real message only while developing
    authUserMock.mockResolvedValue(USER_ID);
    getAttemptByIdMock.mockResolvedValue(hand1);
    getRunMock.mockResolvedValue(run);
    loadRecordsMock.mockRejectedValue(new Error('connection string postgres://secret-host failed'));
    const { status, body } = await harness()('/api/daily-fritz/game-record', { attempt_id: ATTEMPT_ID, game_number: '1' });
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/secret-host|postgres/);
    expect(body.error).toBe('Failed to read the game.');
  });
});
