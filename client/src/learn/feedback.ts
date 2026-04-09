import type { BotChoice } from '../bot/botHeuristics';
import type { Tile } from '../types';

function formatTile(tile: Tile): string {
  return `${tile.high}-${tile.low}`;
}

export type MoveRating = 'Best move' | 'Good move' | 'Missed best move' | 'Valid play';

export interface FeedbackResult {
  rating: MoveRating;
  text: string;
}

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function compareMovesFeedback(
  userMove: BotChoice,
  bestMove: BotChoice,
  isExpected: boolean
): FeedbackResult {
  const userBreakdown = userMove.breakdown;
  const bestBreakdown = bestMove.breakdown;

  const scoreDiff = bestBreakdown.immediate - userBreakdown.immediate;
  const heuristicDiff = bestMove.score - userMove.score;

  // 1. Best Move (Expected or top quality)
  if (isExpected || heuristicDiff < 1.0) {
    const texts = userBreakdown.immediate > 0 
      ? [
          `Great spot! You found a ${userBreakdown.immediate}-point move. That's exactly what I'd play.`,
          `Nice! You saw the ${userBreakdown.immediate}-point play right away.`,
          `Perfect. Taking those ${userBreakdown.immediate} points is the best move here.`
        ]
      : [
          `Perfect! This keeps the board open and sets you up well for your next turn.`,
          `Exactly. This is a smart positional play that keeps your options open.`,
          `Spot on! You're maintaining a great board position with this move.`
        ];

    return {
      rating: 'Best move',
      text: isExpected ? "" : pickRandom(texts)
    };
  }

  // 2. Missed Scoring Opportunity (Primary)
  if (scoreDiff > 0) {
    const texts = [
      `That works, and you got ${userBreakdown.immediate} points. But the ${formatTile(bestMove.move.tile!)} would have scored ${bestBreakdown.immediate}, which is a huge swing for the round!`,
      `Nice play, you got ${userBreakdown.immediate} points. If you'd played the ${formatTile(bestMove.move.tile!)}, you could have walked away with ${bestBreakdown.immediate}!`,
      `You found ${userBreakdown.immediate} points, but there was a ${bestBreakdown.immediate}-point move with the ${formatTile(bestMove.move.tile!)} that would have really put you ahead.`
    ];
    return {
      rating: 'Missed best move',
      text: pickRandom(texts)
    };
  }

  // 3. Strategic Comparisons (Heuristics)
  
  // Risk (Opponent Reply)
  if (userBreakdown.replyRisk > bestBreakdown.replyRisk + 5) {
    const texts = [
      `This is a valid play, but it leaves an opening. Your opponent might score on their next turn, which could shift the momentum of the round.`,
      `Careful—this move sets your opponent up to score next turn. The ${formatTile(bestMove.move.tile!)} was a much safer bet.`,
      `This works, but it's risky! You're giving your opponent a chance to score. Watch the board ends closely.`
    ];
    return {
      rating: 'Good move',
      text: pickRandom(texts)
    };
  }

  // Mobility (Options)
  if (userBreakdown.mobility < bestBreakdown.mobility - 3) {
    const texts = [
      `You matched the tile, but now you have fewer options left in your hand. This might cost you points later if you get stuck.`,
      `This gives you fewer options for your next move. The ${formatTile(bestMove.move.tile!)} would have kept your hand more flexible.`,
      `A decent play, but try to keep more matching options in your hand. You might find yourself stuck in a few turns.`
    ];
    return {
      rating: 'Good move',
      text: pickRandom(texts)
    };
  }

  // Denial / Blocking
  if (bestBreakdown.denial > userBreakdown.denial + 5) {
    const texts = [
      `Nice play, but the ${formatTile(bestMove.move.tile!)} would have blocked your opponent's best numbers, making it harder for them to catch up.`,
      `Good move, but you missed a chance to block your opponent. The ${formatTile(bestMove.move.tile!)} would have shut down their options.`,
      `Solid, but the ${formatTile(bestMove.move.tile!)} was a better defensive play. It would have made it much tougher for them to find a match.`
    ];
    return {
      rating: 'Good move',
      text: pickRandom(texts)
    };
  }

  // Default "Good"
  if (heuristicDiff < 15) {
    const texts = [
      `This is a solid choice! It keeps you in the game, although the ${formatTile(bestMove.move.tile!)} was slightly stronger for your long-term position.`,
      `Good play. It keeps the game flowing, even if there was a slightly more strategic option available.`,
      `You're reading the board well! This is a good move, though the ${formatTile(bestMove.move.tile!)} had a bit more upside.`
    ];
    return {
      rating: 'Good move',
      text: pickRandom(texts)
    };
  }

  // 4. Fallback for "Valid Play" (Strategically weak)
  const fallbackTexts = [
    "This move is legal, but it doesn't help your position much. Without a score or a defensive block, you might struggle to catch up.",
    "A valid match, but it doesn't do much to help you win the round. Try looking for moves that score or block your opponent.",
    "This keeps the game moving, but it's a weak play strategically. Look for tiles that add up to 5 or keep your hand flexible."
  ];
  return {
    rating: 'Valid play',
    text: pickRandom(fallbackTexts)
  };
}
