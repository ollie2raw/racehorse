export interface DailyPuzzleStepPresentation {
  title: string;
  subtitle: string;
  shortLabel: string;
}

const LEGACY_SUBTITLES = ['Warm-up', 'Challenge', 'Final', 'Final stretch', 'Finale'] as const;

function getDailyClimbStep(slotIndex: number): DailyPuzzleStepPresentation {
  if (slotIndex === 1) {
    return {
      title: 'Quick Hit',
      subtitle: 'Warm-up',
      shortLabel: 'P1',
    };
  }
  if (slotIndex === 2) {
    return {
      title: 'Build',
      subtitle: 'Momentum',
      shortLabel: 'P2',
    };
  }
  if (slotIndex === 3) return { title: 'Read', subtitle: 'Tactical test', shortLabel: 'P3' };
  if (slotIndex === 4) return { title: 'Pressure', subtitle: 'Final stretch', shortLabel: 'P4' };
  return { title: 'Master Chain', subtitle: 'Finale', shortLabel: 'P5' };
}

export function getDailyPuzzleStepPresentation(
  slotIndex: number,
  publishedSlotTitle?: string | null,
): DailyPuzzleStepPresentation {
  const climbStep = getDailyClimbStep(slotIndex);
  const storedTitle = publishedSlotTitle?.trim();
  if (!storedTitle || storedTitle === climbStep.title) return climbStep;
  const normalizedIndex = Math.max(1, Math.min(5, Math.round(slotIndex)));
  return {
    title: `Puzzle ${normalizedIndex}`,
    subtitle: LEGACY_SUBTITLES[normalizedIndex - 1],
    shortLabel: `P${normalizedIndex}`,
  };
}

export function getDailyPuzzleDisplayTitle(slotIndex: number, fallback?: string | null): string {
  if (slotIndex >= 1 && slotIndex <= 5) {
    return getDailyPuzzleStepPresentation(slotIndex, fallback).title;
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
