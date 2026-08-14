// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DailyPuzzleLeaderboardEntry } from './api';
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

function makeLeaderboardRow(
  overrides: Partial<DailyPuzzleLeaderboardEntry> = {},
): DailyPuzzleLeaderboardEntry {
  return {
    userId: 'user-1',
    username: 'player',
    bestScore: 42,
    bestMovesUsed: 3,
    bestSeconds: 90,
    updatedAt: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

describe('isCompleteArchiveDateInput', () => {
  it('accepts YYYY-MM-DD and rejects partial values', () => {
    expect(isCompleteArchiveDateInput('2024-06-01')).toBe(true);
    expect(isCompleteArchiveDateInput('2024-06')).toBe(false);
    expect(isCompleteArchiveDateInput('')).toBe(false);
  });
});

describe('archive date derivations', () => {
  it('detects archive mode when selected date differs from local today', () => {
    expect(isArchiveModeForDate('2024-05-01', '2024-06-01')).toBe(true);
    expect(isArchiveModeForDate('2024-06-01', '2024-06-01')).toBe(false);
  });

  it('detects dirty archive input vs committed seed', () => {
    expect(isArchiveDateDirty('2024-05-15', '2024-06-01')).toBe(true);
    expect(isArchiveDateDirty('2024-06-01', '2024-06-01')).toBe(false);
  });

  it('resolves archive target from complete input or falls back to selected seed', () => {
    expect(resolveArchiveTargetDate('2024-05-10', '2024-06-01')).toBe('2024-05-10');
    expect(resolveArchiveTargetDate('2024-05', '2024-06-01')).toBe('2024-06-01');
  });

  it('resolves display date seed with puzzle override and lobby archive target', () => {
    expect(
      resolveDisplayDateSeed({
        puzzleDate: '2024-06-02',
        showLobby: true,
        archiveTargetDate: '2024-05-01',
        selectedDateSeed: '2024-06-01',
      }),
    ).toBe('2024-06-02');
    expect(
      resolveDisplayDateSeed({
        puzzleDate: null,
        showLobby: true,
        archiveTargetDate: '2024-05-01',
        selectedDateSeed: '2024-06-01',
      }),
    ).toBe('2024-05-01');
    expect(
      resolveDisplayDateSeed({
        puzzleDate: null,
        showLobby: false,
        archiveTargetDate: '2024-05-01',
        selectedDateSeed: '2024-06-01',
      }),
    ).toBe('2024-06-01');
  });

  it('reports selected puzzle readiness when dates match', () => {
    expect(isSelectedPuzzleReady('2024-06-01', '2024-06-01')).toBe(true);
    expect(isSelectedPuzzleReady('2024-05-01', '2024-06-01')).toBe(false);
    expect(isSelectedPuzzleReady(undefined, '2024-06-01')).toBe(false);
  });
});

describe('leaderboard display helpers', () => {
  const leaderboard = [
    makeLeaderboardRow({ userId: 'a', bestScore: 10 }),
    makeLeaderboardRow({ userId: 'b', bestScore: 20, bestMovesUsed: 2, bestSeconds: 60 }),
  ];

  it('finds current user row index', () => {
    expect(findCurrentLeaderboardIndex(leaderboard, 'b')).toBe(1);
    expect(findCurrentLeaderboardIndex(leaderboard, null)).toBe(-1);
    expect(findCurrentLeaderboardIndex(leaderboard, 'missing')).toBe(-1);
  });

  it('builds summary cards for current user row', () => {
    const cards = buildLeaderboardSummaryCards({
      currentLeaderboardIndex: 1,
      currentLeaderboardRow: leaderboard[1],
    });
    expect(cards[0]).toMatchObject({ label: 'Your Rank', value: '#2' });
    expect(cards[1]).toMatchObject({ label: 'Score', value: '20' });
    expect(cards[2]).toMatchObject({ label: 'Moves', value: '2' });
    expect(cards[3].label).toBe('Time');
    expect(cards[3].value).toBeTruthy();
  });

  it('uses em dash placeholders when user has no row', () => {
    const cards = buildLeaderboardSummaryCards({
      currentLeaderboardIndex: -1,
      currentLeaderboardRow: null,
    });
    expect(cards.map((card) => card.value)).toEqual(['—', '—', '—', '—']);
  });

  it('slices leaderboard rows for modal preview', () => {
    const rows = Array.from({ length: 25 }, (_, idx) =>
      makeLeaderboardRow({ userId: `u-${idx}`, bestScore: idx }),
    );
    expect(sliceLeaderboardModalPreview(rows)).toHaveLength(20);
    expect(sliceLeaderboardModalPreview(rows)[0].userId).toBe('u-0');
  });
});