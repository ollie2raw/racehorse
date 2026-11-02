/**
 * The cross-engine differential test for multiplayer game records.
 *
 * #458/#459 prove a record replays through the SERVER engine. This proves the saved rows (exactly what saveMultiplayerRecord.ts writes, one per player) rebuild
 * through the CLIENT engine and the client's snapshot recorder, which is what the Games page and the review pipeline run, to the same hand-by-hand and final
 * scores. If the two engines ever disagree about a forced draw or an auto-pass in a saved game, this fails with the seed.
 */
import { describe, expect, it } from 'vitest';
import { prepareMultiplayerRecordRows } from './saveMultiplayerRecord';
import { installRoomHarness, playGame } from './multiplayerRecord.testkit';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import type { Room } from '../rooms';
import {
  rebuildMultiplayerGameFromRecord,
  type SavedMultiplayerRecord,
} from '../../../client/src/modules/review/rebuildMultiplayerGameFromRecord';

installRoomHarness();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function rowsFor(room: Room) {
  const state = room.state!;
  const input: GameOverPersistInput = {
    room,
    sourceMatchId: `src-${room.code}`,
    cfg: room.config,
    aId: 'seat-a',
    bId: 'seat-b',
    a: { id: 'seat-a', socketId: '', username: 'Alice', userId: A },
    b: { id: 'seat-b', socketId: '', username: 'Bob', userId: B },
    scoreA: state.players['seat-a'].score,
    scoreB: state.players['seat-b'].score,
    winnerSeatId: state.winnerId ?? 'seat-a',
  };
  const prepared = prepareMultiplayerRecordRows(input);
  if (!prepared.ok) throw new Error(prepared.reason);
  return prepared.rows;
}

/** What GET /api/game-records/:id will return for an mp row, in the shape the client reads. */
function savedFrom(row: ReturnType<typeof rowsFor>[number]): SavedMultiplayerRecord {
  return {
    sourceMatchId: row.source_match_id,
    mode: 'mp',
    dealSize: row.deal_size as 7 | 14 | null,
    winningScore: row.winning_score,
    result: row.result,
    verification: row.verification,
    playedAt: row.played_at,
    opponentName: row.opponent_name,
    record: row.moves.record as unknown as SavedMultiplayerRecord['record'],
  };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7);

describe('a saved multiplayer game rebuilds on the client engine to the same scores', () => {
  it.each(SEEDS)('seed %i: both players\' rows, hand by hand and final', async (seed) => {
    const room = await playGame(`CLI${seed}`, seed);
    for (const row of rowsFor(room)) {
      const rebuilt = rebuildMultiplayerGameFromRecord(savedFrom(row));
      expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
      if (!rebuilt.ok) continue;
      const { finalState } = rebuilt.game;
      expect(finalState.gameOver).toBe(true);
      expect({ you: finalState.players.you.score, opponent: finalState.players.bot.score }).toEqual({ you: row.result.you, opponent: row.result.opponent });
      expect(rebuilt.game.snapshots.length).toBeGreaterThan(0);
      expect(rebuilt.game.moveLog.length).toBeGreaterThan(0);
    }
  });
});
