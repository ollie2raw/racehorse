import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRankedDealSnapshot, type RankedDealSnapshot, type RankedMoveSequenceEntry } from '../ghost/rankedDealAuthority';
import { playHonestGhostShapedGame } from '../testing/rankedDealSelfPlay';
import { buildGameRecordInsertPayload, parseGameRecordRequestBody } from './gameRecordPayload';
import { verifyGameRecord } from './verifyGameRecord';
import { registerGameRecordsRoute } from '../http/routes/gameRecordsRoute';
import { GAME_RECORD_LIST_DEFAULT_LIMIT, GAME_RECORD_LIST_MAX_LIMIT, clampGameRecordListLimit } from './queryGameRecords';

const USER = 'record-user-1';
let requestUser: string | null = USER;
let verifiedMatch: { mode: 'fritz' | 'ghost'; dealSnapshot: RankedDealSnapshot | null } | null = null;
const supabaseFetch = vi.fn();

vi.mock('../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: async () => requestUser }));
vi.mock('../shared/verifiedSinglePlayerMatch', () => ({
  queryVerifiedSinglePlayerMatchByLocalKey: async () => verifiedMatch,
}));
vi.mock('../supabaseUtils', () => ({ supabaseFetch: (...args: unknown[]) => supabaseFetch(...args) }));

/** The compact entries the client sends: only what a replay needs. */
function compact(moveLog: RankedMoveSequenceEntry[]): RankedMoveSequenceEntry[] {
  return moveLog.map((entry) => ({
    turn: entry.turn,
    // The client labels Fritz's actions 'fritz'; the self-play helper says 'ghost'. Use the client's label.
    actor: entry.actor === 'you' ? 'you' : 'fritz',
    tile_played: entry.tile_played ?? null,
    branch: entry.branch ?? null,
    score_delta: entry.score_delta ?? 0,
  }));
}

/** Replace the tile of the first play with a different tile: still a well-formed move, but not one that was dealt. */
function tamper(moves: RankedMoveSequenceEntry[]): RankedMoveSequenceEntry[] {
  const index = moves.findIndex((entry) => entry.tile_played);
  if (index < 0) throw new Error('No play to tamper with.');
  const original = moves[index]!.tile_played;
  return moves.map((entry, i) => (i === index ? { ...entry, tile_played: original === '0|0' ? '6|6' : '0|0' } : entry));
}

function honestGame(seed = 'record-seed-1') {
  const { snapshot } = createRankedDealSnapshot({ seed, dealSize: 7, winningScore: 60, matchStarter: 'you' });
  const honest = playHonestGhostShapedGame(snapshot);
  return { snapshot, honest, moves: compact(honest.moveLog) };
}

function body(overrides: Record<string, unknown> = {}) {
  const { honest, moves } = honestGame();
  return {
    sourceMatchId: 'match-1',
    localMatchId: 'local-1',
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    matchStarter: 'you',
    dealSeed: 'record-seed-1',
    result: { you: honest.playerScore, opponent: honest.opponentScore, winner: honest.playerScore > honest.opponentScore ? 'you' : 'opponent' },
    moves,
    playedAt: '2026-11-01T01:00:00.000Z',
    ...overrides,
  };
}

describe('parseGameRecordRequestBody', () => {
  it('accepts a complete record and normalizes it', () => {
    const parsed = parseGameRecordRequestBody(body(), USER);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.userId).toBe(USER);
    expect(parsed.sourceMatchId).toBe('match-1');
    expect(parsed.moves.length).toBeGreaterThan(10);
    expect(parsed.playedAt).toBe('2026-11-01T01:00:00.000Z');
  });

  it('accepts an unranked record with no local match id or deal seed', () => {
    const parsed = parseGameRecordRequestBody(body({ localMatchId: null, dealSeed: null, dealSize: null }), USER);
    expect('error' in parsed).toBe(false);
  });

  it.each([
    ['a missing source match id', { sourceMatchId: '' }],
    ['an unknown mode', { mode: 'mp' }],
    ['a score out of range', { result: { you: 999, opponent: 3, winner: 'you' } }],
    ['a non-integer score', { result: { you: 3.5, opponent: 3, winner: 'you' } }],
    ['an invalid deal size', { dealSize: 9 }],
    ['an invalid starter', { matchStarter: 'fritz' }],
    ['no moves', { moves: [] }],
    ['moves that are not a sequence', { moves: [{ nope: true }] }],
    ['an unparseable playedAt', { playedAt: 'yesterday' }],
    ['an over-long id', { sourceMatchId: 'x'.repeat(200) }],
  ])('rejects %s', (_label, overrides) => {
    expect('error' in parseGameRecordRequestBody(body(overrides as Record<string, unknown>), USER)).toBe(true);
  });

  it('rejects a body that is not an object', () => {
    expect('error' in parseGameRecordRequestBody(null, USER)).toBe(true);
    expect('error' in parseGameRecordRequestBody('x', USER)).toBe(true);
  });

  it('builds the row the migration expects', () => {
    const parsed = parseGameRecordRequestBody(body(), USER);
    if ('error' in parsed) throw new Error(parsed.error);
    const row = buildGameRecordInsertPayload(parsed, 'replay_verified');
    expect(row).toMatchObject({
      user_id: USER,
      source_match_id: 'match-1',
      local_match_id: 'local-1',
      mode: 'pvf',
      deal_size: 7,
      record_version: 1,
      verification: 'replay_verified',
    });
    expect(row.move_count).toBe(parsed.moves.length);
  });
});

