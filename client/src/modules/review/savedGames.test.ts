import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playSeededGame } from '../../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import {
  dailyFritzGameToSummary,
  fetchDailyFritzGames,
  fetchRecentGames,
  loadSavedGame,
  parseDailyFritzSavedGameId,
  type DailyFritzGameListEntry,
} from './savedGames.ts';
import type { SavedGameRecord } from './rebuildGameFromRecord.ts';
import mpFixture from './fixtures/multiplayerSavedGame.json';
import dfFixture from './fixtures/dailyFritzSavedGame.json';

const apiGet = vi.fn();
vi.mock('../../api/client.ts', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

function record(): SavedGameRecord {
  const played = playSeededGame({ seed: 'saved-games-1', dealSize: 7, winningScore: 25, matchStarter: 'you' });
  return {
    sourceMatchId: 'src-1',
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 25,
    matchStarter: 'you',
    dealSeed: 'saved-games-1',
    result: { you: played.playerScore, opponent: played.opponentScore, winner: played.playerScore > played.opponentScore ? 'you' : 'opponent' },
    moves: played.moves,
    verification: 'replay_verified',
    playedAt: null,
  };
}

describe('loadSavedGame', () => {
  beforeEach(() => apiGet.mockReset());

  it('fetches by id (encoded) and rebuilds the game', async () => {
    apiGet.mockResolvedValue({ data: record(), error: null, status: 200 });
    const result = await loadSavedGame('a b/c');
    expect(apiGet).toHaveBeenCalledWith(`/api/game-records/${encodeURIComponent('a b/c')}?modes=pvf,mp`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.finalState.gameOver).toBe(true);
    expect(result.game.snapshots.length).toBe((result.record as SavedGameRecord).moves.length);
  });

  it('says not_found for a game that was never saved', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'This game has not been saved.', status: 404 });
    expect(await loadSavedGame('nope')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('says unreachable (retryable) when the server fails', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'down', status: 503 });
    expect(await loadSavedGame('x')).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('names a record that does not replay, with where it broke', async () => {
    const bad = record();
    const index = bad.moves.findIndex((move) => move.tile_played);
    bad.moves[index] = { ...bad.moves[index]!, tile_played: bad.moves[index]!.tile_played === '0|0' ? '6|6' : '0|0' };
    apiGet.mockResolvedValue({ data: bad, error: null, status: 200 });
    const result = await loadSavedGame('src-1');
    expect(result).toMatchObject({ ok: false, reason: 'not_replayable' });
  });
});

/** What GET /api/game-records/:id returns for a multiplayer game: the list entry's fields plus `moves: { kind: 'mp', version, record }`. */
function mpResponse(overrides: Record<string, unknown> = {}) {
  const { record: payload, ...rest } = structuredClone(mpFixture) as unknown as { record: unknown } & Record<string, unknown>;
  return { ...rest, mode: 'mp', moves: { kind: 'mp', version: 1, record: payload }, ...overrides };
}

