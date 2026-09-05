import { describe, expect, it } from 'vitest';
import { createRankedDealSnapshot, isSafeRankedMoveSequence, replayRankedMoveLog } from './rankedDealAuthority';
import {
  mutateOnePlayedTile,
  playHonestGhostShapedGame,
  playHonestRankedGame,
} from '../testing/rankedDealSelfPlay';

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

  it('accepts a real multi-hand GhostMoveLogEntry[] log via isSafeRankedMoveSequence and replays it exactly (GM-2)', () => {
    // GM-2 (HARDENING_PLAN.md §10.3): isSafeRankedMoveSequence and the real
    // client move-log shape (GhostMoveLogEntry) are independently maintained
    // with no shared type. Confirms today's compatibility with a test
    // instead of leaving it "true by tracing" only — a low winningScore
    // forces multiple hands, since a single-hand log wouldn't exercise
    // hand_number incrementing or the mid-game deal transition at all.
    const { snapshot } = createRankedDealSnapshot({
      seed: 'ranked-deal-ghost-shape-1',
      dealSize: 7,
      winningScore: 60,
      matchStarter: 'you',
    });
    const honest = playHonestGhostShapedGame(snapshot);
    expect(honest.handCount).toBeGreaterThan(1);

    expect(isSafeRankedMoveSequence(honest.moveLog)).toBe(true);

    const replayed = replayRankedMoveLog(snapshot, honest.moveLog);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.playerScore).toBe(honest.playerScore);
    expect(replayed.opponentScore).toBe(honest.opponentScore);
  });
});