describe('verifyGameRecord', () => {
  beforeEach(() => { verifiedMatch = null; });

  function parsedRecord(overrides: Record<string, unknown> = {}) {
    const parsed = parseGameRecordRequestBody(body(overrides), USER);
    if ('error' in parsed) throw new Error(parsed.error);
    return parsed;
  }

  it('verifies a record that replays from the server-owned deal to the same score', async () => {
    verifiedMatch = { mode: 'fritz', dealSnapshot: honestGame().snapshot };
    expect(await verifyGameRecord(parsedRecord())).toBe('replay_verified');
  });

  it('flags a record whose actions were tampered with', async () => {
    const { snapshot, moves } = honestGame();
    verifiedMatch = { mode: 'fritz', dealSnapshot: snapshot };
    const tampered = parsedRecord({ moves: tamper(moves) });
    expect(await verifyGameRecord(tampered)).toBe('replay_mismatch');
  });

  it('flags a record whose claimed score does not match the replay', async () => {
    verifiedMatch = { mode: 'fritz', dealSnapshot: honestGame().snapshot };
    const { honest } = honestGame();
    const wrong = parsedRecord({ result: { you: honest.playerScore + 5, opponent: honest.opponentScore, winner: 'you' } });
    expect(await verifyGameRecord(wrong)).toBe('replay_mismatch');
  });

  it('is honestly unverified without a local match id, a verified match, or a server-owned deal', async () => {
    expect(await verifyGameRecord(parsedRecord({ localMatchId: null }))).toBe('unverified');
    verifiedMatch = null;
    expect(await verifyGameRecord(parsedRecord())).toBe('unverified');
    verifiedMatch = { mode: 'fritz', dealSnapshot: null };
    expect(await verifyGameRecord(parsedRecord())).toBe('unverified');
    verifiedMatch = { mode: 'ghost', dealSnapshot: honestGame().snapshot };
    expect(await verifyGameRecord(parsedRecord())).toBe('unverified');
  });
});

