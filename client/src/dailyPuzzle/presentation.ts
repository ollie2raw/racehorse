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
  return {
    title: 'Puzzle 3',
    subtitle: 'Final',
    shortLabel: 'P3',
  };
}

export function getDailyPuzzleDisplayTitle(slotIndex: number, fallback?: string | null): string {
  if (slotIndex >= 1 && slotIndex <= 3) {
    return getDailyPuzzleStepPresentation(slotIndex).title;
  }
  const safeFallback = fallback?.trim();
  return safeFallback && safeFallback.length > 0 ? safeFallback : 'Daily Puzzle';
}
