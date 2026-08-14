// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { compareMovesFeedback } from './feedback';
import type { BotChoice } from '../bot/botHeuristics';

describe('compareMovesFeedback', () => {
  const dummyTile = { low: 5, high: 5 };

  const createDummyMove = (
    score: number,
    immediatePoints: number,
    replyRisk = 0,
    mobility = 5,
    denial = 0,
  ): BotChoice => ({
    move: { tile: dummyTile, position: 'left' as const } as any,
    score,
    breakdown: {
      immediate: immediatePoints,
      replyRisk,
      mobility,
      denial,
    } as any,
  });

  it('1. returns Best move when isExpected is true', () => {
    const userMove = createDummyMove(100, 10);
    const bestMove = createDummyMove(100, 10);
    const result = compareMovesFeedback(userMove, bestMove, true);
    expect(result.rating).toBe('Best move');
    expect(result.text).toBe('');
  });

  it('2. returns Best move with positive text when heuristicDiff is small (< 1.0) and immediate score > 0', () => {
    const userMove = createDummyMove(99.5, 10);
    const bestMove = createDummyMove(100, 10);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Best move');
    const possible = [
      `Great spot! You found a 10-point move. That's exactly what I'd play.`,
      `Nice! You saw the 10-point play right away.`,
      `Perfect. Taking those 10 points is the best move here.`
    ];
    expect(possible).toContain(result.text);
  });

  it('3. returns Best move with positional text when heuristicDiff is small and immediate score is 0', () => {
    const userMove = createDummyMove(99.5, 0);
    const bestMove = createDummyMove(100, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Best move');
    const possible = [
      `Perfect! This keeps the board open and sets you up well for your next turn.`,
      `Exactly. This is a smart positional play that keeps your options open.`,
      `Spot on! You're maintaining a great board position with this move.`
    ];
    expect(possible).toContain(result.text);
  });

  it('4. returns Missed best move when there is a score deficit (scoreDiff > 0)', () => {
    const userMove = createDummyMove(80, 5);
    const bestMove = createDummyMove(100, 15);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Missed best move');
    // In feedback.ts, formatTile format is 'high-low' which for 5,5 is '5-5'. 
    // And userBreakdown.immediate is printed.
    // Assert against the actual generated structures.
    const expectedMatches = result.text.includes('5-5') && result.text.includes('15') && result.text.includes('5');
    expect(expectedMatches).toBe(true);
  });

  it('5. returns Good move with risk text when user move has high reply risk', () => {
    const userMove = createDummyMove(80, 0, 10);
    const bestMove = createDummyMove(90, 0, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `This is a valid play, but it leaves an opening. Your opponent might score on their next turn, which could shift the momentum of the round.`,
      `Careful—this move sets your opponent up to score next turn. The 5-5 was a much safer bet.`,
      `This works, but it's risky! You're giving your opponent a chance to score. Watch the board ends closely.`
    ];
    expect(possible).toContain(result.text);
  });

  it('6. returns Good move with mobility text when user move has low mobility', () => {
    const userMove = createDummyMove(80, 0, 0, 1);
    const bestMove = createDummyMove(90, 0, 0, 5);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `You matched the tile, but now you have fewer options left in your hand. This might cost you points later if you get stuck.`,
      `This gives you fewer options for your next move. The 5-5 would have kept your hand more flexible.`,
      `A decent play, but try to keep more matching options in your hand. You might find yourself stuck in a few turns.`
    ];
    expect(possible).toContain(result.text);
  });

  it('7. returns Good move with denial text when best move has higher denial blocking', () => {
    const userMove = createDummyMove(80, 0, 0, 5, 0);
    const bestMove = createDummyMove(90, 0, 0, 5, 10);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `Nice play, but the 5-5 would have blocked your opponent's best numbers, making it harder for them to catch up.`,
      `Good move, but you missed a chance to block your opponent. The 5-5 would have shut down their options.`,
      `Solid, but the 5-5 was a better defensive play. It would have made it much tougher for them to find a match.`
    ];
    expect(possible).toContain(result.text);
  });

  it('8. returns Good move with default copy when heuristicDiff < 15 and no other differentials trigger', () => {
    const userMove = createDummyMove(90, 0, 0, 5, 0);
    const bestMove = createDummyMove(100, 0, 0, 5, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `This is a solid choice! It keeps you in the game, although the 5-5 was slightly stronger for your long-term position.`,
      `Good play. It keeps the game flowing, even if there was a slightly more strategic option available.`,
      `You're reading the board well! This is a good move, though the 5-5 had a bit more upside.`
    ];
    expect(possible).toContain(result.text);
  });

  it('9. returns Valid play with weak move copy when heuristicDiff >= 15 and no other differentials trigger', () => {
    const userMove = createDummyMove(70, 0, 0, 5, 0);
    const bestMove = createDummyMove(90, 0, 0, 5, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Valid play');
    const possible = [
      "This move is legal, but it doesn't help your position much. Without a score or a defensive block, you might struggle to catch up.",
      "A valid match, but it doesn't do much to help you win the round. Try looking for moves that score or block your opponent.",
      "This keeps the game moving, but it's a weak play strategically. Look for tiles that add up to 5 or keep your hand flexible."
    ];
    expect(possible).toContain(result.text);
  });

  it('10. handles randomized texts selection correctly on multiple invocations', () => {
    const userMove = createDummyMove(90, 0, 0, 5, 0);
    const bestMove = createDummyMove(100, 0, 0, 5, 0);
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(compareMovesFeedback(userMove, bestMove, false).text);
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('11. prioritizes scoreDiff over replyRisk', () => {
    const userMove = createDummyMove(80, 5, 10);
    const bestMove = createDummyMove(100, 15, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Missed best move');
  });

  it('12. prioritizes replyRisk over mobility', () => {
    const userMove = createDummyMove(80, 0, 10, 1);
    const bestMove = createDummyMove(95, 0, 0, 5);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `This is a valid play, but it leaves an opening. Your opponent might score on their next turn, which could shift the momentum of the round.`,
      `Careful—this move sets your opponent up to score next turn. The 5-5 was a much safer bet.`,
      `This works, but it's risky! You're giving your opponent a chance to score. Watch the board ends closely.`
    ];
    expect(possible).toContain(result.text);
  });

  it('13. prioritizes mobility over denial', () => {
    const userMove = createDummyMove(80, 0, 0, 1, 0);
    const bestMove = createDummyMove(95, 0, 0, 5, 10);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Good move');
    const possible = [
      `You matched the tile, but now you have fewer options left in your hand. This might cost you points later if you get stuck.`,
      `This gives you fewer options for your next move. The 5-5 would have kept your hand more flexible.`,
      `A decent play, but try to keep more matching options in your hand. You might find yourself stuck in a few turns.`
    ];
    expect(possible).toContain(result.text);
  });

  it('14. works with edge case inputs where scores are negative', () => {
    const userMove = createDummyMove(-10, 0);
    const bestMove = createDummyMove(-9.5, 0);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Best move');
  });

  it('15. behaves reasonably when scoring numbers are extremely large', () => {
    const userMove = createDummyMove(1000, 500);
    const bestMove = createDummyMove(1500, 1000);
    const result = compareMovesFeedback(userMove, bestMove, false);
    expect(result.rating).toBe('Missed best move');
    expect(result.text.includes('1000') && result.text.includes('500')).toBe(true);
  });
});
