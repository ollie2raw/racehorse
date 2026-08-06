export interface DailyPuzzleStepPresentation {
  title: string;
  subtitle: string;
  shortLabel: string;
}

export function getDailyPuzzleStepPresentation(slotIndex: number): DailyPuzzleStepPresentation {
  if (slotIndex === 1) {
    return {
      title: 'Puzzle 1',
      subtitle: 'Warm-up',
      shortLabel: 'P1',
    };
  }
  if (slotIndex === 2) {
    return {
      title: 'Puzzle 2',
      subtitle: 'Challenge',
      shortLabel: 'P2',
    };
  }
  if (slotIndex === 3) return { title: 'Puzzle 3', subtitle: 'Final', shortLabel: 'P3' };
  if (slotIndex === 4) return { title: 'Puzzle 4', subtitle: 'Final stretch', shortLabel: 'P4' };
  return { title: 'Puzzle 5', subtitle: 'Finale', shortLabel: 'P5' };
}

export function getDailyPuzzleDisplayTitle(slotIndex: number, fallback?: string | null): string {
  if (slotIndex >= 1 && slotIndex <= 5) {
    return getDailyPuzzleStepPresentation(slotIndex).title;
  }
  const safeFallback = fallback?.trim();
  return safeFallback && safeFallback.length > 0 ? safeFallback : 'Daily Puzzle';
}

/** Compact ladder pill labels for leaderboard rows. */
export function getDailyPuzzleLeaderboardSlotCode(slotIndex: 1 | 2 | 3 | 4 | 5): string {
  return `P${slotIndex}`;
}

export function getDailyPuzzleLeaderboardSlotTitle(slotIndex: 1 | 2 | 3 | 4 | 5): string {
  return `Puzzle ${slotIndex}`;
}

type PuzzleBreakdownSlot = {
  slotIndex: 1 | 2 | 3 | 4 | 5;
  awardedPoints: number | null;
  perfect: boolean;
  solved: boolean;
};

export function getDailyPuzzleBestSlotDisplay(
  breakdown: PuzzleBreakdownSlot[],
): { slotIndex: 1 | 2 | 3 | 4 | 5 | null; label: string } {
  let bestSlot: 1 | 2 | 3 | 4 | 5 | null = null;
  let bestPoints = -Infinity;

  for (const slot of breakdown) {
    if (!slot.solved || slot.awardedPoints == null) continue;
    if (
      slot.awardedPoints > bestPoints
      || (slot.awardedPoints === bestPoints && (bestSlot == null || slot.slotIndex > bestSlot))
    ) {
      bestPoints = slot.awardedPoints;
      bestSlot = slot.slotIndex;
    }
  }

  if (bestSlot == null || !Number.isFinite(bestPoints)) {
    return { slotIndex: null, label: '—' };
  }

  return { slotIndex: bestSlot, label: `P${bestSlot} ${bestPoints}` };
}
