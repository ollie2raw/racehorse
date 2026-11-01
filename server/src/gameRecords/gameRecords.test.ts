import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRankedDealSnapshot, type RankedDealSnapshot, type RankedMoveSequenceEntry } from '../ghost/rankedDealAuthority';
import { playHonestGhostShapedGame } from '../testing/rankedDealSelfPlay';
import { buildGameRecordInsertPayload, parseGameRecordRequestBody } from './gameRecordPayload';
import { verifyGameRecord } from './verifyGameRecord';
import { registerGameRecordsRoute } from '../http/routes/gameRecordsRoute';

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
