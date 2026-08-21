import { useCallback, useRef, useState } from 'react';
import { completePuzzleRush, reportPuzzleRushPuzzle } from './api';
import type {
  PuzzleRushCompleteResponse,
  PuzzleRushPuzzle,
  PuzzleRushStartResponse,
  RushPuzzleResult,
} from './types';

export type RushRunPhase = 'playing' | 'completing' | 'complete';

/**
 * Run bookkeeping: which puzzle is current, the optimistic tally, and the
 * end-of-run settle-up.
 *
 * The whole puzzle set is held here from `/start` — there is no fetch during a
 * run, by design. `reportResult` deliberately does not await the network call;
 * see the comment on it.
 */
export function useRushRun(params: {
  start: PuzzleRushStartResponse;
  onAdvance?: (next: PuzzleRushPuzzle | null) => void;
}) {
  const { start, onAdvance } = params;

  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<RushPuzzleResult[]>([]);
  const [phase, setPhase] = useState<RushRunPhase>('playing');
  const [completion, setCompletion] = useState<PuzzleRushCompleteResponse | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [reportFailures, setReportFailures] = useState(0);
  const [tally, setTally] = useState(0);

  // Tally read synchronously by `finishRun`, which can fire from a clock tick
  // in the same frame a result lands — state alone would be a frame behind.
  const tallyRef = useRef(0);
  const resultsRef = useRef<RushPuzzleResult[]>([]);
  const finishingRef = useRef(false);

  const puzzles = start.puzzles;
  const current: PuzzleRushPuzzle | null = puzzles[index] ?? null;

  /**
   * Record a finished puzzle and move on.
   *
   * The `void` on the report call is load-bearing: the server does no engine
   * work at report time, and waiting on the response would put network latency
   * inside a live run clock. A failed report is counted and surfaced after the
   * run, never mid-run — the puzzle still counts locally and the server will
   * simply grade the reports it received.
   */
  const reportResult = useCallback(
    (result: RushPuzzleResult) => {
      // Raw board score, not points — see rushScoring.sumRawScore.
      tallyRef.current += Math.max(0, result.rawScore);
      setTally(tallyRef.current);
      resultsRef.current = [...resultsRef.current, result];
      setResults(resultsRef.current);

      void reportPuzzleRushPuzzle({
        runId: start.run.id,
        puzzleId: result.puzzleId,
        ordinal: result.ordinal,
        clientRawScore: result.rawScore,
        submittedLine: result.submittedLine,
        stageReachedKey: result.stageKey,
      }).catch(() => {
        setReportFailures((count) => count + 1);
      });

      setIndex((previous) => {
        const nextIndex = previous + 1;
        onAdvance?.(puzzles[nextIndex] ?? null);
        return nextIndex;
      });
    },
    [onAdvance, puzzles, start.run.id],
  );

  /** End the run and settle up against the server's replay. Idempotent. */
  const finishRun = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('completing');
    setCompleteError(null);
    try {
      const response = await completePuzzleRush({
        runId: start.run.id,
        clientReportedScore: tallyRef.current,
      });
      setCompletion(response);
    } catch (error) {
      setCompleteError(
        error instanceof Error ? error.message : 'Could not finish this run. Try again.',
      );
    } finally {
      setPhase('complete');
    }
  }, [start.run.id]);

  const completedOrdinals = results.map((result) => result.ordinal);
  const outOfPuzzles = index >= puzzles.length;

  return {
    index,
    current,
    puzzles,
    stages: start.stages,
    results,
    completedOrdinals,
    clientTally: tally,
    outOfPuzzles,
    phase,
    completion,
    completeError,
    reportFailures,
    reportResult,
    finishRun,
  };
}
