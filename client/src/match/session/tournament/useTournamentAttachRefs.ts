import { useCallback, useRef } from 'react';

export function useTournamentAttachRefs() {
  const pendingTournamentAttachMatchIdRef = useRef<string | null>(null);
  const attachedTournamentMatchIdRef = useRef<string | null>(null);
  const failedTournamentAttachByMatchIdRef = useRef<Record<string, number>>({});
  const attachInFlightRef = useRef<string | null>(null);
  const matchFinalizedRef = useRef<Set<string>>(new Set());

  const clearTournamentAttachRefs = useCallback(() => {
    pendingTournamentAttachMatchIdRef.current = null;
    attachedTournamentMatchIdRef.current = null;
  }, []);

  return {
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    failedTournamentAttachByMatchIdRef,
    attachInFlightRef,
    matchFinalizedRef,
    clearTournamentAttachRefs,
  };
}

export type TournamentAttachRefs = ReturnType<typeof useTournamentAttachRefs>;