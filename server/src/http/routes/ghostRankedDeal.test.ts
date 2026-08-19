import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRITZ_ELITE_ID } from '../../ranking/glicko2';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';
import { registerBotMatchesRoutes } from './botMatches';
import { registerGhostRoutes } from './ghost';
import {
  isSafeRankedMoveSequence,
  type RankedDealSnapshot,
  type RankedMoveSequenceEntry,
} from '../../ghost/rankedDealAuthority';
import { mutateOnePlayedTile, playHonestRankedGame } from '../../testing/rankedDealSelfPlay';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const LOCAL_MATCH_ID = 'local-ranked-1';

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

const glickoWrites: Array<Record<string, unknown>> = [];

function makeMatch(overrides: Partial<VerifiedSinglePlayerMatch> = {}): VerifiedSinglePlayerMatch {
  return {
    matchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: USER_ID,
    localMatchId: LOCAL_MATCH_ID,
    mode: 'fritz',
    opponentUserId: FRITZ_ELITE_ID,
    fritzTier: 'elite',
    status: 'started',
    startedAt: new Date().toISOString(),
    completedAt: null,
    completionHash: null,
    completionResult: null,
    dealSnapshot: null,
    ...overrides,
  };
}

function toGhostBodyLog(moveLog: RankedMoveSequenceEntry[]) {
  return moveLog.map((entry) => ({
    turn: entry.turn,
    actor: entry.actor === 'you' ? 'you' : 'ghost',
    board_state: entry.board_state ?? 'board:empty',
    tile_played: entry.tile ?? entry.tile_played ?? null,
    branch: entry.action === 'draw' ? 'draw' : entry.action === 'pass' ? 'pass' : entry.position ?? entry.branch ?? 'left',
    hand_before: entry.hand_before ?? ['0|0'],
    score_delta: entry.score_delta ?? 0,
  }));
}

function mutateFirstMoveActor(moveLog: RankedMoveSequenceEntry[]): RankedMoveSequenceEntry[] {
  const index = moveLog.findIndex((entry) => entry.action === 'play');
  if (index < 0) throw new Error('No play to mutate actor.');
  return moveLog.map((entry, entryIndex) =>
    entryIndex === index
      ? { ...entry, actor: entry.actor === 'you' ? 'ghost' : 'you' }
      : entry,
  );
}

function makeHarness() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => {
      routes.set(`GET ${path}`, handler);
    },
    post: (path: string, handler: RouteHandler) => {
      routes.set(`POST ${path}`, handler);
    },
  };

  const matches = new Map<string, VerifiedSinglePlayerMatch>();
  const completeCalls: Array<Record<string, unknown>> = [];

  const startVerifiedSinglePlayerMatch = vi.fn(async (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
    dealSnapshot?: RankedDealSnapshot | null;
  }) => {
    const existing = [...matches.values()].find(
      (row) => row.userId === params.userId && row.localMatchId === params.localMatchId,
    );
    if (existing) return existing;
    const record = makeMatch({
      userId: params.userId,
      localMatchId: params.localMatchId,
      mode: params.mode,
      opponentUserId: params.opponentUserId,
      fritzTier: params.fritzTier ?? null,
      dealSnapshot: params.dealSnapshot ?? null,
    });
    matches.set(record.matchId, record);
    return record;
  });

  registerBotMatchesRoutes(app as any, {
    getAuthenticatedUserId: async () => USER_ID,
    getAuthenticatedUserIdFromToken: async () => USER_ID,
    supabaseFetch: async () => [],
    isAdminSecret: () => false,
    startVerifiedSinglePlayerMatch,
    abandonVerifiedSinglePlayerMatch: async () => {},
    getFritzIdentityForTier: () => ({ fritzId: FRITZ_ELITE_ID, gameType: 'fritz' }),
    finalizeFritzForfeit: async () => {},
    parseOptionalActivityScore: () => null,
  });

  registerGhostRoutes(app as any, {
    getAuthenticatedUserId: async () => USER_ID,
    isFritzId: (id: string) => id === FRITZ_ELITE_ID,
    getVerifiedSinglePlayerMatch: async (matchId: string) => matches.get(matchId) ?? null,
    persistVerifiedSinglePlayerMatch: async (record) => {
      matches.set(record.matchId, record);
      return record;
    },
    startVerifiedSinglePlayerMatch,
    isSafeGhostMoveLog: (raw): raw is Array<Record<string, unknown>> => Array.isArray(raw) && raw.length > 0,
    buildGhostCompletionHash: () => 'hash',
    writeMatchActivity: async () => null,
    formatFritzActivityOpponentLabel: () => 'Fritz Elite',
    supabaseFetch: async (path: string, init?: RequestInit) => {
      if (String(path).includes('bot_match_pending') && init?.method === 'PATCH') return [];
      if (String(path).includes('bot_match_pending')) return [{ id: 'pending-1', resolved: false }];
      return [];
    },
    completeGhostGame: async (params) => {
      completeCalls.push(params as unknown as Record<string, unknown>);
      if (params.applyGlicko !== false && params.opponentUserId === FRITZ_ELITE_ID) {
        glickoWrites.push({
          playerScore: params.finalScore,
          opponentScore: params.opponentScore,
          matchId: params.matchId,
        });
      }
      return {
        newRating: 800,
        ratingDelta: 0,
        glickoRating: params.applyGlicko === false ? 800 : 810,
        glickoDelta: params.applyGlicko === false ? 0 : 10,
        playerScore: Math.round(params.finalScore),
        ghostScore: Math.round(params.opponentScore),
        playerWon: params.finalScore > params.opponentScore,
        compositeLog: { generatedAt: new Date().toISOString(), sourceGameIds: [], states: [], recentGameStyles: [] },
        styleProfile: null,
      };
    },
  });

  return {
    matches,
    completeCalls,
    startVerifiedSinglePlayerMatch,
    async request(method: 'GET' | 'POST', path: string, body: unknown = {}) {
      const handler = routes.get(`${method} ${path}`);
      if (!handler) throw new Error(`missing route: ${method} ${path}`);
      let statusCode = 200;
      let responseBody: any;
      const res = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (payload: unknown) => {
          responseBody = payload;
          return res;
        },
      };
      await handler({ body, headers: {} }, res);
      return { status: statusCode, body: responseBody };
    },
  };
}

