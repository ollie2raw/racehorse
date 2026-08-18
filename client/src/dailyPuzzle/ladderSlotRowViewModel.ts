import {
  getDailyPuzzleStepPresentation,
  type DailyPuzzleStepPresentation,
} from './presentation';
import type { DailyPuzzleSlot, DailyPuzzleSlotResult } from './types';
import {
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
  LEGACY_DAILY_PUZZLE_SLOT_INDICES,
  type DailyPuzzleSlotIndex,
} from './types';

export type LadderSlotBreakdownChip = {
  slotIndex: DailyPuzzleSlotIndex;
  label: string;
  value: string;
};

export type LadderSlotRowVariant = 'done' | 'active' | 'muted';

export type LadderSlotRowViewModel = {
  slotIndex: DailyPuzzleSlotIndex;
  slot: DailyPuzzleSlot | undefined;
  slotResult: DailyPuzzleSlotResult | undefined;
  step: DailyPuzzleStepPresentation;
  rowVariant: LadderSlotRowVariant;
  statusSub: string;
  unlockHint: string | null;
  isLocked: boolean;
  isAvailable: boolean;
};

function ladderIndicesForSlots(slots: Array<{ slotIndex: number }>): readonly DailyPuzzleSlotIndex[] {
  return slots.some((slot) => slot.slotIndex > DAILY_PUZZLE_SLOT_COUNT)
    ? LEGACY_DAILY_PUZZLE_SLOT_INDICES
    : DAILY_PUZZLE_SLOT_INDICES;
}

export function buildLadderSlotBreakdown(
  completedSlots: DailyPuzzleSlotResult[],
): LadderSlotBreakdownChip[] {
  return ladderIndicesForSlots(completedSlots).map((slotIndex) => {
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
  nextSlotIndex: DailyPuzzleSlotIndex | null;
}): LadderSlotRowViewModel[] {
  const { hubSlots, completedSlots, attemptStatus, nextSlotIndex } = params;
  const indices = ladderIndicesForSlots(hubSlots);
  const isThreeRung = indices.length === DAILY_PUZZLE_SLOT_COUNT;
  return indices.map((slotIndex) => {
    const slot = hubSlots.find((s) => s.slotIndex === slotIndex);
    const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
    const isCompleteRun = attemptStatus === 'completed';
    const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
    const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
    const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';
    const step = getDailyPuzzleStepPresentation(slotIndex, slot?.slotTitle ?? `Puzzle ${slotIndex}`);

    let statusSub: string;
    let unlockHint: string | null = null;
    if (slotResult) {
      statusSub = `Completed · ${slotResult.awardedPoints} pts`;
    } else if (isAvailable) {
      statusSub = 'Available now';
    } else if (isLocked) {
      const isOptionalMaster = isThreeRung && slotIndex === DAILY_PUZZLE_SLOT_COUNT;
      statusSub = isOptionalMaster ? 'Optional' : 'Locked';
      unlockHint = isOptionalMaster
        ? 'Optional · finish Read to unlock'
        : `Complete puzzle ${slotIndex - 1} to unlock`;
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
