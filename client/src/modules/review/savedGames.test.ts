import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playSeededGame } from '../../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import { fetchRecentGames, loadSavedGame } from './savedGames.ts';
import type { SavedGameRecord } from './rebuildGameFromRecord.ts';
import mpFixture from './fixtures/multiplayerSavedGame.json';

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
