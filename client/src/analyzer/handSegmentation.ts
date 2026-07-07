import type { BoardState } from '../types';
import type { HandMoveSegment } from './analysisTypes';
import type { MoveEntry } from '../game/moveLogger';

function isBoardEmpty(board: BoardState | null | undefined): boolean {
  return !board?.mainLine?.length;
}

function scoreAfterEntry(
  you: number,
  opp: number,
  entry: MoveEntry,
): { you: number; opp: number } {
  if (entry.player === 'you') {
    return { you: you + (entry.pointsScored ?? 0), opp };
  }
  return { you, opp: opp + (entry.pointsScored ?? 0) };
}

function buildSegment(
  handNumber: number,
  entries: MoveEntry[],
  startingScores: { you: number; opponent: number },
): HandMoveSegment {
  let you = startingScores.you;
  let opp = startingScores.opponent;
  for (const entry of entries) {
    const next = scoreAfterEntry(you, opp, entry);
    you = next.you;
    opp = next.opp;
  }
  return {
    handNumber,
    entries,
    startingScores,
    endingScores: { you, opponent: opp },
  };
}

function segmentByExplicitHandNumber(entries: MoveEntry[]): HandMoveSegment[] | null {
  if (!entries.some((entry) => entry.handNumber != null)) return null;

  const byHand = new Map<number, MoveEntry[]>();
  for (const entry of entries) {
    const handNumber = entry.handNumber ?? 1;
    const list = byHand.get(handNumber) ?? [];
    list.push(entry);
    byHand.set(handNumber, list);
  }

  const segments: HandMoveSegment[] = [];
  let runningYou = 0;
  let runningOpp = 0;
  const handNumbers = [...byHand.keys()].sort((a, b) => a - b);
  for (const handNumber of handNumbers) {
    const handEntries = byHand.get(handNumber) ?? [];
    const startingScores = { you: runningYou, opponent: runningOpp };
    const segment = buildSegment(handNumber, handEntries, startingScores);
    segments.push(segment);
    runningYou = segment.endingScores.you;
    runningOpp = segment.endingScores.opponent;
  }
  return segments;
}

/** Group move log entries into per-hand segments (hand-as-round model). */
export function segmentMoveLogByHand(entries: MoveEntry[]): HandMoveSegment[] {
  if (entries.length === 0) return [];

  const explicit = segmentByExplicitHandNumber(entries);
  if (explicit) return explicit;

  const segments: HandMoveSegment[] = [];
  let current: MoveEntry[] = [];
  let seenBoardPlay = false;
  let handNumber = 1;
  let runningYou = 0;
  let runningOpp = 0;
  let segmentStart = { you: 0, opponent: 0 };

  const flush = () => {
    if (current.length === 0) return;
    segments.push(buildSegment(handNumber, current, segmentStart));
    runningYou = segments[segments.length - 1]!.endingScores.you;
    runningOpp = segments[segments.length - 1]!.endingScores.opponent;
    handNumber += 1;
    current = [];
    seenBoardPlay = false;
    segmentStart = { you: runningYou, opponent: runningOpp };
  };

  for (const entry of entries) {
    const boardEmpty = isBoardEmpty(entry.boardRenderState);
    if (boardEmpty && seenBoardPlay && current.length > 0) {
      flush();
    }
    current.push(entry);
    if (!boardEmpty) seenBoardPlay = true;
  }
  flush();

  return segments;
}

export function handPointsInSegment(segment: HandMoveSegment): { you: number; opponent: number } {
  let you = 0;
  let opponent = 0;
  for (const entry of segment.entries) {
    const pts = entry.pointsScored ?? 0;
    if (entry.player === 'you') you += pts;
    else opponent += pts;
  }
  return { you, opponent };
}

export function buildHandVerdict(segment: HandMoveSegment): {
  winner: 'you' | 'opponent' | 'tie';
  pointsYou: number;
  pointsOpponent: number;
  margin: number;
} {
  const { you, opponent } = handPointsInSegment(segment);
  const margin = you - opponent;
  const winner = margin > 0 ? 'you' : margin < 0 ? 'opponent' : 'tie';
  return { winner, pointsYou: you, pointsOpponent: opponent, margin: Math.abs(margin) };
}
