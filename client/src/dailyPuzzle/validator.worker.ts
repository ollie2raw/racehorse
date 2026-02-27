/// <reference lib="webworker" />

import { computeBestPossiblePuzzleScore, validatePuzzle } from './validator';
import type { CuratedDailyPuzzle } from './types';

type ValidatorWorkerRequest =
  | { requestId: number; type: 'validate'; puzzleDate: string; puzzle: CuratedDailyPuzzle }
  | { requestId: number; type: 'bestScore'; puzzleDate: string; puzzle: CuratedDailyPuzzle };

type ValidatorWorkerResponse =
  | { requestId: number; type: 'validateResult'; puzzleDate: string; result: ReturnType<typeof validatePuzzle> }
  | {
      requestId: number;
      type: 'bestScoreResult';
      puzzleDate: string;
      score: ReturnType<typeof computeBestPossiblePuzzleScore>;
    }
  | { requestId: number; type: 'error'; puzzleDate: string; error: string };

const clonePuzzle = (puzzle: CuratedDailyPuzzle): CuratedDailyPuzzle =>
  JSON.parse(JSON.stringify(puzzle)) as CuratedDailyPuzzle;

self.onmessage = (event: MessageEvent<ValidatorWorkerRequest>) => {
  const message = event.data;
  try {
    const puzzle = clonePuzzle(message.puzzle);
    let response: ValidatorWorkerResponse;

    if (message.type === 'validate') {
      response = {
        requestId: message.requestId,
        type: 'validateResult',
        puzzleDate: message.puzzleDate,
        result: validatePuzzle(puzzle),
      };
    } else {
      response = {
        requestId: message.requestId,
        type: 'bestScoreResult',
        puzzleDate: message.puzzleDate,
        score: computeBestPossiblePuzzleScore(puzzle),
      };
    }

    self.postMessage(response);
  } catch (err) {
    const response: ValidatorWorkerResponse = {
      requestId: message.requestId,
      type: 'error',
      puzzleDate: message.puzzleDate,
      error: err instanceof Error ? err.message : 'Validator worker failed.',
    };
    self.postMessage(response);
  }
};

export {};
