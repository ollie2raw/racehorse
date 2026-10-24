import { useCallback, useEffect, useRef } from 'react';
import type { BotPlayerId } from '../runtime/botEngine.ts';
import type { BotMatchScreenProps } from '../types.ts';

type JourneyTrial = NonNullable<BotMatchScreenProps['journeyTrial']>;

export type UseJourneyTrialAttemptArgs = {
  journeyTrial: BotMatchScreenProps['journeyTrial'];
  /** Authoritative local game state — never navigation or presentation state. */
  gameOver: boolean;
  winnerId: BotPlayerId | null;
  youScore: number;
  botScore: number;
  onSettled: BotMatchScreenProps['onJourneyTrialSettled'];
  onRematch: BotMatchScreenProps['onJourneyTrialRematch'];
};

/**
 * Tracks which Journey attempt the live match belongs to and reports its result exactly once.
 *
 * The match component owns *when* a result exists (game over, with a winner); the Journey layer owns
 * what to do with it. The settle callback is guarded here (one report per attempt id) and again by the
 * attempt store (a terminal attempt never changes), so re-renders, effect re-runs and StrictMode
 * cannot duplicate a result. A rematch gets a fresh attempt id from the owner, so the next game over
 * is reported against the new attempt.
 *
 * The attempt id is read from the launch once; after that this hook is the source of truth (a rematch
 * swaps it), because the launching route does not re-render when the attempt changes.
 */
export function useJourneyTrialAttempt({
  journeyTrial,
  gameOver,
  winnerId,
  youScore,
  botScore,
  onSettled,
  onRematch,
}: UseJourneyTrialAttemptArgs) {
  const attemptIdRef = useRef<string | null>(journeyTrial?.attemptId || null);
  const reportedAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!journeyTrial || !gameOver || !winnerId) return;
    const attemptId = attemptIdRef.current;
    if (!attemptId || reportedAttemptRef.current === attemptId) return;
    reportedAttemptRef.current = attemptId;
    onSettled?.({
      attemptId,
      nodeId: journeyTrial.nodeId,
      won: winnerId === 'you',
      finalScore: { you: youScore, bot: botScore },
    });
  }, [journeyTrial, gameOver, winnerId, youScore, botScore, onSettled]);

  const getAttemptId = useCallback(() => attemptIdRef.current, []);

  /** Call when a rematch starts. Returns the new attempt id, or null when there is no Journey trial. */
  const beginRematchAttempt = useCallback((trial: JourneyTrial | null | undefined): string | null => {
    const previous = attemptIdRef.current;
    if (!trial || !previous || !onRematch) return null;
    const next = onRematch(previous);
    if (next) {
      attemptIdRef.current = next;
      reportedAttemptRef.current = null;
    }
    return next;
  }, [onRematch]);

  return { getAttemptId, beginRematchAttempt };
}
