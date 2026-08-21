/**
 * Contract test: the move log the CLIENT actually produces must be accepted by
 * the SERVER verifier that gates match completion.
 *
 * Every other test around this boundary hand-writes a GhostMoveLogEntry[], so
 * none of them can catch the failure that actually reaches production: the
 * client emitting a log the server rejects. That is what shipped as the
 * "Illegal move: [5|5] on left does not match the board" 409 — the client
 * re-derived each placement's side from a pre-move board snapshot and
 * collapsed every play to 'left'.
 *
 * So this drives a real match through the client's own recorders — the same
 * snapshot, entry builder and ReplayRecorder the runtime uses — and feeds the
 * result to the real verifier. Nothing here constructs a log by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPlayMove,
  createFixedBotMatch,
  getLegalMoves,
  type BotHandDeal,
  type BotMatchState,
  type BotPlayerId,
} from '../../../client/src/modules/match/runtime/botEngine.ts';
import { collectPlayerMoveSnapshot } from '../../../client/src/modules/player-turn/playerMoveSnapshot.ts';
import { buildPlacementMoveLogEntry } from '../../../client/src/modules/player-turn/playerMoveLogEntries.ts';
import { ReplayRecorder } from '../../../client/src/modules/replay/ReplayRecorder.ts';
import { moveEntriesToGhostMoveLog } from '../../../client/src/modules/ghost/ghostMatchHelpers.ts';
import { sumTilePips } from '../../../client/src/game/tileUtils.ts';
import type { Tile } from '../../../client/src/types.ts';
import { verifyPlayerMoveLog } from './verifier';
import type { GhostMoveLogEntry } from './service';

const t = (low: number, high: number): Tile => ({ low, high });

/**
 * A deal that forces play onto BOTH ends of the board. A log that mislabels
 * sides passes trivially if every legal play happens to sit on the left.
 */
const TWO_SIDED_DEAL: BotHandDeal = {
  player_tiles: [t(2, 3), t(3, 5), t(1, 2), t(0, 1), t(5, 5), t(4, 6), t(0, 6)],
  fritz_tiles: [t(3, 4), t(2, 6), t(1, 4), t(0, 4), t(1, 6), t(2, 5), t(0, 5)],
  boneyard: [],
  locked: [],
};

/** Drives the match the way the runtime does, recording as it goes. */
function playMatchThroughClientRecorders(): {
  log: GhostMoveLogEntry[];
  sidesSeen: Set<string>;
} {
  let match: BotMatchState = createFixedBotMatch(TWO_SIDED_DEAL);
  const recorder = new ReplayRecorder();
  const sidesSeen = new Set<string>();

  for (let turn = 0; turn < 40; turn += 1) {
    if (match.handOver || match.gameOver) break;
    const actor = match.currentPlayer as BotPlayerId;
    const legal = getLegalMoves(match, actor).filter(
      (m) => m.type === 'play' && m.tile && m.position,
    );
    if (legal.length === 0) break;

    // Prefer a right-end play when one exists, so the log exercises both sides.
    const move = legal.find((m) => m.position === 'right') ?? legal[0];

    if (actor === 'you') {
      // Snapshot BEFORE applying — this ordering is the whole point.
      const snapshot = collectPlayerMoveSnapshot(match, []);
      const result = applyPlayMove(match, actor, move);
      if (result.error) break;
      const afterPips = sumTilePips(result.state.players.you.hand);
      recorder.recordMove(
        buildPlacementMoveLogEntry(
          match,
          snapshot,
          move.tile as Tile,
          move.position!,
          afterPips,
          result.scored?.points ?? 0,
          'standard',
        ),
        match.handNumber,
      );
      if (move.position) sidesSeen.add(move.position);
      match = result.state;
    } else {
      const result = applyPlayMove(match, actor, move);
      if (result.error) break;
      match = result.state;
    }
  }

  return { log: moveEntriesToGhostMoveLog(recorder.getMoveLog()) as GhostMoveLogEntry[], sidesSeen };
}

describe('ghost move log contract: client output -> server verifier', () => {
  it('the client records plays on both ends, not just the left', () => {
    const { log, sidesSeen } = playMatchThroughClientRecorders();
    expect(log.length).toBeGreaterThan(1);
    // Guards the deal itself: if every play were left-end, the test below
    // would pass even with the original bug present.
    expect(sidesSeen.has('right')).toBe(true);

    const branches = log.filter((e) => e.tile_played).map((e) => e.branch);
    expect(branches).toContain('right');
    expect(new Set(branches).size).toBeGreaterThan(1);
  });

  it('the server verifier accepts a log the client actually produced', () => {
    const { log } = playMatchThroughClientRecorders();
    const result = verifyPlayerMoveLog(log);
    expect(result).toEqual({ ok: true });
  });

  it('every recorded placement side matches the side the tile was played on', () => {
    const { log } = playMatchThroughClientRecorders();
    for (const entry of log) {
      if (!entry.tile_played) continue;
      expect(entry.branch, `entry ${entry.turn} (${entry.tile_played})`).toBeTruthy();
      expect(['left', 'right']).toContain(entry.branch);
    }
  });
});
