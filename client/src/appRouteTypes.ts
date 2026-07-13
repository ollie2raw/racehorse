import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import type { GhostProfileSummary } from './ghost/api';
import type { FritzTier } from './bot/fritzConfig';
import type { BotDealSize } from './bot/botEngine';
import type { GameState } from './types';
import type { OutboundChallenge } from './multiplayer/friendChallenge';
import type { MultiplayerControllerConnectionBundle } from './multiplayer/runtime/connectionRuntime';
import type { MultiplayerModeViewProps } from './multiplayer/MultiplayerModeController';
import type { useTournament } from './tournament/useTournament';
import type { useTournamentMatchSession } from './match/session/useTournamentMatchSession';

import type { UserProfile } from './auth/useAuth';

export const LEARN_MODE_VISIBLE = true;

/** Flagship campaign — hidden until ready to ship. */
export const JOURNEY_MODE_VISIBLE = true;

/** Pivotal-turn post-game review + full game analyzer — hidden until ready to ship. */
export const POST_GAME_REVIEW_VISIBLE = true;

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
  | 'journey'
  | 'tournament'
  | 'leaderboard'
  | 'profile'
  | 'feed'
  | 'live';

/** Shell chrome: auth-modal wrapper, fallback host, layout class, invite overlay. */
export type AppRoutesShellProps = {
  withAuthModals: (node: React.ReactNode) => React.ReactNode;
  fallbackConnectionHost: React.ReactNode;
  appRootClassName: string;
  appRootRef: RefObject<HTMLDivElement | null>;
  friendInvitePopup: React.ReactNode;
};

/** Top-level mode routing. */
export type AppRoutesNavigationProps = {
  appMode: AppMode;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
};

/** Auth, account modals, profile identity, and home HUD labels. */
export type AppRoutesAuthProps = {
  handleOpenAuthModal: () => void;
  handleOpenAccountModal: () => void;
  isAdmin: boolean;
  authUser: User | null;
  authProfile: UserProfile | null;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null | undefined;
  refreshAuthProfile: () => Promise<void>;
  applyProfilePatch: (patch: Partial<UserProfile>) => void;
  setAuthModalOpen: Dispatch<SetStateAction<boolean>>;
  setUsernameModalOpen: Dispatch<SetStateAction<boolean>>;
  myHandle: string;
  homeRatingLabel: string;
};

/** Learn mode lesson selection, how-to-play, and guided/authoring mode setters. */
export type AppRoutesLearnProps = {
  showLearnAdminView: boolean;
  canOpenHowToPlayPreview: boolean;
  selectedLearnLessonId: string | null;
  setSelectedLearnLessonId: Dispatch<SetStateAction<string | null>>;
  learnHowToPlayOpen: boolean;
  setLearnHowToPlayOpen: Dispatch<SetStateAction<boolean>>;
  setIsGuidedMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringMode: Dispatch<SetStateAction<boolean>>;
  setIsAuthoringV2Mode: Dispatch<SetStateAction<boolean>>;
  setIsGuidedV2Mode: Dispatch<SetStateAction<boolean>>;
};

/** Fritz/bot match configuration and guided/authoring flags. */
export type AppRoutesBotMatchProps = {
  setBotFritzTier: Dispatch<SetStateAction<FritzTier>>;
  setBotDealSize: Dispatch<SetStateAction<BotDealSize>>;
  botDealSize: BotDealSize;
  botFritzTier: FritzTier;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
};

/** Ghost opponent profile and setup state. */
export type AppRoutesGhostProps = {
  ghostProfile: GhostProfileSummary | null;
  setGhostProfile: Dispatch<SetStateAction<GhostProfileSummary | null>>;
  ghostOpponentName: string;
  ghostOpponentUserId: string | null;
  setGhostOpponentName: Dispatch<SetStateAction<string>>;
  setGhostOpponentUserId: Dispatch<SetStateAction<string | null>>;
};

/** Social graph: friends, feed, profile target, socket connectivity, toasts. */
export type AppRoutesSocialProps = {
  socket: Socket | null;
  connect: () => void;
  joinedRoom: string | null;
  showToast: (message: string, duration?: number) => void;
  outboundChallenge: OutboundChallenge | null;
  clearOutboundChallenge: () => void;
  profileTarget: string | null;
  setProfileTarget: Dispatch<SetStateAction<string | null>>;
  profileOriginMode: AppMode | null;
  setProfileOriginMode: Dispatch<SetStateAction<AppMode | null>>;
  toast: string;
};

/** Home screen accordion hover state and welcome/weekly-stats overlays. */
export type AppRoutesHomeOverlayProps = {
  activeHomeMode: 'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn';
  setActiveHomeMode: Dispatch<
    SetStateAction<'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'>
  >;
  welcomeOpen: boolean;
  setWelcomeOpen: Dispatch<SetStateAction<boolean>>;
  weeklyStatsOpen: boolean;
  setWeeklyStatsOpen: Dispatch<SetStateAction<boolean>>;
};

/** Multiplayer route: connection bundle, mode controller view, and in-match errors. */
export type AppRoutesMultiplayerProps = {
  error: string;
  actionError: string;
  state: GameState | null;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  multiplayerConnectionBundle: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  multiplayerModeViewProps: MultiplayerModeViewProps;
};

/** Tournament hub, bracket, result sub-views and attach/recovery hooks. */
export type AppRoutesTournamentProps = {
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

/** Grouped prop bundles passed into AppRoutes (replaces the former 84-prop flat funnel). */
export type AppRoutesProps = {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  learn: AppRoutesLearnProps;
  botMatch: AppRoutesBotMatchProps;
  ghost: AppRoutesGhostProps;
  social: AppRoutesSocialProps;
  homeOverlays: AppRoutesHomeOverlayProps;
  multiplayer: AppRoutesMultiplayerProps;
  tournament: AppRoutesTournamentProps;
};

/** Route-domain bundles constructed at the App host source call site. */
export type AppRoutesHostRouteBundles = {
  navigation: Pick<AppRoutesNavigationProps, 'appMode' | 'setAppMode'> & Pick<AppRoutesShellProps, 'appRootRef'>;
  auth: Omit<
    AppRoutesAuthProps,
    'handleOpenAuthModal' | 'handleOpenAccountModal'
  >;
  learn: Omit<AppRoutesLearnProps, 'showLearnAdminView'>;
  botMatch: AppRoutesBotMatchProps;
  ghost: AppRoutesGhostProps;
  social: Omit<AppRoutesSocialProps, 'toast' | 'connect'> & { toast: string };
  homeOverlays: AppRoutesHomeOverlayProps;
  tournament: AppRoutesTournamentProps;
  multiplayerRoute: Pick<AppRoutesMultiplayerProps, 'mpSubView' | 'error' | 'setError'>;
};
