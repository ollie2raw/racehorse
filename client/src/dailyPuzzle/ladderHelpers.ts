export function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export type LadderPuzzleCardState = 'active' | 'locked' | 'done' | 'idle';

export function getLadderPuzzleCardState(row: {
  slotResult?: { awardedPoints: number } | null;
  isLocked: boolean;
  isAvailable: boolean;
}): LadderPuzzleCardState {
  if (row.slotResult) return 'done';
  if (row.isLocked) return 'locked';
  if (row.isAvailable) return 'active';
  return 'idle';
}