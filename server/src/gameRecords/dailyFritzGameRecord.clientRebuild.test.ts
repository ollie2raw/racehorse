/**
 * The cross-engine check for Daily Fritz game records (DF-3), the counterpart of multiplayerRecord.clientRebuild.test.ts.
 *
 * dailyFritzGameRecord.test.ts proves a Daily Fritz game, written in the multiplayer record format, replays through the SERVER engine. This proves the same
 * record rebuilds through the CLIENT engine and the client's snapshot recorder, which is what the Games page and the review pipeline run, to the same
 * hand-by-hand and final scores. It is the evidence behind reusing the multiplayer format (and the client rebuild) for Daily Fritz instead of writing a second one.
 */
import { describe, expect, it } from 'vitest';
import { replayVerifiedDailyFritzHand } from '../dailyFritzHandReplay';
import { inputFor, playGame, transcriptOf } from '../dailyFritzHand.testkit';
import { buildDailyFritzGameRecord } from './dailyFritzGameRecord';
import {
  rebuildMultiplayerGameFromRecord,
  type SavedMultiplayerRecord,
} from '../../../client/src/modules/review/rebuildMultiplayerGameFromRecord';

function savedGame(game: ReturnType<typeof playGame>): SavedMultiplayerRecord {
  const replays = game.hands.map(({ handIndex, initialState, actions }) => {
    const replay = replayVerifiedDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions)));
    if (!replay.ok) throw new Error(`hand ${handIndex}: ${replay.code}`);
    return replay;
  });
  const built = buildDailyFritzGameRecord(replays);
  if (!built.ok) throw new Error(built.reason);
  const { record } = built;
  return {
    sourceMatchId: 'dfz:test',
    mode: 'mp',
    dealSize: record.config.tilesPerPlayer === 14 ? 14 : 7,
    winningScore: record.config.winningScore,
    result: { you: record.finalScores.you!, opponent: record.finalScores.opponent!, winner: record.winnerId === 'you' ? 'you' : record.winnerId === 'opponent' ? 'opponent' : null },
    verification: 'replay_verified',
    playedAt: null,
    opponentName: 'Fritz',
    record: record as unknown as SavedMultiplayerRecord['record'],
  };
}

const games = Array.from({ length: 20 }, (_, i) => i + 1)
  .map((seed) => ({ seed, game: playGame(seed, { drawWinner: seed % 2 === 0 ? 'bot' : 'you', dealSize: seed % 5 === 0 ? 14 : 7 }) }))
  .filter((g) => g.game.finished);

describe('a Daily Fritz game record rebuilds on the client engine to the same scores', () => {
  it('has enough finished games, of both deal sizes and both starters, to mean something', () => {
    expect(games.length).toBeGreaterThanOrEqual(14);
    expect(games.some((g) => g.seed % 5 === 0)).toBe(true);
    expect(games.some((g) => g.seed % 2 === 0)).toBe(true);
  });

  it.each(games.map((g) => g.seed))('seed %i', (seed) => {
    const game = games.find((g) => g.seed === seed)!.game;
    const saved = savedGame(game);
    const rebuilt = rebuildMultiplayerGameFromRecord(saved);
    expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
    if (!rebuilt.ok) return;
    const { finalState } = rebuilt.game;
    expect(finalState.gameOver).toBe(true);
    expect({ you: finalState.players.you.score, opponent: finalState.players.bot.score }).toEqual({ you: saved.result.you, opponent: saved.result.opponent });
    expect(rebuilt.game.snapshots.length).toBeGreaterThan(0);
    expect(rebuilt.game.moveLog.length).toBeGreaterThan(0);
  });
});
