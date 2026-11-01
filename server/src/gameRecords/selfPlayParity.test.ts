import { describe, expect, it } from 'vitest';
import { playSeededGame } from '../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import { createRankedDealSnapshot, replayRankedMoveLog } from '../ghost/rankedDealAuthority';
import { playHonestGhostShapedGame } from '../testing/rankedDealSelfPlay';

/**
 * The client's tests build saved games with the package driver (client tests cannot import server source); the server
 * verifies saved games with its own replayer. This pins the two together: the same seed must produce the same game,
 * action for action, and the server's replayer must accept the package driver's game and reach its score.
 */
const CASES: Array<[string, 7 | 14, number, 'you' | 'bot']> = [
  ['parity-a', 7, 25, 'you'],
  ['parity-b', 7, 60, 'you'],
  ['parity-c', 7, 60, 'bot'],
  ['parity-d', 14, 60, 'you'],
  ['parity-e', 7, 40, 'bot'],
  ['parity-f', 14, 25, 'bot'],
];

describe('seeded self-play parity (client test driver vs server driver)', () => {
  it.each(CASES)('%s: same actions, same score, and the server replayer accepts it', (seed, dealSize, winningScore, matchStarter) => {
    const { snapshot } = createRankedDealSnapshot({ seed, dealSize, winningScore, matchStarter });
    const server = playHonestGhostShapedGame(snapshot);
    const pkg = playSeededGame({ seed, dealSize, winningScore, matchStarter });

    expect(pkg.moves.map((move) => [move.actor === 'you' ? 'you' : 'ghost', move.tile_played, move.branch])).toEqual(
      server.moveLog.map((entry) => [entry.actor, entry.tile_played ?? null, entry.branch ?? null]),
    );
    expect([pkg.playerScore, pkg.opponentScore, pkg.handCount]).toEqual([server.playerScore, server.opponentScore, server.handCount]);

    const replay = replayRankedMoveLog(snapshot, pkg.moves);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect([replay.playerScore, replay.opponentScore]).toEqual([pkg.playerScore, pkg.opponentScore]);
  });
});
