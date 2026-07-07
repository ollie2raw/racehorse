import { normalizeDateInputToLocalKey } from './date';
import { formatPuzzleElapsed } from './dailyPuzzleScreenHelpers';
import type { DailyPuzzleLeaderboardEntry } from './api';
import type { LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';

const COMPLETE_ARCHIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCompleteArchiveDateInput(value: string): boolean {
  return COMPLETE_ARCHIVE_DATE_PATTERN.test(value);
}

export function isArchiveModeForDate(selectedDateSeed: string, localDateKey: string): boolean {
  return selectedDateSeed !== localDateKey;
}

export function isArchiveDateDirty(archiveDateInput: string, selectedDateSeed: string): boolean {
  return archiveDateInput !== selectedDateSeed;
}

export function resolveArchiveTargetDate(
  archiveDateInput: string,
  selectedDateSeed: string,
): string {
  const archiveInputHasCompleteDate = isCompleteArchiveDateInput(archiveDateInput);
  return archiveInputHasCompleteDate
    ? normalizeDateInputToLocalKey(archiveDateInput)
    : selectedDateSeed;
}

export function resolveDisplayDateSeed(params: {
  puzzleDate: string | null | undefined;
  showLobby: boolean;
  archiveTargetDate: string;
  selectedDateSeed: string;
}): string {
  const { puzzleDate, showLobby, archiveTargetDate, selectedDateSeed } = params;
  return puzzleDate ?? (showLobby ? archiveTargetDate : selectedDateSeed);
}

export function isSelectedPuzzleReady(
  puzzleDate: string | null | undefined,
  selectedDateSeed: string,
): boolean {
  return puzzleDate === selectedDateSeed;
}

export function findCurrentLeaderboardIndex(
  leaderboard: DailyPuzzleLeaderboardEntry[],
  userId: string | null,
): number {
  if (!userId) return -1;
  return leaderboard.findIndex((row) => row.userId === userId);
}

export function buildLeaderboardSummaryCards(params: {
  currentLeaderboardIndex: number;
  currentLeaderboardRow: DailyPuzzleLeaderboardEntry | null;
}): LeaderboardSummaryCard[] {
  const { currentLeaderboardIndex, currentLeaderboardRow } = params;
  return [
    {
      label: 'Your Rank',
      value: currentLeaderboardIndex >= 0 ? `#${currentLeaderboardIndex + 1}` : '—',
      sublabel: 'Today’s placement',
      tone: 'accent',
    },
    {
      label: 'Score',
      value: currentLeaderboardRow ? `${currentLeaderboardRow.bestScore}` : '—',
      sublabel: currentLeaderboardRow ? 'Best submitted run' : 'No submitted score yet',
      tone: 'neutral',
    },
    {
      label: 'Moves',
      value: currentLeaderboardRow ? `${currentLeaderboardRow.bestMovesUsed}` : '—',
      sublabel: 'Tiles used',
      tone: 'neutral',
    },
    {
      label: 'Time',
      value: currentLeaderboardRow ? formatPuzzleElapsed(currentLeaderboardRow.bestSeconds) : '—',
      sublabel: 'Best finish time',
      tone: 'neutral',
    },
  ];
}

export function sliceLeaderboardModalPreview(
  leaderboard: DailyPuzzleLeaderboardEntry[],
  limit = 20,
): DailyPuzzleLeaderboardEntry[] {
  return leaderboard.slice(0, limit);
}