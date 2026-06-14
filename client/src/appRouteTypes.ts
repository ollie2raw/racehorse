import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import type { GhostProfileSummary } from './ghost/api';
import type { FritzTier } from './bot/fritzConfig';
import type { BotDealSize } from './bot/botEngine';
import type { GameState } from './types';
import type { OutboundChallenge } from './multiplayer/friendChallenge';
import type {
  MultiplayerControllerConnectionBundle,
} from './multiplayer/multiplayerRuntime';
import type { MultiplayerModeViewProps } from './multiplayer/MultiplayerModeController';
import type { useTournament } from './tournament/useTournament';
import type { useTournamentMatchSession } from './match/session/useTournamentMatchSession';

import type { UserProfile } from './auth/useAuth';

export const LEARN_MODE_VISIBLE = true;

export type AppMode =
  | 'home'
  | 'multiplayer'
  | 'noBrainer'
  | 'botSetup'
  | 'bot'
  | 'ghostSetup'
  | 'ghost'
  | 'daily'
  | 'dailyFritz'
  | 'learn'
  | 'guidedMatchRecorder'
  | 'guidedMatchAnnotator'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'tournament'
  | 'leaderboard'
  | 'profile'
  | 'feed';

export type AppRoutesProps = {
  withAuthModals: (node: React.ReactNode) => React.ReactNode;
  fallbackConnectionHost: React.ReactNode;
  appRootClassName: string;
  appMode: AppMode;
  appRootRef: RefObject<HTMLDivElement | null>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  handleOpenAuthModal: () => void;
  handleOpenAccountModal: () => void;
  showLearnAdminView: boolean;
  canOpenHowToPlayPreview: boolean;
  isAdmin: boolean;
  authUser: User | null;
  authProfile: UserProfile | null;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null | undefined;
  selectedLearnLessonId: string | null;
  setSelectedLearnLessonId: Dispatch<SetStateAction<string | null>>;
  learnHowToPlayOpen: boolean;
  setLearnHowToPlayOpen: Dispatch<SetStateAction<boolean>>;
  setIsGuidedMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringV2Mode: Dispatch<SetStateAction<boolean>>;
  setIsGuidedV2Mode: Dispatch<SetStateAction<boolean>>;
  setBotFritzTier: Dispatch<SetStateAction<FritzTier>>;
  setBotDealSize: Dispatch<SetStateAction<BotDealSize>>;
  botDealSize: BotDealSize;
  botFritzTier: FritzTier;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  refreshAuthProfile: () => Promise<void>;
  applyProfilePatch: (patch: Partial<UserProfile>) => void;
  ghostProfile: GhostProfileSummary | null;
  setGhostProfile: Dispatch<SetStateAction<GhostProfileSummary | null>>;
  ghostOpponentName: string;
  ghostOpponentUserId: string | null;
  setGhostOpponentName: Dispatch<SetStateAction<string>>;
  setGhostOpponentUserId: Dispatch<SetStateAction<string | null>>;
  setAuthModalOpen: Dispatch<SetStateAction<boolean>>;
  setUsernameModalOpen: Dispatch<SetStateAction<boolean>>;
  socket: Socket | null;
  connect: () => void;
  joinedRoom: string | null;
  showToast: (message: string, duration?: number) => void;
  outboundChallenge: OutboundChallenge | null;
  clearOutboundChallenge: () => void;
  profileTarget: string | null;
  setProfileTarget: Dispatch<SetStateAction<string | null>>;
  friendInvitePopup: React.ReactNode;
  toast: string;
  error: string;
  actionError: string;
  state: GameState | null;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  multiplayerConnectionBundle: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  multiplayerModeViewProps: MultiplayerModeViewProps;
  myHandle: string;
  homeRatingLabel: string;
  activeHomeMode: 'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn';
  setActiveHomeMode: Dispatch<
    SetStateAction<'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'>
  >;
  welcomeOpen: boolean;
  setWelcomeOpen: Dispatch<SetStateAction<boolean>>;
  weeklyStatsOpen: boolean;
  setWeeklyStatsOpen: Dispatch<SetStateAction<boolean>>;
  tournament: ReturnType<typeof useTournament>;
  tournamentSubView: ReturnType<typeof useTournamentMatchSession>['tournamentSubView'];
  activeTournamentId: ReturnType<typeof useTournamentMatchSession>['activeTournamentId'];
  tournamentAttachPhase: ReturnType<typeof useTournamentMatchSession>['tournamentAttachPhase'];
  tournamentAttachError: ReturnType<typeof useTournamentMatchSession>['tournamentAttachError'];
  tournamentResult: ReturnType<typeof useTournamentMatchSession>['tournamentResult'];
  tournamentResultLoading: ReturnType<typeof useTournamentMatchSession>['tournamentResultLoading'];
  tournamentResultError: ReturnType<typeof useTournamentMatchSession>['tournamentResultError'];
  setTournamentSubView: ReturnType<typeof useTournamentMatchSession>['setTournamentSubView'];
  setActiveTournamentId: ReturnType<typeof useTournamentMatchSession>['setActiveTournamentId'];
  setTournamentResult: ReturnType<typeof useTournamentMatchSession>['setTournamentResult'];
  setTournamentResultLoading: ReturnType<typeof useTournamentMatchSession>['setTournamentResultLoading'];
  setTournamentResultError: ReturnType<typeof useTournamentMatchSession>['setTournamentResultError'];
  exitToTournamentHub: ReturnType<typeof useTournamentMatchSession>['exitToTournamentHub'];
  enterTournamentLobby: ReturnType<typeof useTournamentMatchSession>['enterTournamentLobby'];
  attachAssignedTournamentMatch: ReturnType<typeof useTournamentMatchSession>['attachAssignedTournamentMatch'];
};
