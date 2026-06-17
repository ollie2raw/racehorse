import { JOURNEY_BRIEFINGS, type JourneyBriefing } from './journeyBriefings.ts';
import { JOURNEY_PUZZLES, type JourneyPuzzle } from './journeyPuzzles.ts';
import { CHAPTER_6_BRIEFINGS, CHAPTER_6_PUZZLES } from './chapters/ch6MasterTable.content.ts';

/** Per-chapter content registries (Ch1–5 remain in global files for now). */
const CHAPTER_BRIEFING_REGISTRIES: Record<string, JourneyBriefing>[] = [CHAPTER_6_BRIEFINGS];

const CHAPTER_PUZZLE_REGISTRIES: Record<string, JourneyPuzzle>[] = [CHAPTER_6_PUZZLES];

function lookupBriefing(nodeId: string): JourneyBriefing | null {
  if (JOURNEY_BRIEFINGS[nodeId]) return JOURNEY_BRIEFINGS[nodeId];
  for (const registry of CHAPTER_BRIEFING_REGISTRIES) {
    if (registry[nodeId]) return registry[nodeId];
  }
  return null;
}

function lookupPuzzle(nodeId: string): JourneyPuzzle | null {
  if (JOURNEY_PUZZLES[nodeId]) return JOURNEY_PUZZLES[nodeId];
  for (const registry of CHAPTER_PUZZLE_REGISTRIES) {
    if (registry[nodeId]) return registry[nodeId];
  }
  return null;
}

export function getJourneyBriefing(nodeId: string): JourneyBriefing | null {
  return lookupBriefing(nodeId);
}

export function hasJourneyBriefing(nodeId: string): boolean {
  return lookupBriefing(nodeId) !== null;
}

export function getJourneyPuzzle(nodeId: string): JourneyPuzzle | null {
  return lookupPuzzle(nodeId);
}

export function hasJourneyPuzzle(nodeId: string): boolean {
  return lookupPuzzle(nodeId) !== null;
}

export function getAllJourneyBriefingEntries(): [string, JourneyBriefing][] {
  const entries: [string, JourneyBriefing][] = Object.entries(JOURNEY_BRIEFINGS);
  for (const registry of CHAPTER_BRIEFING_REGISTRIES) {
    entries.push(...Object.entries(registry));
  }
  return entries;
}

export function getAllJourneyPuzzleEntries(): [string, JourneyPuzzle][] {
  const entries: [string, JourneyPuzzle][] = Object.entries(JOURNEY_PUZZLES);
  for (const registry of CHAPTER_PUZZLE_REGISTRIES) {
    entries.push(...Object.entries(registry));
  }
  return entries;
}
