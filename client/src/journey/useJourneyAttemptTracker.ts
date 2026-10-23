import { useCallback, useEffect, useRef } from 'react';
import {
  settleJourneyAttempt,
  startJourneyAttempt,
  type JourneyAttemptDetail,
  type JourneyAttemptKind,
  type JourneyAttemptTerminalState,
} from './journeyAttempts';

/**
 * One in-flight attempt for a screen-hosted stage (a lesson or a sprint).
 *
 * `start` opens an attempt (abandoning any previous one that never finished); `settle` ends it with a
 * terminal outcome. Settling is idempotent — the attempt store never rewrites a terminal attempt — so
 * completion callbacks that fire more than once are harmless. If the screen unmounts while an attempt
 * is open (navigation away), it is recorded as abandoned rather than left dangling.
 */
export function useJourneyAttemptTracker(kind: JourneyAttemptKind) {
  const attemptIdRef = useRef<string | null>(null);

  const start = useCallback(
    (nodeId: string, detail?: JourneyAttemptDetail) => {
      if (attemptIdRef.current) settleJourneyAttempt(attemptIdRef.current, 'abandoned');
      attemptIdRef.current = startJourneyAttempt({ nodeId, kind, detail }).attemptId;
    },
    [kind],
  );

  /** The open attempt's ID, for callers that record a validated completion against it. Read in handlers only. */
  const getAttemptId = useCallback(() => attemptIdRef.current, []);

  const settle = useCallback((outcome: JourneyAttemptTerminalState) => {
    if (attemptIdRef.current) settleJourneyAttempt(attemptIdRef.current, outcome);
  }, []);

  useEffect(() => {
    const trackedAttemptId = attemptIdRef;
    return () => {
      if (trackedAttemptId.current) settleJourneyAttempt(trackedAttemptId.current, 'abandoned');
    };
  }, []);

  return { start, settle, getAttemptId };
}
