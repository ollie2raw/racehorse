import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import type { AppMode } from '../../../types';
import type { TournamentResultView } from '../../../tournament/types';
import type { TournamentAttachRuntime } from '../../../multiplayer/runtime/tournamentRuntime';
import type { useTournament } from '../../../tournament/useTournament';
import type { TournamentSessionSocketDelegates } from '../../../tournament/tournamentSocketTypes';

export type TournamentMatchContext = {
  tournamentId: string;
  matchId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  roomCode: string | null;
  stageLabel: 'Quarterfinal' | 'Semifinal' | 'Final';
  isTournament: true;
  opponentUserId: string | null;
  opponentUsername: string | null;
  opponentRating: number | null;
};

export function getTournamentStageLabel(round: 1 | 2 | 3): TournamentMatchContext['stageLabel'] {
  if (round === 3) return 'Final';
  if (round === 2) return 'Semifinal';
  return 'Quarterfinal';
}

type TournamentJoinMatchPayload = Pick<TournamentMatchContext, 'matchId' | 'tournamentId' | 'round'>;

export function isTournamentJoinMatchPayload(v: unknown): v is TournamentJoinMatchPayload {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.matchId === 'string' &&
    typeof obj.tournamentId === 'string' &&
    typeof obj.round === 'number' &&
    obj.round >= 1 &&
    obj.round <= 3
  );
}

export type TournamentSubView = 'hub' | 'bracket' | 'result';

export type TournamentHookApi = ReturnType<typeof useTournament>;

export type UseTournamentMatchSessionParams = {
  socket: Socket | null;
  attachRuntime: TournamentAttachRuntime;
  appMode: AppMode;
  authUserId: string | null;
  multiplayerIdentityUserId: string;
  joinedRoom: string | null;
  liveGameOver: boolean | undefined;
  showToast: (message: string, duration?: number) => void;
  setActionError: Dispatch<SetStateAction<string>>;
  normalizeRoomCode: (code: string | null | undefined) => string;
  tournament: TournamentHookApi;
  onTournamentMatchAbandoned: (notice: {
    context: 'tournament';
    title: string;
    detail: string;
    tournamentId: string;
  }) => void;
  onPrivateMatchAbandoned: (notice: {
    context: 'multiplayer';
    title: string;
    detail: string;
  }) => void;
};

export type TournamentMatchSessionApi = {
  tournamentSubView: TournamentSubView;
  setTournamentSubView: Dispatch<SetStateAction<TournamentSubView>>;
  activeTournamentId: string | null;
  setActiveTournamentId: Dispatch<SetStateAction<string | null>>;
  tournamentMatch: TournamentMatchContext | null;
  setTournamentMatch: Dispatch<SetStateAction<TournamentMatchContext | null>>;
  currentTournamentContext: TournamentMatchContext | null;
  tournamentAttachPhase: 'idle' | 'pending' | 'failed';
  tournamentAttachError: string | null;
  tournamentResult: TournamentResultView | null;
  setTournamentResult: Dispatch<SetStateAction<TournamentResultView | null>>;
  tournamentResultLoading: boolean;
  setTournamentResultLoading: Dispatch<SetStateAction<boolean>>;
  tournamentResultError: string | null;
  setTournamentResultError: Dispatch<SetStateAction<string | null>>;
  pendingTournamentAttachMatchIdRef: MutableRefObject<string | null>;
  attachedTournamentMatchIdRef: MutableRefObject<string | null>;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  clearTournamentAttachRefs: () => void;
  applyTournamentMetadataFromJoin: (
    resp: {
      roomCode?: string;
      tournamentMatch?: Record<string, unknown> | null;
      state?: GameState | null;
    },
    nextState: GameState | null,
  ) => 'continue' | 'terminal_handled';
  attemptTournamentAttach: (
    matchId: string,
    opts?: { manual?: boolean; tournamentId?: string; matchStatus?: string },
  ) => Promise<boolean>;
  attachAssignedTournamentMatch: (matchId: string) => void;
  finalizeTournamentMatchSession: (input: {
    matchId: string;
    tournamentId: string;
    roomCode?: string | null;
    round?: number;
    routeView?: TournamentSubView;
    tournamentCompleted?: boolean;
  }) => void;
  exitToTournamentHub: (reason: string) => void;
  enterTournamentLobby: (tournamentId: string) => void;
  navigateAfterTournamentMatch: (nextView: TournamentSubView) => void;
  sessionSocketDelegatesRef: MutableRefObject<TournamentSessionSocketDelegates>;
};