import { getDailyPuzzleDisplayTitle } from './presentation';
import type { CuratedDailyPuzzle, DailyPuzzleSlot } from './types';

export function toCuratedPuzzle(slot: DailyPuzzleSlot): CuratedDailyPuzzle | null {
  if (!slot.startingBoard || !slot.startingHand) return null;
  return {
    id: slot.id,
    puzzleDate: slot.puzzleDate,
    title: getDailyPuzzleDisplayTitle(slot.slotIndex, slot.slotTitle),
    startingBoard: slot.startingBoard,
    startingHand: slot.startingHand,
    maxMoves: slot.maxMoves,
    targetScore: slot.targetScore,
    puzzleType: slot.puzzleType,
    dealSize: slot.dealSize,
    slotIndex: slot.slotIndex,
    slotTitle: slot.slotTitle,
    tier: slot.tier,
    slotMaxPoints: slot.slotMaxPoints,
    objectiveType: slot.objectiveType,
    objectivePayload: slot.objectivePayload,
    setVersion: 1,
    published: true,
  };
}