describe('ranked Fritz start/complete deal authority', () => {
  beforeEach(() => {
    glickoWrites.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/bot-matches/local/start persists a server-owned deal and returns it for display', async () => {
    const harness = makeHarness();
    const response = await harness.request('POST', '/api/bot-matches/local/start', {
      userId: USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      fritzTier: 'elite',
      winningScore: 10,
      dealSize: 7,
      matchStarter: 'you',
    });
    expect(response.status).toBe(200);
    expect(response.body.matchId).toEqual(expect.any(String));
    expect(Array.isArray(response.body.playerTiles)).toBe(true);
    expect(response.body.playerTiles).toHaveLength(7);
    expect(response.body.seed).toEqual(expect.any(String));
    const stored = harness.startVerifiedSinglePlayerMatch.mock.calls[0]?.[0];
    expect(stored.dealSnapshot).toBeTruthy();
    expect(stored.dealSnapshot.firstHand.playerTiles).toHaveLength(7);
  });

  it('mutates one tile in a submitted move log and is rejected with no Glicko write', async () => {
    const harness = makeHarness();
    const started = await harness.request('POST', '/api/bot-matches/local/start', {
      userId: USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      fritzTier: 'elite',
      winningScore: 10,
      dealSize: 7,
      matchStarter: 'you',
    });
    const snapshot = harness.startVerifiedSinglePlayerMatch.mock.calls[0]?.[0].dealSnapshot as RankedDealSnapshot;
    const honest = playHonestRankedGame(snapshot);
    const mutated = mutateFirstMoveActor(mutateOnePlayedTile(honest.moveLog));
    expect(isSafeRankedMoveSequence(mutated)).toBe(true);

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: started.body.matchId,
      opponentUserId: FRITZ_ELITE_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 200,
      opponentScore: 0,
      moveLog: toGhostBodyLog(mutated),
      playerMoveLog: toGhostBodyLog(mutated.filter((entry) => entry.actor === 'you')),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(glickoWrites).toEqual([]);
    expect(harness.completeCalls).toEqual([]);
  });

  it('accepts an honest log with the exact engine score and writes Glicko from that score', async () => {
    const harness = makeHarness();
    const started = await harness.request('POST', '/api/bot-matches/local/start', {
      userId: USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      fritzTier: 'elite',
      winningScore: 10,
      dealSize: 7,
      matchStarter: 'you',
    });
    const snapshot = harness.startVerifiedSinglePlayerMatch.mock.calls[0]?.[0].dealSnapshot as RankedDealSnapshot;
    const honest = playHonestRankedGame(snapshot);

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: started.body.matchId,
      opponentUserId: FRITZ_ELITE_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 200,
      opponentScore: 0,
      moveLog: toGhostBodyLog(honest.moveLog),
      playerMoveLog: toGhostBodyLog(honest.moveLog.filter((entry) => entry.actor === 'you')),
    });

    expect(response.status).toBe(200);
    expect(response.body.result.playerScore).toBe(honest.playerScore);
    expect(response.body.result.ghostScore).toBe(honest.opponentScore);
    expect(harness.completeCalls).toHaveLength(1);
    expect(harness.completeCalls[0]?.finalScore).toBe(honest.playerScore);
    expect(harness.completeCalls[0]?.opponentScore).toBe(honest.opponentScore);
    expect(harness.completeCalls[0]?.applyGlicko).not.toBe(false);
    expect(glickoWrites).toEqual([
      {
        playerScore: honest.playerScore,
        opponentScore: honest.opponentScore,
        matchId: started.body.matchId,
      },
    ]);
  });

  it('grandfathers a ranked match missing a snapshot as unranked with no Glicko write', async () => {
    const harness = makeHarness();
    const match = makeMatch({ dealSnapshot: null });
    harness.matches.set(match.matchId, match);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: match.matchId,
      opponentUserId: FRITZ_ELITE_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [
        {
          turn: 1,
          actor: 'you',
          board_state: 'board:empty',
          tile_played: '3|3',
          branch: 'left',
          hand_before: ['3|3'],
          score_delta: 0,
        },
      ],
      playerMoveLog: [
        {
          turn: 1,
          actor: 'you',
          board_state: 'board:empty',
          tile_played: '3|3',
          branch: 'left',
          hand_before: ['3|3'],
          score_delta: 0,
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(glickoWrites).toEqual([]);
    expect(harness.completeCalls[0]?.applyGlicko).toBe(false);
    expect(warn.mock.calls.some((args) => String(args[0]).includes('missing deal snapshot'))).toBe(true);
    warn.mockRestore();
  });
});