describe('loadSavedGame, multiplayer', () => {
  beforeEach(() => apiGet.mockReset());

  it('opens a saved multiplayer game: the server\'s read result is rebuilt on the client engine', async () => {
    apiGet.mockResolvedValue({ data: mpResponse({ opponentName: 'Rival' }), error: null, status: 200 });
    const result = await loadSavedGame('fixture-mp-1');
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, record: { mode: 'mp', opponentName: 'Rival' } });
    if (!result.ok) return;
    expect(result.game.finalState.gameOver).toBe(true);
    expect(result.game.snapshots.length).toBeGreaterThan(0);
  });

  it('says so, plainly, when a multiplayer record is not in a readable form', async () => {
    for (const data of [mpResponse({ moves: null }), mpResponse({ moves: { kind: 'other' } }), mpResponse({ moves: { kind: 'mp', record: { hands: 'x' } } })]) {
      apiGet.mockResolvedValue({ data, error: null, status: 200 });
      expect(await loadSavedGame('x')).toMatchObject({ ok: false, reason: 'not_replayable' });
    }
  });

  it('names a multiplayer record that does not replay, and never throws on a malformed hand', async () => {
    const tampered = mpResponse();
    const hands = (tampered.moves as { record: { hands: Array<{ deals: { you: string[] } }> } }).record.hands;
    hands[0]!.deals.you[0] = '9|9';
    apiGet.mockResolvedValue({ data: tampered, error: null, status: 200 });
    expect(await loadSavedGame('x')).toMatchObject({ ok: false, reason: 'not_replayable' });

    const malformed = mpResponse();
    delete (((malformed.moves as { record: { hands: Array<Record<string, unknown>> } }).record.hands)[0]!).deals;
    apiGet.mockResolvedValue({ data: malformed, error: null, status: 200 });
    await expect(loadSavedGame('x')).resolves.toMatchObject({ ok: false, reason: 'not_replayable' });
  });

  it('still opens a Play vs Fritz game exactly as before', async () => {
    apiGet.mockResolvedValue({ data: record(), error: null, status: 200 });
    expect(await loadSavedGame('src-1')).toMatchObject({ ok: true, record: { mode: 'pvf' } });
  });
});

/** What GET /api/daily-fritz/game-record returns: a real derived game, generated by the server's own code (fixtures/dailyFritzSavedGame.json). */
const dfResponse = () => structuredClone(dfFixture) as unknown as Record<string, unknown>;

describe('parseDailyFritzSavedGameId', () => {
  it('reads dfz:<attempt id>:<game 1-3> and nothing else', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseDailyFritzSavedGameId(`dfz:${id}:2`)).toEqual({ attemptId: id, gameNumber: 2 });
    for (const bad of ['', 'src-1', `dfz:${id}:0`, `dfz:${id}:4`, `dfz:${id}`, `dfz:not-a-uuid:1`, `mp:${id}:1`, `dfz:${id}:1:extra`]) {
      expect(parseDailyFritzSavedGameId(bad)).toBeNull();
    }
  });
});

describe('loadSavedGame for a Daily Fritz game', () => {
  beforeEach(() => apiGet.mockReset());
  const id = dfFixture.sourceMatchId;

  it('asks the Daily Fritz endpoint (not the game archive) and rebuilds the game to the verified result', async () => {
    apiGet.mockResolvedValue({ data: dfResponse(), error: null, status: 200 });
    const result = await loadSavedGame(id);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/api/daily-fritz/game-record?attempt_id=11111111-1111-4111-8111-111111111111&game_number=2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({ mode: 'dfz', fritzTier: 'elite', opponentName: 'Fritz' });
    const { finalState } = result.game;
    expect(finalState.gameOver).toBe(true);
    expect({ you: finalState.players.you.score, opponent: finalState.players.bot.score }).toEqual({ you: dfFixture.result.you, opponent: dfFixture.result.opponent });
    expect(result.game.snapshots.length).toBeGreaterThan(0);
  });

  it('says not_reviewable when the server has no review for this game (404), and unreachable when it fails', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'Review is not available for this game.', status: 404 });
    expect(await loadSavedGame(id)).toEqual({ ok: false, reason: 'not_reviewable' });
    apiGet.mockResolvedValue({ data: null, error: 'down', status: 503 });
    expect(await loadSavedGame(id)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('names a response it cannot read or replay instead of opening a wrong game', async () => {
    apiGet.mockResolvedValue({ data: { ...dfResponse(), mode: 'mp' }, error: null, status: 200 });
    expect(await loadSavedGame(id)).toMatchObject({ ok: false, reason: 'not_replayable' });

    const tampered = dfResponse() as { record: { hands: Array<{ actions: Array<{ type: string; tile?: string }> }> } };
    const move = tampered.record.hands[0]!.actions.find((a) => a.type === 'MOVE')!;
    move.tile = move.tile === '0|0' ? '6|6' : '0|0';
    apiGet.mockResolvedValue({ data: tampered, error: null, status: 200 });
    expect(await loadSavedGame(id)).toMatchObject({ ok: false, reason: 'not_replayable' });
  });

  it('does not treat an ordinary id as a Daily Fritz game', async () => {
    apiGet.mockResolvedValue({ data: record(), error: null, status: 200 });
    await loadSavedGame('src-1');
    expect(apiGet).toHaveBeenCalledWith('/api/game-records/src-1?modes=pvf,mp');
  });
});

