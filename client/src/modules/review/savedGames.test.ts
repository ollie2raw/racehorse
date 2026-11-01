import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playSeededGame } from '../../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import { fetchRecentGames, loadSavedGame } from './savedGames.ts';
import type { SavedGameRecord } from './rebuildGameFromRecord.ts';

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
    expect(apiGet).toHaveBeenCalledWith(`/api/game-records/${encodeURIComponent('a b/c')}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.finalState.gameOver).toBe(true);
    expect(result.game.snapshots.length).toBe(result.record.moves.length);
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

describe('fetchRecentGames', () => {
  beforeEach(() => apiGet.mockReset());

  it('returns the archive rows', async () => {
    apiGet.mockResolvedValue({ data: { games: [{ sourceMatchId: 'a' }] }, error: null, status: 200 });
    const result = await fetchRecentGames(5);
    expect(apiGet).toHaveBeenCalledWith('/api/game-records/recent?limit=5');
    expect(result).toEqual({ ok: true, games: [{ sourceMatchId: 'a' }] });
  });

  it('reports unreachable instead of throwing', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'down', status: 500 });
    expect(await fetchRecentGames()).toEqual({ ok: false, reason: 'unreachable' });
  });
});
