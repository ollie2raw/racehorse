import { describe, expect, it } from 'vitest';
import { createRankedDealSnapshot, replayRankedMoveLog } from './rankedDealAuthority';
import { mutateOnePlayedTile, playHonestRankedGame } from '../testing/rankedDealSelfPlay';

describe('ranked deal authority', () => {
  it('replays an honest log to the exact engine score, ignoring client board/hand/score fields', () => {
    const { snapshot } = createRankedDealSnapshot({
      seed: 'ranked-deal-honest-1',
      dealSize: 7,
      winningScore: 10,
      matchStarter: 'you',
    });
    const honest = playHonestRankedGame(snapshot);
    expect(Math.max(honest.playerScore, honest.opponentScore)).toBeGreaterThanOrEqual(10);

    const replayed = replayRankedMoveLog(snapshot, honest.moveLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.playerScore).toBe(honest.playerScore);
    expect(replayed.opponentScore).toBe(honest.opponentScore);
    expect(replayed.gameOver).toBe(true);
  });

  it('rejects a still-legal-looking mutated tile and does not return a score', () => {
    const { snapshot } = createRankedDealSnapshot({
      seed: 'ranked-deal-mutated-1',
      dealSize: 7,
      winningScore: 10,
      matchStarter: 'you',
    });
    const honest = playHonestRankedGame(snapshot);
    const mutated = mutateOnePlayedTile(honest.moveLog);

    const replayed = replayRankedMoveLog(snapshot, mutated);
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.reason.length).toBeGreaterThan(0);
  });
});