describe('fetchDailyFritzGames', () => {
  // No beforeEach(mockReset) here: each test sets its own answer, and a reset ahead of an async-rejecting mock makes vitest report the (handled) rejection as a failure.
  const entry = (n: number, extra: Partial<DailyFritzGameListEntry> = {}): DailyFritzGameListEntry => ({
    sourceMatchId: `dfz:11111111-1111-4111-8111-111111111111:${n}`,
    attemptId: '11111111-1111-4111-8111-111111111111',
    runDate: '2026-11-02',
    gameNumber: n,
    result: { you: 61, opponent: 40, winner: 'you' },
    hands: 6,
    completedAt: '2026-11-02T18:30:00.000Z',
    reviewable: true,
    ...extra,
  });

  it('turns each reviewable game into an archive row that says Daily Fritz, against Fritz, with the verified result', async () => {
    apiGet.mockResolvedValue({ data: { games: [entry(1), entry(2, { result: { you: 20, opponent: 61, winner: 'opponent' } })] }, error: null, status: 200 });
    const games = await fetchDailyFritzGames();
    expect(apiGet).toHaveBeenCalledWith('/api/daily-fritz/games');
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      sourceMatchId: 'dfz:11111111-1111-4111-8111-111111111111:1',
      mode: 'dfz',
      opponentName: 'Fritz',
      result: { you: 61, opponent: 40, winner: 'you' },
      verification: 'replay_verified',
      playedAt: '2026-11-02T18:30:00.000Z',
      review: null,
    });
    expect(games[1]!.result.winner).toBe('opponent');
  });

  it('leaves out a game whose hands were not kept, since its review could not open', async () => {
    apiGet.mockResolvedValue({ data: { games: [entry(1), entry(2, { reviewable: false })] }, error: null, status: 200 });
    expect((await fetchDailyFritzGames()).map((g) => g.sourceMatchId)).toEqual([entry(1).sourceMatchId]);
  });

  it('dates a game with no completion time by its run date, never as undefined', () => {
    const row = dailyFritzGameToSummary(entry(3, { completedAt: null }));
    expect(row.playedAt).toBeNull();
    expect(row.savedAt).toBe('2026-11-02T00:00:00.000Z');
  });

  it('never fails the archive: an error, an outage, a malformed answer and a throw all give an empty list', async () => {
    for (const answer of [
      { data: null, error: 'down', status: 503 },
      { data: { games: 'nope' }, error: null, status: 200 },
      { data: null, error: null, status: 200 },
    ]) {
      apiGet.mockResolvedValue(answer);
      expect(await fetchDailyFritzGames()).toEqual([]);
    }
    apiGet.mockImplementation(async () => {
      throw new Error('network');
    });
    expect(await fetchDailyFritzGames()).toEqual([]);
  });
});

describe('fetchRecentGames', () => {
  beforeEach(() => apiGet.mockReset());

  it('returns the archive rows', async () => {
    apiGet.mockResolvedValue({ data: { games: [{ sourceMatchId: 'a' }] }, error: null, status: 200 });
    const result = await fetchRecentGames(5);
    expect(apiGet).toHaveBeenCalledWith('/api/game-records/recent?limit=5&modes=pvf,mp');
    expect(result).toEqual({ ok: true, games: [{ sourceMatchId: 'a' }] });
  });

  it('reports unreachable instead of throwing', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'down', status: 500 });
    expect(await fetchRecentGames()).toEqual({ ok: false, reason: 'unreachable' });
  });
});
