import { describe, expect, it, vi } from 'vitest';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';
import type { GhostCompositeLog } from '../../ghost/service';
import { completionResultForStorage, registerGhostRoutes } from './ghost';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

function compositeLog(states: number): GhostCompositeLog {
  return {
    generatedAt: '2026-10-05T00:00:00.000Z',
    sourceGameIds: ['g1'],
    states: Array.from({ length: states }, (_, i) => ({ key: `k${i}`, boardState: 'b', turn: i, candidates: [] })) as never,
    recentGameStyles: [],
  };
}

function makeHarness(options: {
  stored?: Partial<VerifiedSinglePlayerMatch>;
  summary?: () => Promise<{ compositeLog: GhostCompositeLog | null }>;
}) {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
  };
  const record: VerifiedSinglePlayerMatch = {
    matchId: MATCH_ID,
    userId: USER_ID,
    localMatchId: null,
    mode: 'ghost',
    opponentUserId: OPPONENT_ID,
    fritzTier: null,
    status: 'started',
    startedAt: '2026-10-05T00:00:00.000Z',
    completedAt: null,
    completionHash: null,
    completionResult: null,
    dealSnapshot: null,
    ...options.stored,
  };
  const persisted: VerifiedSinglePlayerMatch[] = [];
  const getGhostProfileSummary = vi.fn(options.summary ?? (async () => ({ compositeLog: compositeLog(2) })));

  registerGhostRoutes(app as any, {
    getAuthenticatedUserId: async () => USER_ID,
    isFritzId: () => false,
    getVerifiedSinglePlayerMatch: async () => record,
    persistVerifiedSinglePlayerMatch: async (row) => {
      persisted.push(structuredClone(row));
      return row;
    },
    startVerifiedSinglePlayerMatch: async () => record,
    isSafeGhostMoveLog: (raw): raw is Array<Record<string, unknown>> => Array.isArray(raw) && raw.length > 0,
    buildGhostCompletionHash: () => 'hash',
    writeMatchActivity: async () => null,
    formatFritzActivityOpponentLabel: () => 'Fritz',
    supabaseFetch: async () => [] as never,
    completeGhostGame: async (params) => ({
      newRating: 812,
      ratingDelta: 12,
      glickoRating: null,
      glickoDelta: null,
      playerScore: Math.round(params.finalScore),
      ghostScore: Math.round(params.opponentScore),
      playerWon: params.finalScore > params.opponentScore,
      compositeLog: compositeLog(144),
      styleProfile: null,
    }),
    getGhostProfileSummary: getGhostProfileSummary as never,
  });

  async function complete() {
    const handler = routes.get('POST /api/ghost/complete');
    if (!handler) throw new Error('missing route');
    let status = 200;
    let body: any;
    const res = {
      status: (code: number) => {
        status = code;
        return res;
      },
      json: (payload: unknown) => {
        body = payload;
        return res;
      },
    };
    await handler(
      {
        headers: {},
        body: {
          userId: USER_ID,
          matchId: MATCH_ID,
          opponentUserId: OPPONENT_ID,
          finalScore: 30,
          opponentScore: 12,
          moveLog: [{ turn: 1, actor: 'you', board_state: 'b', tile_played: '1|1', branch: 'left', hand_before: ['1|1'], score_delta: 0 }],
        },
      },
      res,
    );
    return { status, body };
  }

  return { complete, persisted, record, getGhostProfileSummary };
}

describe('completionResultForStorage', () => {
  it('drops compositeLog and keeps every other field', () => {
    expect(completionResultForStorage({ newRating: 1, compositeLog: compositeLog(3), styleProfile: null })).toEqual({
      newRating: 1,
      styleProfile: null,
    });
  });
});

describe('ghost completion storage (S2)', () => {
  it('returns the full result to the client but stores it without compositeLog', async () => {
    const harness = makeHarness({});
    const response = await harness.complete();

    expect(response.status).toBe(200);
    expect(response.body.result.compositeLog.states).toHaveLength(144);
    const stored = harness.persisted.at(-1)?.completionResult;
    expect(stored).toMatchObject({ newRating: 812, ratingDelta: 12, playerWon: true });
    expect(stored).not.toHaveProperty('compositeLog');
  });

  it('a replay of a new-style row rebuilds compositeLog from the profile summary, same response shape', async () => {
    const harness = makeHarness({});
    await harness.complete();
    const replay = await harness.complete();

    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.result).toMatchObject({ newRating: 812, ratingDelta: 12, playerWon: true });
    expect(replay.body.result.compositeLog.states).toHaveLength(2);
    expect(harness.getGhostProfileSummary).toHaveBeenCalledWith(USER_ID);
  });

  it('a replay of an old row that still stores compositeLog returns it unchanged without reading the profile', async () => {
    const harness = makeHarness({
      stored: {
        status: 'completed',
        completionHash: 'hash',
        completionResult: { newRating: 700, compositeLog: compositeLog(5) },
      },
    });
    const replay = await harness.complete();

    expect(replay.body.result.compositeLog.states).toHaveLength(5);
    expect(harness.getGhostProfileSummary).not.toHaveBeenCalled();
  });

  it('a replay still answers when the profile summary fails or has no log', async () => {
    for (const summary of [
      async () => {
        throw new Error('supabase down');
      },
      async () => ({ compositeLog: null }),
    ]) {
      const harness = makeHarness({
        stored: { status: 'completed', completionHash: 'hash', completionResult: { newRating: 700 } },
        summary,
      });
      const replay = await harness.complete();
      expect(replay.status).toBe(200);
      expect(replay.body.result.newRating).toBe(700);
      expect(replay.body.result.compositeLog).toEqual(
        expect.objectContaining({ states: [], sourceGameIds: [], recentGameStyles: [] }),
      );
    }
  });
});