const OPPONENT_USER_ID = '22222222-2222-4222-8222-222222222222';

describe('ranked non-Fritz Ghost start/complete deal authority', () => {
  beforeEach(() => {
    glickoWrites.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mutates one tile in a submitted non-Fritz Ghost move log and is rejected with no rating write', async () => {
    const harness = makeHarness();
    const started = await harness.request('POST', '/api/ghost/start', {
      userId: USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      opponentUserId: OPPONENT_USER_ID,
      winningScore: 10,
      dealSize: 7,
      matchStarter: 'you',
    });
    expect(started.status).toBe(200);
    const snapshot = harness.startVerifiedSinglePlayerMatch.mock.calls[0]?.[0].dealSnapshot as RankedDealSnapshot;
    const honest = playHonestRankedGame(snapshot);
    const mutated = mutateFirstMoveActor(mutateOnePlayedTile(honest.moveLog));

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: started.body.matchId,
      opponentUserId: OPPONENT_USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 200,
      opponentScore: 0,
      moveLog: toGhostBodyLog(mutated),
      playerMoveLog: toGhostBodyLog(mutated.filter((entry) => entry.actor === 'you')),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(glickoWrites).toEqual([]);
    expect(harness.completeCalls).toEqual([]);
  });

  it('accepts an honest non-Fritz Ghost log and applies rating from the exact replayed score, not the submitted finalScore', async () => {
    const harness = makeHarness();
    const started = await harness.request('POST', '/api/ghost/start', {
      userId: USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      opponentUserId: OPPONENT_USER_ID,
      winningScore: 10,
      dealSize: 7,
      matchStarter: 'you',
    });
    const snapshot = harness.startVerifiedSinglePlayerMatch.mock.calls[0]?.[0].dealSnapshot as RankedDealSnapshot;
    const honest = playHonestRankedGame(snapshot);

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: started.body.matchId,
      opponentUserId: OPPONENT_USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 199,
      opponentScore: 199,
      moveLog: toGhostBodyLog(honest.moveLog),
      playerMoveLog: toGhostBodyLog(honest.moveLog.filter((entry) => entry.actor === 'you')),
    });

    expect(response.status).toBe(200);
    expect(harness.completeCalls).toHaveLength(1);
    expect(harness.completeCalls[0]?.finalScore).toBe(honest.playerScore);
    expect(harness.completeCalls[0]?.opponentScore).toBe(honest.opponentScore);
    expect(harness.completeCalls[0]?.applyGlicko).not.toBe(false);
  });

  it('fails closed on a non-Fritz Ghost match missing a snapshot: no rating write, not a trust fallback to client score', async () => {
    const harness = makeHarness();
    const match = makeMatch({ mode: 'ghost', opponentUserId: OPPONENT_USER_ID, dealSnapshot: null });
    harness.matches.set(match.matchId, match);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await harness.request('POST', '/api/ghost/complete', {
      userId: USER_ID,
      matchId: match.matchId,
      opponentUserId: OPPONENT_USER_ID,
      localMatchId: LOCAL_MATCH_ID,
      finalScore: 60,
      opponentScore: 10,
      moveLog: [
        {
          turn: 1,
          actor: 'you',
          board_state: 'board:empty',
          tile_played: '3|3',
          branch: 'left',
          hand_before: ['3|3'],
          score_delta: 0,
        },
      ],
      playerMoveLog: [
        {
          turn: 1,
          actor: 'you',
          board_state: 'board:empty',
          tile_played: '3|3',
          branch: 'left',
          hand_before: ['3|3'],
          score_delta: 0,
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(harness.completeCalls[0]?.applyGlicko).toBe(false);
    warn.mockRestore();
  });
});
