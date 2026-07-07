import { useCallback, useRef, useState } from 'react';
import type { TournamentResultView } from '../../../tournament/types';
import { readTerminalTournamentMatchIds } from '../../../tournament/terminalMatches';
import type { TournamentMatchContext, TournamentSubView } from './tournamentMatchSessionTypes';

export function useTournamentSessionState() {
  const [tournamentSubView, setTournamentSubView] = useState<TournamentSubView>('hub');
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [tournamentMatch, setTournamentMatch] = useState<TournamentMatchContext | null>(null);
  const [completedTournamentId, setCompletedTournamentId] = useState<string | null>(null);
  const [consumedTournamentGameOverMatchIds, setConsumedTournamentGameOverMatchIds] = useState<
    ReadonlySet<string>
  >(() => new Set(readTerminalTournamentMatchIds()));

  const markTournamentGameOverConsumed = useCallback((matchId: string) => {
    setConsumedTournamentGameOverMatchIds((prev) => {
      if (prev.has(matchId)) return prev;
      const next = new Set(prev);
      next.add(matchId);
      return next;
    });
  }, []);

  const dismissedTournamentIdsRef = useRef<Set<string>>(new Set());
  const [tournamentResult, setTournamentResult] = useState<TournamentResultView | null>(null);
  const [tournamentResultLoading, setTournamentResultLoading] = useState(false);
  const [tournamentResultError, setTournamentResultError] = useState<string | null>(null);
  const [tournamentAttachPhase, setTournamentAttachPhase] = useState<'idle' | 'pending' | 'failed'>(
    'idle',
  );
  const [tournamentAttachError, setTournamentAttachError] = useState<string | null>(null);

  return {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    completedTournamentId,
    setCompletedTournamentId,
    consumedTournamentGameOverMatchIds,
    markTournamentGameOverConsumed,
    dismissedTournamentIdsRef,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    tournamentAttachPhase,
    setTournamentAttachPhase,
    tournamentAttachError,
    setTournamentAttachError,
  };
}

export type TournamentSessionState = ReturnType<typeof useTournamentSessionState>;