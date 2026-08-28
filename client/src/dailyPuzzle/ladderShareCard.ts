import { buildShareGridRow } from '../lib/shareGrid';
import { SITE_DOMAIN } from '../lib/siteUrl';
import type { DailyPuzzleAttempt } from './types';
import { DAILY_PUZZLE_SLOT_INDICES } from './types';

export type DailyPuzzleLadderShareData = {
  shareDate: string;
  totalScore: number;
  rank: number | null;
  slotLines: string[];
  shareStreak?: number;
  shareRating?: number;
};

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function buildLadderShareData(params: {
  runDate: string;
  attempt: DailyPuzzleAttempt;
  rank?: number | null;
  shareStreak?: number;
  shareRating?: number;
}): DailyPuzzleLadderShareData {
  const slots = params.attempt.result.slots;
  const slotLines = DAILY_PUZZLE_SLOT_INDICES.map((slotIndex) => {
    const result = slots.find((entry) => entry.slotIndex === slotIndex);
    if (!result) return buildShareGridRow(null, 'none');
    const tone = result.perfect ? 'skunk' : result.solved ? 'win' : 'loss';
    const ratio = result.slotMaxPoints > 0 ? result.awardedPoints / result.slotMaxPoints : 0;
    return buildShareGridRow(ratio, tone);
  });

  return {
    shareDate: formatDateLabel(params.runDate),
    totalScore: params.attempt.totalScore,
    rank: params.rank ?? null,
    slotLines,
    shareStreak: params.shareStreak,
    shareRating: params.shareRating,
  };
}

export function buildLadderShareText(data: DailyPuzzleLadderShareData): string {
  const rankPart =
    data.rank != null ? `${data.totalScore} PTS · Rank #${data.rank}` : `${data.totalScore} PTS`;
  const streak = data.shareStreak ? `${data.shareStreak}-day streak` : '';
  const rating = data.shareRating ? `${data.shareRating} rating` : '';
  const meta = [streak, rating].filter(Boolean).join(' · ');

  const lines = [
    `Daily Puzzle Ladder · ${data.shareDate}`,
    rankPart,
    // One row per slot: the grid has to stack, not run on.
    data.slotLines.join('\n'),
    meta,
    SITE_DOMAIN,
  ].filter(Boolean);

  return lines.join('\n');
}

export function invokeLadderShareResult(text: string, onShared?: () => void): void {
  if (!text) return;
  const markShared = (): void => {
    onShared?.();
  };
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    void navigator
      .share({ title: 'Daily Puzzle Ladder', text })
      .then(() => {
        markShared();
      })
      .catch(() => {
        /* user dismissed native share */
      });
    return;
  }
  void navigator.clipboard.writeText(text).then(() => {
    markShared();
  });
}
