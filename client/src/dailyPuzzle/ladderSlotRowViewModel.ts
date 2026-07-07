import {
  getDailyPuzzleStepPresentation,
  type DailyPuzzleStepPresentation,
} from './presentation';
import type { DailyPuzzleSlot, DailyPuzzleSlotResult } from './types';

export type LadderSlotBreakdownChip = {
  slotIndex: number;
  label: string;
  value: string;
};

export type LadderSlotRowVariant = 'done' | 'active' | 'muted';

export type LadderSlotRowViewModel = {
  slotIndex: number;
  slot: DailyPuzzleSlot | undefined;
  slotResult: DailyPuzzleSlotResult | undefined;
  step: DailyPuzzleStepPresentation;
  rowVariant: LadderSlotRowVariant;
  statusSub: string;
  unlockHint: string | null;
  isLocked: boolean;
  isAvailable: boolean;
};

export function buildLadderSlotBreakdown(
  completedSlots: DailyPuzzleSlotResult[],
): LadderSlotBreakdownChip[] {
  return [1, 2, 3].map((slotIndex) => {
    const result = completedSlots.find((entry) => entry.slotIndex === slotIndex);
    const step = getDailyPuzzleStepPresentation(slotIndex);
    return {
      slotIndex,
      label: step.shortLabel,
      value: result ? `${result.awardedPoints}` : '—',
    };
  });
}

export function buildLadderSlotRows(params: {
  hubSlots: DailyPuzzleSlot[];
  completedSlots: DailyPuzzleSlotResult[];
  attemptStatus: 'started' | 'completed' | undefined;
  nextSlotIndex: 1 | 2 | 3 | null;
}): LadderSlotRowViewModel[] {
  const { hubSlots, completedSlots, attemptStatus, nextSlotIndex } = params;
  return [1, 2, 3].map((slotIndex) => {
    const slot = hubSlots.find((s) => s.slotIndex === slotIndex);
    const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
    const isCompleteRun = attemptStatus === 'completed';
    const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
    const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
    const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';
    const step = getDailyPuzzleStepPresentation(slotIndex);

    let statusSub: string;
    let unlockHint: string | null = null;
    if (slotResult) {
      statusSub = `Completed · ${slotResult.awardedPoints} pts`;
    } else if (isAvailable) {
      statusSub = 'Available now';
    } else if (isLocked) {
      statusSub = 'Locked';
      unlockHint = slotIndex === 2 ? 'Complete puzzle 1 to unlock' : 'Complete puzzle 2 to unlock';
    } else {
      statusSub = 'Up next';
    }

    return {
      slotIndex,
      slot,
      slotResult,
      step,
      rowVariant,
      statusSub,
      unlockHint,
      isLocked,
      isAvailable,
    };
  });
}

export function computeLadderTotalPoints(slots: DailyPuzzleSlot[]): number {
  return slots.reduce((sum, slot) => sum + (slot.slotMaxPoints ?? 0), 0);
}