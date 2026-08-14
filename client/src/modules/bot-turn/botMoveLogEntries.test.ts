// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import {
  buildBotDrawMoveLogEntry,
  buildBotPassMoveLogEntry,
  buildBotPlaceMoveLogEntry,
} from './botMoveLogEntries.ts';
import { collectBotTurnSnapshot } from './botMoveSnapshot.ts';

describe('bot move log entries', () => {
  const match = createBotMatch(60, 7);
  const snapshot = collectBotTurnSnapshot(match);
  const tile = match.players.bot.hand[0]!;

  it('builds opponent draw entries', () => {
    const entry = buildBotDrawMoveLogEntry(snapshot, null);
    expect(entry.player).toBe('opponent');
    expect(entry.action).toBe('draw');
    expect(entry.boardEnds).toEqual(snapshot.boardEnds);
  });

  it('builds opponent pass entries', () => {
    const entry = buildBotPassMoveLogEntry(snapshot, null);
    expect(entry.action).toBe('pass');
  });

  it('builds opponent place entries', () => {
    const entry = buildBotPlaceMoveLogEntry({
      snapshot,
      tile,
      position: 'left',
      engineBestMove: null,
    });
    expect(entry.action).toBe('place');
    expect(entry.tile).toEqual([tile.low, tile.high]);
  });
});