describe('POST /api/game-records', () => {
  let server: Server;
  let apiBase: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerGameRecordsRoute(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind');
    apiBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    requestUser = USER;
    verifiedMatch = { mode: 'fritz', dealSnapshot: honestGame().snapshot };
    supabaseFetch.mockReset();
  });

  const post = (payload: unknown) => fetch(`${apiBase}/api/game-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  it('requires a signed-in user', async () => {
    requestUser = null;
    expect((await post(body())).status).toBe(401);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid record with 400 and stores nothing', async () => {
    expect((await post(body({ moves: [] }))).status).toBe(400);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('stores a verified record and answers 201', async () => {
    supabaseFetch.mockResolvedValue([{ id: 'row-1', user_id: USER, source_match_id: 'match-1', verification: 'replay_verified' }]);
    const response = await post(body());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ isNew: true, sourceMatchId: 'match-1', verification: 'replay_verified' });
    const [path, init] = supabaseFetch.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(path).toContain('on_conflict=user_id,source_match_id');
    expect(init.headers.Prefer).toContain('ignore-duplicates');
    const row = JSON.parse(init.body) as { user_id: string; verification: string };
    expect(row.user_id).toBe(USER);
    expect(row.verification).toBe('replay_verified');
  });

  it('stores a mismatching record anyway, flagged, so the game is never lost', async () => {
    supabaseFetch.mockResolvedValue([{ id: 'row-2', user_id: USER, source_match_id: 'match-1', verification: 'replay_mismatch' }]);
    const { honest } = honestGame();
    const response = await post(body({ result: { you: honest.playerScore + 5, opponent: honest.opponentScore, winner: 'you' } }));
    expect(response.status).toBe(201);
    const row = JSON.parse((supabaseFetch.mock.calls[0] as [string, { body: string }])[1].body) as { verification: string };
    expect(row.verification).toBe('replay_mismatch');
  });

  it('answers 200 for a game that is already saved (idempotent retry)', async () => {
    supabaseFetch.mockResolvedValue([]);
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ isNew: false });
  });

  it('answers 500 when the database write fails, so the client keeps retrying', async () => {
    supabaseFetch.mockRejectedValue(new Error('relation "public.game_records" does not exist'));
    expect((await post(body())).status).toBe(500);
  });
});

const STORED_ROW = {
  source_match_id: 'match-9',
  local_match_id: 'local-9',
  mode: 'pvf',
  fritz_tier: 'elite',
  deal_size: 7,
  winning_score: 60,
  match_starter: 'you',
  deal_seed: 'seed-9',
  result: { you: 61, opponent: 40, winner: 'you' },
  moves: [{ turn: 1, actor: 'you', tile_played: '6|6', branch: 'left' }],
  move_count: 1,
  record_version: 1,
  verification: 'replay_verified',
  played_at: '2026-11-01T01:00:00.000Z',
  created_at: '2026-11-01T01:00:05.000Z',
};

describe('clampGameRecordListLimit', () => {
  it('defaults, floors and caps the page size', () => {
    expect(clampGameRecordListLimit(undefined)).toBe(GAME_RECORD_LIST_DEFAULT_LIMIT);
    expect(clampGameRecordListLimit('abc')).toBe(GAME_RECORD_LIST_DEFAULT_LIMIT);
    expect(clampGameRecordListLimit('0')).toBe(GAME_RECORD_LIST_DEFAULT_LIMIT);
    expect(clampGameRecordListLimit('-5')).toBe(GAME_RECORD_LIST_DEFAULT_LIMIT);
    expect(clampGameRecordListLimit('7')).toBe(7);
    expect(clampGameRecordListLimit('100000')).toBe(GAME_RECORD_LIST_MAX_LIMIT);
  });
});

describe('GET /api/game-records', () => {
  let server: Server;
  let apiBase: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerGameRecordsRoute(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind');
    apiBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    requestUser = USER;
    supabaseFetch.mockReset();
  });

  it('requires a signed-in user for both reads', async () => {
    requestUser = null;
    expect((await fetch(`${apiBase}/api/game-records/recent`)).status).toBe(401);
    expect((await fetch(`${apiBase}/api/game-records/match-9`)).status).toBe(401);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  /** Answers the records query and the reviews query separately, by which table the path asks for. */
  const answer = (rows: { records?: unknown[]; reviews?: unknown[] }) => {
    supabaseFetch.mockImplementation(async (path: string) => (path.includes('/game_reviews?') ? (rows.reviews ?? []) : (rows.records ?? [])));
  };
  const reviewCalls = () => supabaseFetch.mock.calls.map((call) => (call as [string])[0]).filter((path) => path.includes('/game_reviews?'));

  it('lists the caller\'s games newest first, without the actions or the deal seed', async () => {
    answer({ records: [STORED_ROW] });
    const response = await fetch(`${apiBase}/api/game-records/recent?limit=5`);
    expect(response.status).toBe(200);
    const { games } = await response.json() as { games: Array<Record<string, unknown>> };
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ sourceMatchId: 'match-9', verification: 'replay_verified', moveCount: 1, savedAt: '2026-11-01T01:00:05.000Z' });
    expect(games[0]).not.toHaveProperty('moves');
    expect(games[0]).not.toHaveProperty('dealSeed');
    expect(games[0]).toMatchObject({ review: null });
    const path = (supabaseFetch.mock.calls[0] as [string])[0];
    expect(path).toContain(`user_id=eq.${USER}`);
    expect(path).toContain('order=created_at.desc');
    expect(path).toContain('limit=5');
  });

  it('attaches each game\'s saved review (id, accuracy, grade), joined on the server', async () => {
    answer({
      records: [STORED_ROW, { ...STORED_ROW, source_match_id: 'match-8' }],
      reviews: [{ id: 'review-9', source_match_id: 'match-9', accuracy: 91.2, grade: 'A' }],
    });
    const { games } = await (await fetch(`${apiBase}/api/game-records/recent`)).json() as { games: Array<{ sourceMatchId: string; review: unknown }> };
    expect(games.find((g) => g.sourceMatchId === 'match-9')?.review).toEqual({ id: 'review-9', accuracy: 91.2, grade: 'A' });
    expect(games.find((g) => g.sourceMatchId === 'match-8')?.review).toBeNull();
  });

  it('looks reviews up scoped to the caller, only reopenable ones, in one query for the whole page', async () => {
    answer({ records: [STORED_ROW, { ...STORED_ROW, source_match_id: 'match-8' }] });
    await fetch(`${apiBase}/api/game-records/recent`);
    expect(reviewCalls()).toHaveLength(1);
    const path = reviewCalls()[0]!;
    expect(path).toContain(`user_id=eq.${USER}`);
    expect(path).toContain('replay_artifact=not.is.null');
    expect(path).toContain('order=created_at.desc');
    expect(path).toContain(`source_match_id=in.(${encodeURIComponent('"match-9"')},${encodeURIComponent('"match-8"')})`);
  });

  it('keeps the newest review when a game has more than one', async () => {
    answer({
      records: [STORED_ROW],
      reviews: [
        { id: 'newer', source_match_id: 'match-9', accuracy: 70, grade: 'C' },
        { id: 'older', source_match_id: 'match-9', accuracy: 50, grade: 'D' },
      ],
    });
    const { games } = await (await fetch(`${apiBase}/api/game-records/recent`)).json() as { games: Array<{ review: { id: string } }> };
    expect(games[0]?.review.id).toBe('newer');
  });

  it('reports a review with no numeric accuracy honestly instead of inventing one', async () => {
    answer({ records: [STORED_ROW], reviews: [{ id: 'r', source_match_id: 'match-9', accuracy: null, grade: null }] });
    const { games } = await (await fetch(`${apiBase}/api/game-records/recent`)).json() as { games: Array<{ review: unknown }> };
    expect(games[0]?.review).toEqual({ id: 'r', accuracy: null, grade: null });
  });

  it('never puts an odd id into a filter, and skips the review query when there are no games', async () => {
    answer({ records: [{ ...STORED_ROW, source_match_id: 'bad"),user_id=eq.other' }] });
    const { games } = await (await fetch(`${apiBase}/api/game-records/recent`)).json() as { games: Array<{ review: unknown }> };
    expect(reviewCalls()).toHaveLength(0);
    expect(games[0]?.review).toBeNull();
    supabaseFetch.mockReset();
    answer({ records: [] });
    await fetch(`${apiBase}/api/game-records/recent`);
    expect(reviewCalls()).toHaveLength(0);
  });

  it('answers 500 rather than a list that wrongly says nothing was analyzed, when the reviews lookup fails', async () => {
    supabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes('/game_reviews?')) throw new Error('reviews down');
      return [STORED_ROW];
    });
    expect((await fetch(`${apiBase}/api/game-records/recent`)).status).toBe(500);
  });

  it('caps an oversized page', async () => {
    supabaseFetch.mockResolvedValue([]);
    await fetch(`${apiBase}/api/game-records/recent?limit=99999`);
    expect((supabaseFetch.mock.calls[0] as [string])[0]).toContain(`limit=${GAME_RECORD_LIST_MAX_LIMIT}`);
  });

  it('returns one saved game in full, scoped to its owner inside the query', async () => {
    answer({ records: [STORED_ROW], reviews: [{ id: 'review-9', source_match_id: 'match-9', accuracy: 88, grade: 'B' }] });
    const response = await fetch(`${apiBase}/api/game-records/match-9`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceMatchId: 'match-9', dealSeed: 'seed-9', matchStarter: 'you', localMatchId: 'local-9', recordVersion: 1,
      moves: [{ turn: 1, actor: 'you', tile_played: '6|6', branch: 'left' }],
      review: { id: 'review-9', accuracy: 88, grade: 'B' },
    });
    const path = (supabaseFetch.mock.calls[0] as [string])[0];
    expect(path).toContain(`user_id=eq.${USER}`);
    expect(path).toContain('source_match_id=eq.match-9');
  });

  it("answers 404 for a game that is not the caller's (or not saved)", async () => {
    supabaseFetch.mockResolvedValue([]);
    expect((await fetch(`${apiBase}/api/game-records/someone-elses`)).status).toBe(404);
  });

  it('encodes the id it queries with, so it cannot inject filters', async () => {
    supabaseFetch.mockResolvedValue([]);
    await fetch(`${apiBase}/api/game-records/${encodeURIComponent('a&user_id=eq.other')}`);
    const path = (supabaseFetch.mock.calls[0] as [string])[0];
    expect(path).not.toContain('&user_id=eq.other');
    expect(path).toContain(encodeURIComponent('a&user_id=eq.other'));
  });

  it('rejects an over-long id and answers 500 on a database failure', async () => {
    expect((await fetch(`${apiBase}/api/game-records/${'x'.repeat(200)}`)).status).toBe(400);
    supabaseFetch.mockRejectedValue(new Error('db down'));
    expect((await fetch(`${apiBase}/api/game-records/match-9`)).status).toBe(500);
    expect((await fetch(`${apiBase}/api/game-records/recent`)).status).toBe(500);
  });
});

