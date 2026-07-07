import { useTournamentAttachFlow } from './tournament/useTournamentAttachFlow';
import { useTournamentAttachRefs } from './tournament/useTournamentAttachRefs';
import { useTournamentBracketTerminal } from './tournament/useTournamentBracketTerminal';
import { useTournamentSessionLifecycle } from './tournament/useTournamentSessionLifecycle';
import { useTournamentSessionNavigation } from './tournament/useTournamentSessionNavigation';
import { useTournamentSessionSockets } from './tournament/useTournamentSessionSockets';
import { useTournamentSessionState } from './tournament/useTournamentSessionState';
import type {
  TournamentMatchSessionApi,
  UseTournamentMatchSessionParams,
} from './tournament/tournamentMatchSessionTypes';

export type {
  TournamentMatchContext,
  TournamentMatchSessionApi,
  UseTournamentMatchSessionParams,
} from './tournament/tournamentMatchSessionTypes';

export { getTournamentStageLabel } from './tournament/tournamentMatchSessionTypes';

export function useTournamentMatchSession(
  params: UseTournamentMatchSessionParams,
): TournamentMatchSessionApi {
  const sessionState = useTournamentSessionState();
  const attachRefs = useTournamentAttachRefs();

  const navigation = useTournamentSessionNavigation({
    attachRuntime: params.attachRuntime,
    socket: params.socket,
    joinedRoom: params.joinedRoom,
    setActionError: params.setActionError,
    tournament: params.tournament,
    sessionState,
    attachRefs,
  });

  const attachFlow = useTournamentAttachFlow({
    attachRuntime: params.attachRuntime,
    multiplayerIdentityUserId: params.multiplayerIdentityUserId,
    showToast: params.showToast,
    tournament: params.tournament,
    sessionState,
    attachRefs,
    navigation,
  });

  const { sessionSocketDelegatesRef } = useTournamentSessionSockets({
    attachRuntime: params.attachRuntime,
    authUserId: params.authUserId,
    multiplayerIdentityUserId: params.multiplayerIdentityUserId,
    normalizeRoomCode: params.normalizeRoomCode,
    setActionError: params.setActionError,
    tournament: params.tournament,
    sessionState,
    attachRefs,
    navigation,
    onTournamentMatchAbandoned: params.onTournamentMatchAbandoned,
    onPrivateMatchAbandoned: params.onPrivateMatchAbandoned,
  });

  useTournamentBracketTerminal({
    appMode: params.appMode,
    authUserId: params.authUserId,
    tournament: params.tournament,
    sessionState,
    navigation,
  });

  useTournamentSessionLifecycle({
    socket: params.socket,
    appMode: params.appMode,
    joinedRoom: params.joinedRoom,
    liveGameOver: params.liveGameOver,
    attachRuntime: params.attachRuntime,
    tournament: params.tournament,
    sessionState,
    attachFlow,
  });

  const {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
  } = sessionState;

  const {
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    clearTournamentAttachRefs,
  } = attachRefs;

  const {
    finalizeTournamentMatchSession,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  } = navigation;

  const {
    applyTournamentMetadataFromJoin,
    attemptTournamentAttach,
    attachAssignedTournamentMatch,
  } = attachFlow;

  return {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    currentTournamentContext: tournamentMatch,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    pendingTournamentAttachMatchIdRef,
    attachedTournamentMatchIdRef,
    consumedTournamentGameOverMatchIds,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attemptTournamentAttach,
    attachAssignedTournamentMatch,
    finalizeTournamentMatchSession,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
    sessionSocketDelegatesRef,
  };
}