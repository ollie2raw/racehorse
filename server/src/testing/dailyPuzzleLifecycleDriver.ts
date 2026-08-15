import {
  DEFAULT_CONFIG,
  getLegalMoves,
  type BoardState,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { DailyPuzzleSlot } from '../dailyPuzzle';

export type DailyPuzzleLifecycleRequest = (input: {
  path: string;
  method: 'POST';
  body: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

function buildPuzzleState(slot: DailyPuzzleSlot): GameState {
  const hand = slot.startingHand as Tile[];
  return {
    config: {
      ...DEFAULT_CONFIG,
      tilesPerPlayer: Math.max(1, hand.length),
      deadTileCount: 0,
      winningScore: 999,
    },
    playerIds: ['you', 'bot'],
    players: {
      you: { id: 'you', hand, score: 0 },
      bot: { id: 'bot', hand: [], score: 0 },
    },
    board: slot.startingBoard as BoardState,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

export function buildDailyPuzzleFirstLegalLine(slot: DailyPuzzleSlot): Array<Record<string, unknown>> {
  const move = getLegalMoves(buildPuzzleState(slot), 'you').find((candidate) => candidate.type === 'play');
  if (!move || move.type !== 'play' || !move.tile || !move.position) {
    throw new Error(`Daily Puzzle slot ${slot.slotIndex} has no legal opening move.`);
  }
  return [{ tile: move.tile, position: move.position }];
}

/** Drives the five-slot command contract without duplicating puzzle rules. */
export async function driveDailyPuzzleFiveSlotAttempt(input: {
  attemptId: string;
  puzzleDate: string;
  slots: DailyPuzzleSlot[];
  request: DailyPuzzleLifecycleRequest;
  assertSubmissionReplay?: boolean;
}): Promise<Record<string, unknown>> {
  if (input.slots.length !== 5) throw new Error(`Expected five Daily Puzzle slots, received ${input.slots.length}.`);
  const ordered = [...input.slots].sort((left, right) => left.slotIndex - right.slotIndex);
  const slotIdentity = ordered.map((slot) => slot.slotIndex).join(',');
  if (slotIdentity !== '1,2,3,4,5') {
    throw new Error(`Expected one Daily Puzzle slot for each index 1–5, received ${slotIdentity}.`);
  }

  for (const slot of ordered) {
    const body = {
      attemptId: input.attemptId,
      puzzleDate: input.puzzleDate,
      puzzleId: slot.id,
      slotIndex: slot.slotIndex,
      submittedLine: buildDailyPuzzleFirstLegalLine(slot),
      elapsedSeconds: 1,
      rawScore: 0,
      movesUsed: 1,
    };
    const submitted = await input.request({ path: '/api/daily-puzzle/submit-slot', method: 'POST', body });
    if (submitted.ok !== true) throw new Error(`Daily Puzzle slot ${slot.slotIndex} was not accepted.`);
    if (input.assertSubmissionReplay !== false) {
      const replayed = await input.request({ path: '/api/daily-puzzle/submit-slot', method: 'POST', body });
      if (replayed.replayed !== true) throw new Error(`Daily Puzzle slot ${slot.slotIndex} replay was not idempotent.`);
    }
  }

  const completed = await input.request({
    path: '/api/daily-puzzle/complete',
    method: 'POST',
    body: { attemptId: input.attemptId, puzzleDate: input.puzzleDate },
  });
  if (completed.ok !== true) throw new Error('Daily Puzzle completion was not accepted.');
  return completed;
}
