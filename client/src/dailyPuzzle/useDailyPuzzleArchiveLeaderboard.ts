import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchDailyPuzzleLeaderboard, type DailyPuzzleLeaderboardEntry } from './api';
import { normalizeDateInputToLocalKey } from './date';
import {
  buildLeaderboardSummaryCards,
  findCurrentLeaderboardIndex,
  isArchiveDateDirty,
  isArchiveModeForDate,
  isCompleteArchiveDateInput,
  isSelectedPuzzleReady,
  resolveArchiveTargetDate,
  resolveDisplayDateSeed,
  sliceLeaderboardModalPreview,
} from './dailyPuzzleArchiveLeaderboardHelpers';
import type { LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';

export type UseDailyPuzzleArchiveLeaderboardParams = {
  localDateKey: string;
  userId: string | null;
  puzzleDate: string | null | undefined;
  showLobby: boolean;
};

export function useDailyPuzzleArchiveLeaderboard({
  localDateKey,
  userId,
  puzzleDate,
  showLobby,
}: UseDailyPuzzleArchiveLeaderboardParams) {
  const [selectedDateSeed, setSelectedDateSeed] = useState(localDateKey);
  const [archiveDateInput, setArchiveDateInput] = useState(localDateKey);
  const [archivePickerOpen, setArchivePickerOpen] = useState(false);
  const [dailyLeaderboardOpen, setDailyLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const leaderboardLoadIdRef = useRef(0);
  const leaderboardInFlightDateRef = useRef<string | null>(null);

  const isArchiveMode = isArchiveModeForDate(selectedDateSeed, localDateKey);
  const archiveInputHasCompleteDate = isCompleteArchiveDateInput(archiveDateInput);
  const archiveDateDirty = isArchiveDateDirty(archiveDateInput, selectedDateSeed);
  const archiveTargetDate = resolveArchiveTargetDate(archiveDateInput, selectedDateSeed);
  const archiveTargetIsToday = archiveTargetDate === localDateKey;
  const displayDateSeed = resolveDisplayDateSeed({
    puzzleDate,
    showLobby,
    archiveTargetDate,
    selectedDateSeed,
  });
  const selectedPuzzleReady = isSelectedPuzzleReady(puzzleDate, selectedDateSeed);

  const closeArchiveLeaderboardUi = useCallback(() => {
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
  }, []);

  const applyArchiveDate = useCallback(() => {
    if (!archiveInputHasCompleteDate) return;
    const nextDate = normalizeDateInputToLocalKey(archiveDateInput);
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setDailyLeaderboardOpen(false);
  }, [archiveDateInput, archiveInputHasCompleteDate]);

  const resetArchiveToToday = useCallback(() => {
    setArchiveDateInput(localDateKey);
    setSelectedDateSeed(localDateKey);
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
  }, [localDateKey]);

  const commitArchiveDateSelection = useCallback((nextDate: string) => {
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setDailyLeaderboardOpen(false);
  }, []);

  const refreshLeaderboard = useCallback(async (puzzleDateKey: string) => {
    if (leaderboardInFlightDateRef.current === puzzleDateKey) {
      return;
    }

    const requestId = ++leaderboardLoadIdRef.current;
    leaderboardInFlightDateRef.current = puzzleDateKey;
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLeaderboard(puzzleDateKey, 20);
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard(rows);
    } catch {
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard([]);
    } finally {
      if (requestId === leaderboardLoadIdRef.current) {
        setLeaderboardLoading(false);
      }
      if (leaderboardInFlightDateRef.current === puzzleDateKey) {
        leaderboardInFlightDateRef.current = null;
      }
    }
  }, []);

  const currentLeaderboardIndex = useMemo(
    () => findCurrentLeaderboardIndex(leaderboard, userId),
    [leaderboard, userId],
  );
  const currentLeaderboardRow =
    currentLeaderboardIndex >= 0 ? leaderboard[currentLeaderboardIndex] ?? null : null;
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(
    () =>
      buildLeaderboardSummaryCards({
        currentLeaderboardIndex,
        currentLeaderboardRow,
      }),
    [currentLeaderboardIndex, currentLeaderboardRow],
  );
  const modalLeaderboardPreview = useMemo(
    () => sliceLeaderboardModalPreview(leaderboard),
    [leaderboard],
  );

  return {
    selectedDateSeed,
    setSelectedDateSeed,
    archiveDateInput,
    setArchiveDateInput,
    archivePickerOpen,
    setArchivePickerOpen,
    isArchiveMode,
    archiveInputHasCompleteDate,
    archiveDateDirty,
    archiveTargetDate,
    archiveTargetIsToday,
    displayDateSeed,
    selectedPuzzleReady,
    applyArchiveDate,
    resetArchiveToToday,
    commitArchiveDateSelection,
    closeArchiveLeaderboardUi,
    dailyLeaderboardOpen,
    setDailyLeaderboardOpen,
    leaderboard,
    setLeaderboard,
    leaderboardLoading,
    refreshLeaderboard,
    leaderboardSummaryCards,
    modalLeaderboardPreview,
    currentLeaderboardIndex,
    currentLeaderboardRow,
  };
}