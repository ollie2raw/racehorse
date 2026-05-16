import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import {
  writeMatchActivity,
  writePuzzleActivity,
  writeDailyFritzActivity,
  writeTournamentActivity,
} from './activityWriter';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset().mockResolvedValue({}); });

describe('writeMatchActivity', () => {
  it('writes two rows when both users are authenticated', async () => {
    await writeMatchActivity({
      winnerUserId: 'w1', loserUserId: 'l1',
      winnerUsername: 'alice', loserUsername: 'bob',
      mode: 'online', winnerScore: 30, loserScore: 12,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const bodies = mockFetch.mock.calls.map(
      ([, init]: [string, { body: string }]) => JSON.parse(init.body),
    );
    const winRow = bodies.find((b: { type: string }) => b.type === 'win');
    const lossRow = bodies.find((b: { type: string }) => b.type === 'loss');
    expect(winRow.metadata.opponent_username).toBe('bob');
    expect(winRow.user_id).toBe('w1');
    expect(lossRow.metadata.opponent_username).toBe('alice');
    expect(lossRow.user_id).toBe('l1');
  });

  it('writes only winner row when loser has no userId', async () => {
    await writeMatchActivity({
      winnerUserId: 'w1', loserUserId: null,
      winnerUsername: 'alice', loserUsername: 'guest',
      mode: 'online', winnerScore: 30, loserScore: 12,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.type).toBe('win');
  });

  it('writes no rows when both userIds are null', async () => {
    await writeMatchActivity({
      winnerUserId: null, loserUserId: null,
      winnerUsername: 'a', loserUsername: 'b',
      mode: 'online', winnerScore: 30, loserScore: 0,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('writePuzzleActivity', () => {
  it('writes a puzzle row', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 450, streak: 4 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.type).toBe('puzzle');
    expect(body.metadata.score).toBe(450);
  });

  it('writes a streak row in addition to puzzle row on milestone 7', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 400, streak: 7 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const types = mockFetch.mock.calls.map(
      ([, init]: [string, { body: string }]) => JSON.parse(init.body).type,
    );
    expect(types).toContain('puzzle');
    expect(types).toContain('streak');
  });

  it('writes streak row on milestone 3', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 300, streak: 3 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not write streak row on non-milestone 5', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 300, streak: 5 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('writeDailyFritzActivity', () => {
  it('writes one daily_fritz row per game when set game results are present', async () => {
    await writeDailyFritzActivity({
      userId: 'u1',
      finalScore: 2,
      won: true,
      games: [
        { gameNumber: 1, playerWon: true, playerScore: 66, fritzScore: 52 },
        { gameNumber: 2, playerWon: false, playerScore: 48, fritzScore: 61 },
        { gameNumber: 3, playerWon: true, playerScore: 71, fritzScore: 44 },
      ],
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const bodies = mockFetch.mock.calls.map(
      ([, init]: [string, { body: string }]) => JSON.parse(init.body),
    );
    expect(bodies.map((body: { type: string }) => body.type)).toEqual(['daily_fritz', 'daily_fritz', 'daily_fritz']);
    expect(bodies[0].metadata).toMatchObject({
      result: 'win',
      game_number: 1,
      player_score: 66,
      fritz_score: 52,
    });
    expect(bodies[1].metadata).toMatchObject({
      result: 'loss',
      game_number: 2,
      player_score: 48,
      fritz_score: 61,
    });
  });

  it('falls back to set-level daily_fritz row without game results', async () => {
    await writeDailyFritzActivity({ userId: 'u1', finalScore: 35, won: true });
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.type).toBe('daily_fritz');
    expect(body.metadata.result).toBe('win');
    expect(body.metadata.score).toBe(35);
  });

  it('writes daily_fritz row with loss result', async () => {
    await writeDailyFritzActivity({ userId: 'u1', finalScore: 10, won: false });
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.metadata.result).toBe('loss');
  });
});

describe('writeTournamentActivity', () => {
  it('writes tournament row with placement', async () => {
    await writeTournamentActivity({ userId: 'u1', placement: 'Champion', tournamentId: 't-123' });
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.type).toBe('tournament');
    expect(body.metadata.placement).toBe('Champion');
    expect(body.metadata.tournament_id).toBe('t-123');
  });
});
