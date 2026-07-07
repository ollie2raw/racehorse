import { useEffect } from 'react';
import type { AppMode } from '../../../types';
import {
  deriveBracketTerminalState,
  isTournamentBracketTerminal,
  msUntilBracketAutoKick,
} from '../../../tournament/bracketTerminal';
import type { TournamentSessionState } from './useTournamentSessionState';
import type { TournamentSessionNavigation } from './useTournamentSessionNavigation';
import type { TournamentHookApi } from './tournamentMatchSessionTypes';

type UseTournamentBracketTerminalParams = {
  appMode: AppMode;
  authUserId: string | null;
  tournament: TournamentHookApi;
  sessionState: TournamentSessionState;
  navigation: TournamentSessionNavigation;
};

export function useTournamentBracketTerminal({
  appMode,
  authUserId,
  tournament,
  sessionState,
  navigation,
}: UseTournamentBracketTerminalParams) {
  const {
    tournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    setTournamentSubView,
    dismissedTournamentIdsRef,
  } = sessionState;

  const { exitToTournamentHub } = navigation;

  useEffect(() => {
    if (appMode !== 'tournament') return;
    const tid = tournament.activeTournamentId;
    const phase = tournament.tournamentPhase;
    if (!tid || !phase) return;
    if (dismissedTournamentIdsRef.current.has(tid)) return;

    const bracket =
      tournament.activeBracket?.tournament.id === tid ? tournament.activeBracket : null;
    const terminal = deriveBracketTerminalState({
      bracket,
      userId: authUserId,
      tournamentPhase: phase,
      assignedMatch:
        tournament.assignedMatch?.tournamentId === tid ? tournament.assignedMatch : null,
    });
    if (isTournamentBracketTerminal(terminal)) {
      if (tournamentSubView === 'bracket') {
        exitToTournamentHub('terminal_guard');
      }
      return;
    }

    if (
      phase === 'registered' ||
      phase === 'bracket_lobby' ||
      phase === 'match_ready' ||
      phase === 'in_match'
    ) {
      setActiveTournamentId(tid);
      if (tournamentSubView === 'hub') {
        if (phase === 'bracket_lobby' || phase === 'registered') {
          console.log('[tournament:hub] tournament lobby detected, routing', { tournamentId: tid, phase });
        }
        setTournamentSubView('bracket');
      }
      if (!tournament.activeBracket || tournament.activeBracket.tournament.id !== tid) {
        void tournament.openBracket(tid);
      }
    }
  }, [
    appMode,
    authUserId,
    dismissedTournamentIdsRef,
    exitToTournamentHub,
    setActiveTournamentId,
    setTournamentSubView,
    tournament.activeBracket,
    tournament.activeTournamentId,
    tournament.assignedMatch,
    tournament.openBracket,
    tournament.tournamentPhase,
    tournamentSubView,
  ]);

  useEffect(() => {
    if (appMode !== 'tournament' || tournamentSubView !== 'bracket' || !activeTournamentId) return;
    const bracket =
      tournament.activeBracket?.tournament.id === activeTournamentId
        ? tournament.activeBracket
        : null;
    if (!bracket) return;

    const scheduleKick = () => {
      const terminal = deriveBracketTerminalState({
        bracket,
        userId: authUserId,
        tournamentPhase: tournament.tournamentPhase,
        assignedMatch:
          tournament.assignedMatch?.tournamentId === activeTournamentId
            ? tournament.assignedMatch
            : null,
      });
      if (!isTournamentBracketTerminal(terminal)) return null;
      if (terminal.shouldAutoKickToHub) return 0;
      return msUntilBracketAutoKick(terminal.completedAtMs);
    };

    const kick = () => {
      const waitMs = scheduleKick();
      if (waitMs == null) return;
      console.log('[tournament:exit] final completed, routing hub', {
        tournamentId: activeTournamentId,
        waitMs,
      });
      exitToTournamentHub('auto_kick');
    };

    const initialWait = scheduleKick();
    if (initialWait == null) return undefined;
    if (initialWait === 0) {
      kick();
      return undefined;
    }
    const timer = window.setTimeout(kick, initialWait);
    const interval = window.setInterval(() => {
      const waitMs = scheduleKick();
      if (waitMs === 0) kick();
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [
    activeTournamentId,
    appMode,
    authUserId,
    exitToTournamentHub,
    tournament.activeBracket,
    tournament.assignedMatch,
    tournament.tournamentPhase,
    tournamentSubView,
  ]);
}