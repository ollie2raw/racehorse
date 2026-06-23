import type { HandAnalysis } from '../../analyzer/analysisTypes';
import type { HandVerdict } from '../../analyzer/analysisTypes';

export function filledBlockCount(accuracy: number): number {
  return Math.max(0, Math.min(10, Math.round(accuracy / 10)));
}

export function formatHandOutcome(verdict: HandVerdict, opponentLabel: string): string {
  const { winner, pointsYou, pointsOpponent, margin } = verdict;

  if (winner === 'tie') {
    if (pointsYou === 0 && pointsOpponent === 0) {
      return 'Tied';
    }
    return `Tied · ${pointsYou} pt${pointsYou !== 1 ? 's' : ''} each`;
  }

  if (winner === 'you') {
    if (margin > 0) {
      return `You won by ${margin} pt${margin !== 1 ? 's' : ''}`;
    }
    return `You won · ${pointsYou} pt${pointsYou !== 1 ? 's' : ''} to ${pointsOpponent}`;
  }

  if (margin > 0) {
    return `${opponentLabel} won by ${margin} pt${margin !== 1 ? 's' : ''}`;
  }
  return `${opponentLabel} won · ${pointsOpponent} pt${pointsOpponent !== 1 ? 's' : ''} to ${pointsYou}`;
}

export function handAccuracyLabel(hand: HandAnalysis): string {
  return `${hand.handAccuracy.toFixed(0)}%`;
}
