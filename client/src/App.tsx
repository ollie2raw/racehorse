import React, { Suspense, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from './components/RoomReactions';
import type { Socket } from 'socket.io-client';
import './App.css';
import './match/match-live.css';
import { BrandLogo } from './components';
import type { BoardHandle } from './components';
import { LiveMatchScreen } from './match/LiveMatchScreen';
import {
  playDrawSound,
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playTileSound,
} from './utils/sound';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import LayoutScreen from './ui/LayoutScreen';
import { analyzeMoveLog, saveGameAnalysis, type GameAnalysis } from './analyzer/moveAnalyzer';
import {
  type MoveEntry,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from './analyzer/moveLogger';
import { fetchUserStatsByUserId, fetchWeeklyRecap, recordMatchResult } from './stats/statsApi';
import { fetchGhostProfileSummary, type GhostProfileSummary } from './ghost/api';
import type { Tile, PlacementPosition, GameState, Move, StateUpdate } from './types';
import type { BotDealSize } from './bot/botEngine';
import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
} from './game/openEndsGeometry';
import type { FritzTier } from './bot/fritzConfig';
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from './bot/pvfTierPreference';
import { resolveGameServerUrl } from './lib/gameServerUrl';
import { useRoomSocketSync, type StateUpdatePayload } from './multiplayer/useRoomSocketSync';
import { hasHandIdentityMismatch } from './multiplayer/handIdentity';
import {
  isRenderableMultiplayerSnapshot,
  projectRenderableBoard,
} from './multiplayer/boardSnapshotGuards';
import {
  useLiveMatchSession,
  findPlacedTile,
  getBoardEnds,
  getBoardTileCount,
} from './match/session/useLiveMatchSession';
import { useTournamentMatchSession } from './match/session/useTournamentMatchSession';
import { useMultiplayerConnection } from './multiplayer/useMultiplayerConnection';
import { useMultiplayerRoomActions } from './multiplayer/useMultiplayerRoomActions';
import { useRenderProfiler } from './debug/renderProfiler';
import {
  claudeRgb,
} from './ui/claudeMode';
import {
  loadAuthoringSession,
  saveFrozenLesson,
  loadFrozenLesson,
} from './learn/guidedAuthoring';
import { resolveGuidedMatchStart } from './learn/lessonV2';
import RacehorseHomeScreen from './screens/HomeScreen';
import { TournamentScreen } from './screens/TournamentScreen';
import TournamentHubScreen from './tournament/TournamentHubScreen';
import TournamentBracketScreen from './tournament/TournamentBracketScreen';
import TournamentResultScreen from './tournament/TournamentResultScreen';
import { resolveTournamentOpponentLabel } from './tournament/displayNames';
import { useTournament } from './tournament/useTournament';
import * as tournamentApi from './tournament/tournamentApi';
import { isTerminalTournamentMatch } from './tournament/terminalMatches';
import PrivateMatchLobbyScreen from './multiplayer/PrivateMatchLobbyScreen';
import IncomingFriendChallengeCard from './multiplayer/IncomingFriendChallengeCard';
import type { OutboundChallenge } from './multiplayer/friendChallenge';
import MatchmakingScreen from './matchmaking/MatchmakingScreen';
import { MatchFoundOverlay } from './matchmaking/MatchFoundOverlay';
import type { MatchFoundPayload } from './matchmaking/types';
import {
  emitWithAck,
  emitRoomAbandonMatch,
  emitRoomCreate,
  emitRoomJoin,
  emitRoomLeave,
} from './multiplayer/roomTransport';
import {
  clearLastRoomCode,
  getOrCreateGuestIdentityId,
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
  shouldPersistLastRoomCode,
} from './match/recovery/matchRecovery';

// ─── Utilities ───────────────────────────────────────────────
type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};
type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';
type TournamentPlayer = {
  socketId: string;
  username: string;
  userId?: string | null;
  isBot?: boolean;
};

type AppMode =
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

const SinglePlayerHubScreen = React.lazy(() => import('./screens/SinglePlayerHubScreen'));
const NoBrainerLabScreen = React.lazy(() => import('./practice/NoBrainerLabScreen'));
const BotMatchScreen = React.lazy(() => import('./bot/BotMatchScreen'));
const PlayVsFritz = React.lazy(() => import('./bot/PlayVsFritz'));
const GhostSetupScreen = React.lazy(() => import('./ghost/GhostSetupScreen'));
const DailyPuzzleScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleScreen'));
const DailyFritzScreen = React.lazy(() => import('./dailyFritz/DailyFritzScreen'));
const DailyPuzzleAdminScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleAdminScreen'));
const RatingHistoryPage = React.lazy(() => import('./ranking/RatingHistoryPage'));
const GameReviewer = React.lazy(() => import('./analyzer/GameReviewer'));
const AuthModal = React.lazy(() => import('./auth/AuthModal'));
const UsernameModal = React.lazy(() => import('./auth/UsernameModal'));
const StatsScreen = React.lazy(() => import('./stats/StatsScreen'));
const FriendsScreen = React.lazy(() => import('./friends/FriendsScreen'));
const DailyFritzLeaderboardRoute = React.lazy(() => import('./dailyFritz/DailyFritzLeaderboardRoute'));
const PublicProfileScreen = React.lazy(() => import('./social/PublicProfileScreen'));
const ActivityFeedScreen = React.lazy(() => import('./social/ActivityFeedScreen'));
const LearnHome = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.LearnHome })),
);
const GuidedMatchRecorderScreen = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.GuidedMatchRecorderScreen })),
);
const GuidedMatchAnnotatorScreen = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.GuidedMatchAnnotatorScreen })),
);
const LearnHowToPlayRacehorse = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.LearnHowToPlayRacehorse })),
);
const LearnPlayer = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.LearnPlayer })),
);

function IconDominoes({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={style}>
      <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="7" r="1.2" fill="currentColor" />
      <circle cx="15" cy="7" r="1.2" fill="currentColor" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeRoomPlayers(value: unknown): RoomPlayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, username: 'Guest', userId: null };
      }
      if (entry && typeof entry === 'object') {
        const rec = entry as { id?: unknown; username?: unknown; userId?: unknown };
        const id = typeof rec.id === 'string' ? rec.id : '';
        const userId = typeof rec.userId === 'string' ? rec.userId.trim() || null : null;
        return { id, username: normalizeUsername(rec.username), userId };
      }
      return { id: '', username: 'Guest', userId: null };
    })
    .filter((p) => Boolean(p.id));
}

function ScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="rh-screen-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="rh-screen-loader__bg" aria-hidden />
      <div className="rh-screen-loader__panel">
        <div className="rh-screen-loader__brand">
          <BrandLogo iconSize={30} showWordmark />
        </div>
        <p className="rh-screen-loader__label">{label}</p>
        <div className="rh-screen-loader__rail" aria-hidden>
          <div className="rh-screen-loader__rail-fill" />
        </div>
      </div>
    </div>
  );
}

const LEARN_MODE_VISIBLE = true;

function WeeklyStatsScreen({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
}) {
  const [recap, setRecap] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) {
      setRecap(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void fetchWeeklyRecap(user)
      .then((resp) => {
        if (!active) return;
        setLoading(false);
        if (resp.error || !resp.data) {
          setError(resp.error ?? 'Unable to load weekly recap.');
          setRecap(null);
          return;
        }
        setRecap(resp.data);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError('Unable to load weekly recap.');
      });
    return () => {
      active = false;
    };
  }, [open, user]);

  const recapSections = recap
    ? [
        {
          title: 'Fritz This Week',
          icon: '🤖',
          tone: 'rgba(94, 234, 212, 0.16)',
          rows: [
            { label: 'Ranked Games', value: recap.fritz.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.fritz.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.fritz.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.fritz.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.fritz.bestWinMarginThisWeek == null ? '—' : `${recap.fritz.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Ghost This Week',
          icon: '👻',
          tone: 'rgba(216, 180, 254, 0.16)',
          rows: [
            { label: 'Ghost Games', value: recap.ghost.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.ghost.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.ghost.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.ghost.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.ghost.bestWinMarginThisWeek == null ? '—' : `${recap.ghost.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Puzzle This Week',
          icon: '🧩',
          tone: 'rgba(240, 192, 64, 0.16)',
          rows: [
            { label: 'Completions', value: recap.puzzle.completionsThisWeek },
            { label: 'Best Today', value: recap.puzzle.bestScoreToday == null ? '—' : recap.puzzle.bestScoreToday },
          ],
        },
        {
          title: 'Multiplayer This Week',
          icon: '🌐',
          tone: 'rgba(148, 163, 184, 0.16)',
          rows: [
            { label: 'Online Games', value: recap.multiplayer.gamesThisWeek },
            { label: 'Wins', value: recap.multiplayer.wins },
            { label: 'Losses', value: recap.multiplayer.losses },
          ],
        },
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Weekly stats"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        pointerEvents: open ? 'auto' : 'none',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transform: open ? 'scale(1)' : 'scale(0.97)',
        transition: 'opacity 180ms ease, transform 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1901,
          pointerEvents: 'auto',
          width: 'min(1120px, calc(100vw - 32px))',
          maxHeight: 'min(92vh, 920px)',
          borderRadius: '20px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '22px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '16px',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true">🏆</span>
              <span>Weekly Recap</span>
            </h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', fontSize: '1.12rem' }}>
              {recap?.weekLabel ?? 'This week'}
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading weekly recap...</p>}
        {error && <p className="auth-inline-error" style={{ margin: 0 }}>{error}</p>}

        {!loading && !error && recapSections.length > 0 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {recapSections.map((section) => (
              <div
                key={section.title}
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '16px',
                  display: 'grid',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: '1.22rem' }}>{section.icon}</span>
                  <strong style={{ fontSize: '1.16rem', color: 'rgba(240,248,255,0.96)' }}>{section.title}</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 12,
                  }}
                >
                  {section.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: section.tone,
                        padding: '14px 16px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: '0.98rem', color: 'rgba(191,213,223,0.88)', fontWeight: 700 }}>{row.label}</span>
                      <strong style={{ fontSize: '1.56rem', color: '#f8fafc' }}>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
            No weekly recap available yet.
          </p>
        )}
      </div>
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────

const SOCKET_MODES = new Set<AppMode>(['multiplayer', 'bot', 'botSetup', 'ghost', 'ghostSetup']);

const MODE_TO_PATH: Partial<Record<AppMode, string>> = {
  home: '/',
  stats: '/stats',
  friends: '/friends',
  daily: '/daily',
  dailyFritz: '/daily-fritz',
  ratingHistory: '/rating-history',
  singlePlayerHub: '/solo',
  tournament: '/tournament',
  noBrainer: '/practice',
  learn: '/learn',
  guidedMatchRecorder: '/learn/recorder',
  guidedMatchAnnotator: '/learn/guided-annotator',
};

const PATH_TO_MODE: Record<string, AppMode> = Object.fromEntries(
  Object.entries(MODE_TO_PATH).map(([mode, path]) => [path, mode as AppMode])
);

export default function App() {
  useRenderProfiler('App');
  const appRootRef = useRef<HTMLDivElement>(null);
  const trayCenterRef = useRef<HTMLDivElement>(null);
  const autoConnectAttemptedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const pendingCreateOnConnectRef = useRef(false);
  const pendingCreateResolversRef = useRef<Array<(code: string | null) => void>>([]);
  const [serverUrl] = useState(() => resolveGameServerUrl());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const mode = PATH_TO_MODE[hash];
    return mode && !SOCKET_MODES.has(mode) ? mode : 'home';
  });
  const [selectedLearnLessonId, setSelectedLearnLessonId] = useState<string | null>(null);
  const [learnHowToPlayOpen, setLearnHowToPlayOpen] = useState(false);
  const [mpSubView, setMpSubView] = useState<'quick' | 'private'>('quick');
  const [overlayPayload, setOverlayPayload] = useState<MatchFoundPayload | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [botDealSize, setBotDealSize] = useState<BotDealSize>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage.getItem('racehorse_bot_deal_size');
    return stored === '14' ? 14 : 7;
  });
  const [botFritzTier, setBotFritzTier] = useState<FritzTier>(() => resolveDefaultPvfFritzTier());
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [isAuthoringMode, setIsAuthoringMode] = useState(false);
  const [isAuthoringV2Mode, setIsAuthoringV2Mode] = useState(false);
  const [isGuidedV2Mode, setIsGuidedV2Mode] = useState(false);
  const [ghostProfile, setGhostProfile] = useState<GhostProfileSummary | null>(null);
  const [ghostOpponentName, setGhostOpponentName] = useState<string>('Ghost');
  const [ghostOpponentUserId, setGhostOpponentUserId] = useState<string | null>(null);

  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [tournamentCode, setTournamentCode] = useState('');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<any>(null);
  const [tournamentActiveRoom, setTournamentActiveRoom] = useState<string | null>(null);
  const [roomReactions, setRoomReactions] = useState<Array<RoomChatEvent | RoomEmoteEvent>>([]);
  const [multiplayerRatingBaseline, setMultiplayerRatingBaseline] = useState<number | null>(null);
  const [multiplayerRatingPending, setMultiplayerRatingPending] = useState(false);
  const multiplayerRatingRefreshKeyRef = useRef('');
  const [privateLobbyHostWinStreak, setPrivateLobbyHostWinStreak] = useState<number | null>(null);

  // Sync appMode → URL hash (side effect only; appMode is still source of truth)
  useEffect(() => {
    const path = SOCKET_MODES.has(appMode) ? '/' : (MODE_TO_PATH[appMode] ?? '/');
    navigate(path, { replace: true });
  }, [appMode, navigate]);

  useEffect(() => {
    if (!LEARN_MODE_VISIBLE && appMode === 'learn') {
      setSelectedLearnLessonId(null);
      setLearnHowToPlayOpen(false);
      setAppMode('singlePlayerHub');
    }
  }, [appMode]);

  useEffect(() => {
    if (appMode !== 'learn') {
      setLearnHowToPlayOpen(false);
    }
  }, [appMode]);

  const sendRoomChat = (text: string) => {
    const t = String(text ?? '').trim();
    if (!t) return;

    const localMsg = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      t: Date.now(),
      from: { userId: null as string | null, username: 'you' },
      text: t,
    };

    setRoomReactions((prev) => {
      const next = prev.concat(localMsg as any);
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    if (!socket) return;
    socket.emit('room:chat:send', { text: t });
  };

  const sendRoomEmote = (emote: string) => {
    const e = String(emote ?? '').trim();
    if (!e) return;

    const localEvt = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      t: Date.now(),
      from: { userId: null as string | null, username: 'you' },
      emote: e,
    };

    setRoomReactions((prev) => {
      const next = prev.concat(localEvt as any);
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    if (!socket) return;
    socket.emit('room:emote:send', { emote: e });
  };


  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [you, setYou] = useState<string>('');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');

  const showToast = useCallback((msg: string, duration = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(''), duration);
  }, []);
  const [scoreToast, setScoreToast] = useState<{
    message: string;
    tone: 'you' | 'opp';
    visible: boolean;
  } | null>(null);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [abandonedMatchNotice, setAbandonedMatchNotice] = useState<{
    context: 'tournament' | 'multiplayer';
    title: string;
    detail: string;
    tournamentId?: string | null;
  } | null>(null);
  const [multiplayerMoveLog, setMultiplayerMoveLog] = useState<MoveEntry[]>([]);
  const multiplayerMoveCounterRef = useRef(1);
  const previousStateForAnalysisRef = useRef<GameState | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const {
    user: authUser,
    profile: authProfile,
    accessToken: authAccessToken,
    loading: authLoading,
    justVerified,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    resetPassword,
    signOut,
    updateUsername,
    refreshAuthProfile,
    applyProfilePatch,
  } = useAuth();
  const [guestIdentityId] = useState(getOrCreateGuestIdentityId);
  const multiplayerIdentityUserId = authUser?.id ?? guestIdentityId;
  const multiplayerAuthToken = authUser?.id ? authAccessToken : null;
  // Single tournament hook instance, shared by Hub/Bracket/Result screens.
  // Hoisted from the screens so that registration changes / bracket updates /
  // pending match-ready events are observed in App.tsx and can trigger top-level
  // navigation (auto-route to result on tournament:completed).
  const tournament = useTournament({
    socket,
    userId: authUser?.id ?? null,
  });

  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const authAccessTokenRef = useRef<string | null>(authAccessToken);
  const multiplayerIdentityUserIdRef = useRef(multiplayerIdentityUserId);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);
  const [weeklyAwards, setWeeklyAwards] = useState<any | null>(null);
  const [playersOnlineCount, setPlayersOnlineCount] = useState<number | null>(null);
  const [friendInvite, setFriendInvite] = useState<{
    inviteId: string;
    fromUsername: string;
    fromUserId: string | null;
    roomCode: string;
    inviteUrl: string;
    matchSummary: string;
  } | null>(null);
  const [outboundChallenge, setOutboundChallenge] = useState<OutboundChallenge | null>(null);
  const clearOutboundChallenge = useCallback(() => setOutboundChallenge(null), []);

  useEffect(() => {
    if (!authUser) {
      setGhostProfile(null);
      return;
    }
    let active = true;
    void fetchGhostProfileSummary(authUser.id)
      .then((summary) => {
        if (active) setGhostProfile(summary);
      })
      .catch(() => {
        if (active) setGhostProfile(null);
      });
    return () => {
      active = false;
    };
  }, [authUser]);

  const loadWeeklyAwards = useCallback(() => {
    if (!socket || !socket.connected) return;
    socket.emit("stats:weekly", (resp: any) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const appModeRef = useRef(appMode);
  const mpSubViewRef = useRef(mpSubView);
  const roomPlayersRef = useRef<RoomPlayer[]>([]);
  const joinedRoomResponseRef = useRef<any>(null);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);
  useEffect(() => {
    mpSubViewRef.current = mpSubView;
  }, [mpSubView]);

  const joinedRoomRef = useRef<string | null>(null);
  const reconnectRoomCodeRef = useRef<string | null>(null);
  const reconnectShouldJoinRef = useRef(false);
  const preventAutoRejoinRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const clearRecoverableRoomStateRef = useRef<() => void>(() => {});
  const resetMultiplayerRoomStateRef = useRef<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >(() => {});
  const createInFlightRef = useRef(false);
  const inviteJoinInFlightRef = useRef(false);
  const rejoinInFlightRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const reconnectAttemptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptCountRef = useRef(0);
  const previousMultiplayerGameOverRef = useRef(false);
  const maxSequenceRef = useRef<number>(-1);
  const [isRecoveringConnection, setIsRecoveringConnection] = useState(false);
  const [roomRecoveryState, setRoomRecoveryState] = useState<RoomRecoveryState>('idle');
  const [roomRecoveryMessage, setRoomRecoveryMessage] = useState('');
  const roomMatchIdRef = useRef<string | null>(null);
  const maxEventSequenceRef = useRef<number>(-1);

  useEffect(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
  }, [joinedRoom]);

  const isMutedRef = useRef(isMuted);
  const applyRoomEventMetaRef = useRef<(meta?: RoomEventMeta | null) => void>(() => {});
  const fetchGameStateRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  const resetClientGameSessionRef = useRef<() => void>(() => {});
  const resyncInFlightRef = useRef(false);
  const resyncCooldownUntilRef = useRef(0);
  const resyncBufferedUpdateRef = useRef<StateUpdatePayload | null>(null);
  const resyncFlushRef = useRef<(() => void) | null>(null);
  const playerReadyEmittedRef = useRef(false);
  const isSeatedPlayerRef = useRef(false);
  const matchStartedRef = useRef(false);
  const schedulePlayerReadyRef = useRef<() => Promise<void>>(async () => {});
  const applyJoinedRoomResponseRef = useRef<(resp: any) => void>(() => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});

  const appendMultiplayerMove = useCallback((entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you'
        ? multiplayerMoveCounterRef.current++
        : multiplayerMoveCounterRef.current;
    setMultiplayerMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const liveMatch = useLiveMatchSession({
    socket,
    joinedRoom,
    you,
    isConnected,
    showToast,
    setError,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    fetchGameState: (reason) => fetchGameStateRef.current(reason),
    normalizeRoomPlayers,
    applyRoomEventMeta: (meta) => applyRoomEventMetaRef.current(meta),
    setFriendInvite,
    joinedRoomRef,
    maxSequenceRef,
    setPlayers,
    roomPlayersRef,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    isSeatedPlayerRef,
    matchStartedRef,
    playerReadyEmittedRef,
    trySchedulePlayerReadyRef,
    isMutedRef,
    playDrawSound,
    resyncInFlightRef,
    resyncBufferedUpdateRef,
    resyncFlushRef,
    resetClientGameSession: () => resetClientGameSessionRef.current(),
    onGameStart: () => {
      setMultiplayerMoveLog([]);
      multiplayerMoveCounterRef.current = 1;
      previousStateForAnalysisRef.current = null;
    },
    appendMultiplayerMove,
  });

  const {
    state,
    setState,
    legalMoves,
    setLegalMoves,
    canDraw,
    setCanDraw,
    selectedTile,
    setSelectedTile,
    optimisticPlayedTile,
    setOptimisticPlayedTile,
    pendingUiAction,
    setPendingUiAction,
    actionError,
    setActionError,
    handReveal,
    setHandReveal,
    rematchRequested,
    setRematchRequested,
    rematchReadyIds,
    setRematchReadyIds,
    drawStepMyHand,
    setDrawStepMyHand,
    drawStepActorId,
    setDrawStepActorId,
    drawStepOpponentHandCount,
    setDrawStepOpponentHandCount,
    flyingTiles,
    setFlyingTiles,
    drawSequenceActive,
    opponentDragging,
    setOpponentDragging,
    opponentDisconnected,
    setOpponentDisconnected,
    opponentDisconnectMessage,
    setOpponentDisconnectMessage,
    lastPlayedTile,
    boneyardDisplayCount,
    setBoneyardDisplayCount,
    drawPulseIndex,
    setDrawPulseIndex,
    handRevealAutoProgress,
    inGame,
    isMyTurn,
    myHand,
    opponentTileCount,
    boneyardCount,
    hasPlayMoves,
    canDrawNow,
    canPass,
    boardForDisplay,
    boardLegalMoves,
    selectedTileHasLegalPlay,
    boardSelectedTile,
    boardShowOpenEndGlow,
    handSelectedTile,
    stateRef,
    legalMovesRef,
    selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    handRevealShownRef,
    handRevealTimerRef,
    draggingStateRef,
    drawSequenceActiveRef,
    drawSequenceTimeoutRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    frozenHandOverBoardRef,
    rematchAwaitingStateRef,
    pendingForcedHandRevealRef,
    flyingTileIdRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    lastPlayedTileTimerRef,
    youRef,
    clearTransientRoomUi,
    play,
    draw,
    pass,
    startGame,
    requestRematch,
    continueAfterHandReveal,
    emitDraggingState,
    isGameplayActionBlocked,
    handleTileTap,
    setDrawSequenceActiveBoth,
    flashLastPlayed,
    applyJoinResponseGameState,
    roomSocketSyncParams,
  } = liveMatch;

  const onTournamentMatchAbandoned = useCallback(
    (notice: {
      context: 'tournament';
      title: string;
      detail: string;
      tournamentId: string;
    }) => {
      setAbandonedMatchNotice(notice);
    },
    [],
  );
  const onPrivateMatchAbandoned = useCallback(
    (notice: { context: 'multiplayer'; title: string; detail: string }) => {
      setAbandonedMatchNotice(notice);
    },
    [],
  );

  const tournamentSession = useTournamentMatchSession({
    socket,
    socketRef,
    connectRef,
    appMode,
    appModeRef,
    authUserId: authUser?.id ?? null,
    multiplayerIdentityUserId,
    joinedRoom,
    joinedRoomRef,
    joinedRoomResponseRef,
    liveGameOver: state?.gameOver,
    preventAutoRejoinRef,
    reconnectShouldJoinRef,
    reconnectRoomCodeRef,
    applyJoinedRoomResponseRef,
    clearRecoverableRoomStateRef,
    resetMultiplayerRoomStateRef,
    showToast,
    setAppMode,
    setActionError,
    normalizeRoomCode,
    tournament,
    onTournamentMatchAbandoned,
    onPrivateMatchAbandoned,
  });

  const {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    currentTournamentContext,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    consumedTournamentGameOverMatchIdsRef,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attachAssignedTournamentMatch,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  } = tournamentSession;

  useRoomSocketSync(roomSocketSyncParams);

  const [handTileSize, setHandTileSize] = useState(44);
  const prevOppCountRef = useRef<number | null>(null);
  const [oppTilePulse, setOppTilePulse] = useState(false);
  const prevBoardTileCountRef = useRef(0);
  const prevTurnIdRef = useRef<string | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const boardRef = useRef<BoardHandle>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const roomIdentityRef = useRef<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>(null);
  const matchRecordKeyRef = useRef('');
  const prevGameOverRef = useRef(false);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const isAdmin = Boolean(
    authUser?.email && adminEmail && authUser.email.toLowerCase() === adminEmail.toLowerCase(),
  );
  const canOpenHowToPlayPreview = true;
  const needsUsernameOnboarding = Boolean(
    authUser && !authLoading && authProfile !== null && isTemporaryUsername(authProfile.username),
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem('username_onboarding_dismissed');
    if (!raw) return false;
    // Only snooze for 24 hours - after that the prompt returns
    const dismissedAt = parseInt(raw, 10);
    const SNOOZE_MS = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < SNOOZE_MS;
  });

  const copyRoomCodeToClipboard = useCallback(async () => {
    const code = normalizeRoomCode(joinedRoom || roomCode);
    if (!code) {
      showToast('No room code to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast('Room code copied.');
    } catch {
      showToast('Could not copy room code.');
    }
  }, [joinedRoom, roomCode, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (reconnectAttemptTimerRef.current) clearTimeout(reconnectAttemptTimerRef.current);
    };
  }, []);

  const clearReconnectAttemptTimer = useCallback(() => {
    if (reconnectAttemptTimerRef.current) {
      clearTimeout(reconnectAttemptTimerRef.current);
      reconnectAttemptTimerRef.current = null;
    }
  }, []);

  const showScoreLikeToast = useCallback((message: string, tone: 'you' | 'opp') => {
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      message,
      tone,
      visible: true,
    });
    scoreToastHideTimerRef.current = setTimeout(() => {
      setScoreToast((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 2800);
    scoreToastClearTimerRef.current = setTimeout(() => setScoreToast(null), 3200);
  }, []);

  const showScoreToast = useCallback(
    (player: 'you' | 'opp', points: number, label?: string) => {
      const currentScore = player === 'you'
        ? (stateRef.current?.players[you]?.score ?? 0)
        : (stateRef.current?.players[stateRef.current?.playerIds.find(p => p !== you) ?? '']?.score ?? 0);
      showScoreLikeToast(`${label ?? (player === 'you' ? 'You' : 'Opponent')} scored +${points} · ${currentScore} pts`, player);
    },
    [showScoreLikeToast, you],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSeen = window.localStorage.getItem('hasSeenWelcome');
    if (!hasSeen) setWelcomeOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_bot_deal_size', String(botDealSize));
  }, [botDealSize]);

  useEffect(() => {
    writeStoredPvfFritzTier(botFritzTier);
  }, [botFritzTier]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);


  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  useEffect(() => {
    authAccessTokenRef.current = authAccessToken;
  }, [authAccessToken]);

  useEffect(() => {
    multiplayerIdentityUserIdRef.current = multiplayerIdentityUserId;
  }, [multiplayerIdentityUserId]);

  useEffect(() => {
    if (justVerified) {
      showToast('✓ Email verified! Welcome to Racehorse Dominoes.', 5000);
    }
  }, [justVerified, showToast]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    if (state) return;
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepOpponentHandCount(null);
    setBoneyardDisplayCount(null);
  }, [state, setDrawSequenceActiveBoth]);

  useEffect(() => {
    if (!socket || !authUser?.id) return;

    const username = authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player';

    const emitIdentify = () => {
      console.log('[presence] emitting presence:identify', { userId: authUser.id, connected: socket.connected });
      socket.emit('presence:identify', { userId: authUser.id, username, authToken: authAccessToken }, () => {
        console.log('[presence] identify ack received');
      });
    };

    // Always register reconnect handler
    socket.on('connect', emitIdentify);

    // Also fire immediately if already connected
    if (socket.connected) {
      emitIdentify();
    }

    return () => {
      socket.off('connect', emitIdentify);
    };
  }, [socket, authUser?.id, authProfile?.username, authUser?.email, authAccessToken]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (
      shouldPersistLastRoomCode({
        joinedRoom,
        preventAutoRejoin: preventAutoRejoinRef.current,
        gameOver: state?.gameOver,
        isTerminalTournamentMatch: Boolean(
          tournamentMatch?.matchId && isTerminalTournamentMatch(tournamentMatch.matchId),
        ),
      })
    ) {
      saveLastRoomCode(joinedRoom!);
    }
  }, [joinedRoom, state?.gameOver, tournamentMatch?.matchId]);

  useEffect(() => {
    if (inviteJoinInFlightRef.current) return;
    const linkedRoom = readRoomInviteCodeFromLocation();
    if (!linkedRoom) return;
    setRoomCode(linkedRoom);
    setAppMode('home');
  }, []);

  const getInviteLink = useCallback((code: string) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  }, []);

  const resolvePendingCreate = useCallback((code: string | null) => {
    const pending = pendingCreateResolversRef.current.splice(0);
    pending.forEach((resolve) => resolve(code));
  }, []);

  const resetClientGameSession = useCallback(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
    autoTurnActionKeyRef.current = '';
    mpAutoDrawSuppressUntilSequenceRef.current = null;
    frozenHandOverBoardRef.current = null;
    playerReadyEmittedRef.current = false;
    matchStartedRef.current = false;
    rematchAwaitingStateRef.current = false;
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    setOpponentDisconnected(false);
    setOpponentDisconnectMessage('');
    setBoneyardDisplayCount(null);
    clearTransientRoomUi();
  }, [
    clearTournamentAttachRefs,
    clearTransientRoomUi,
    rematchAwaitingStateRef,
    setBoneyardDisplayCount,
    setOpponentDisconnected,
    setOpponentDisconnectMessage,
  ]);

  resetClientGameSessionRef.current = resetClientGameSession;

  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      setJoinedRoom(null);
      setTournamentMatch(null);
      roomIdentityRef.current = null;
      if (clearRoomCode) setRoomCode('');
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setSelectedTile(null);
      setHandReveal(null);
      setRematchRequested(false);
      setRematchReadyIds([]);
      setScoreTrackOpen(false);
      pendingActionRef.current = false;
      if (!keepPlayers) {
        setPlayers([]);
      }
      resetClientGameSession();
    },
    [resetClientGameSession, setTournamentMatch],
  );
  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;

  const resetRoomRecoveryState = useCallback(() => {
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    preventAutoRejoinRef.current = true;
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
  }, []);

  const clearRecoverableRoomState = useCallback(() => {
    resetRoomRecoveryState();
    clearLastRoomCode();
    rejoinInFlightRef.current = false;
    reconnectAttemptCountRef.current = 0;
    tournament.clearPendingMatch();
    tournament.clearRecoveryMatch();
  }, [resetRoomRecoveryState, tournament]);
  clearRecoverableRoomStateRef.current = clearRecoverableRoomState;


  /** Leave the current private room, stay connected, and return to Private Match create/join (not Quick Match). */
  const leavePrivateLobbyRoom = useCallback(() => {
    const code = normalizeRoomCode(joinedRoomRef.current);
    const s = socketRef.current;
    if (s?.connected && code) {
      emitRoomLeave(s, code);
    }
    clearLastRoomCode();
    intentionalDisconnectRef.current = false;
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    clearReconnectAttemptTimer();
    reconnectAttemptCountRef.current = 0;
    rejoinInFlightRef.current = false;
    preventAutoRejoinRef.current = false;
    autoJoinAttemptedRef.current = false;
    setIsRecoveringConnection(false);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
    setRoomReactions([]);
    resetMultiplayerRoomState({ clearRoomCode: true });
    clearOutboundChallenge();
    /* Stay on Private Match → create / join lobby; do not jump to Quick Match. */
    setMpSubView('private');
  }, [
    normalizeRoomCode,
    clearReconnectAttemptTimer,
    clearOutboundChallenge,
    resetMultiplayerRoomState,
    setMpSubView,
    setIsRecoveringConnection,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setRoomReactions,
  ]);

  const applyRoomEventMeta = useCallback((meta?: RoomEventMeta | null) => {
    if (!meta) return;
    const incomingMatchId = typeof meta.matchId === 'string' ? meta.matchId : null;
    if (incomingMatchId && roomMatchIdRef.current && roomMatchIdRef.current !== incomingMatchId) {
      maxSequenceRef.current = -1;
      maxEventSequenceRef.current = -1;
    }
    if (incomingMatchId) {
      roomMatchIdRef.current = incomingMatchId;
    }
    if (typeof meta.lastEventSequence === 'number') {
      maxEventSequenceRef.current = Math.max(maxEventSequenceRef.current, meta.lastEventSequence);
    }
  }, []);

  const emitCreateRoom = useCallback(
    async (targetSocket: Socket) => {
      setError('');
      setActionError('');
      try {
        const username = authProfile?.username ?? 'Guest';
        const userId = multiplayerIdentityUserId;
        const authToken = multiplayerAuthToken;

        const resp = await emitRoomCreate(targetSocket, {
          username,
          userId,
          authToken,
        });
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }

        applyJoinedRoomResponseRef.current(resp);
        autoJoinAttemptedRef.current = false;
        preventAutoRejoinRef.current = false;
        resolvePendingCreate(resp.roomCode ?? null);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate],
  );

  const applyJoinedRoomResponse = useCallback((resp: any) => {
    joinedRoomResponseRef.current = resp;
    applyRoomEventMeta(resp.eventMeta);

    if (!roomIdentityRef.current) {
      roomIdentityRef.current = {
        username: authProfile?.username ?? 'Guest',
        userId: multiplayerIdentityUserId,
        authToken: multiplayerAuthToken,
      };
    }

    const resolvedYou =
      typeof resp?.you === 'string' && resp.you ? resp.you : '';

    if (resolvedYou) {
      setYou(resolvedYou);
      youRef.current = resolvedYou;
    }

    const { ok, nextState } = applyJoinResponseGameState(resp);
    if (!ok && resp.state != null) {
      console.warn('[mp] room:join handshake state failed projection validation — resync scheduled');
      void fetchGameStateRef.current('join_ack_projection_invalid');
    }

    setJoinedRoom(resp.roomCode);
    setRoomCode(resp.roomCode);
    const normalized = normalizeRoomPlayers(resp.players);
    roomPlayersRef.current = normalized;
    setPlayers(normalized);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
    if (
      applyTournamentMetadataFromJoin(resp, nextState) === 'terminal_handled'
    ) {
      return;
    }

    const roster = normalizeRoomPlayers(resp.players);
    const seated =
      Boolean(resolvedYou) &&
      (roster.some((p) => p.id === resolvedYou) ||
        (Array.isArray(nextState?.playerIds) && nextState.playerIds.includes(resolvedYou)));
    isSeatedPlayerRef.current = seated;
    matchStartedRef.current = resp.matchStarted === true;
    if (!seated) {
      playerReadyEmittedRef.current = false;
    } else if (!matchStartedRef.current) {
      playerReadyEmittedRef.current = false;
    }

    if (hasHandIdentityMismatch(nextState, resolvedYou)) {
      void fetchGameStateRef.current('hand_identity_mismatch_after_join');
    } else if (seated && !matchStartedRef.current) {
      trySchedulePlayerReadyRef.current();
    }
  }, [
    applyRoomEventMeta,
    applyJoinResponseGameState,
    applyTournamentMetadataFromJoin,
    socket?.id,
    authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    normalizeRoomPlayers,
  ]);

  /** Fetch full authoritative game state from the server (room:join ack). */
  const fetchGameState = useCallback(
    async (reason: string) => {
      const activeSocket = socketRef.current;
      const roomCode = normalizeRoomCode(joinedRoomRef.current);
      if (!activeSocket?.connected || !roomCode) return false;
      if (resyncInFlightRef.current || rejoinInFlightRef.current) return false;
      const now = Date.now();
      if (now < resyncCooldownUntilRef.current) return false;

      resyncInFlightRef.current = true;
      resyncCooldownUntilRef.current = now + 1200;
      setRoomRecoveryState('resyncing');
      setRoomRecoveryMessage('Syncing game state…');

      const identity =
        roomIdentityRef.current ?? {
          username: authProfile?.username ?? 'Guest',
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        };

      try {
        const resp = await emitRoomJoin(activeSocket, roomCode, identity);
        if (!resp?.ok) {
          console.error('[mp] fetchGameState failed', { reason, error: resp?.error });
          return false;
        }
        applyJoinedRoomResponse(resp);
        return true;
      } catch (error) {
        console.error('[mp] fetchGameState error', {
          reason,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        resyncInFlightRef.current = false;
        resyncFlushRef.current?.();
        if (joinedRoomRef.current) {
          setRoomRecoveryState('idle');
          setRoomRecoveryMessage('');
        }
      }
    },
    [
      normalizeRoomCode,
      emitWithAck,
      applyJoinedRoomResponse,
      authProfile?.username,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
    ],
  );

  /** Last-line defense: malformed snapshots should never drive the tabletop UI in a joined room. */
  useEffect(() => {
    if (!joinedRoom) return;
    if (!state) return;
    if (!isRenderableMultiplayerSnapshot(state)) {
      void fetchGameState('runtime_state_projection_guard');
    }
  }, [joinedRoom, state, fetchGameState]);

  const markClientSpectator = useCallback(() => {
    isSeatedPlayerRef.current = false;
  }, []);

  const trySchedulePlayerReady = useCallback(() => {
    if (!isSeatedPlayerRef.current || matchStartedRef.current || playerReadyEmittedRef.current) {
      return;
    }

    // Quick match deferral: wait until both players are seated before emitting player:ready.
    // This prevents the server from timing out or starting a deal before the real opponent
    // has even finished their join handshake.
    const isQuickMatch = appModeRef.current === 'multiplayer' && mpSubViewRef.current === 'quick';
    if (isQuickMatch) {
      if (roomPlayersRef.current.length < 2) {
        return;
      }
    }

    void schedulePlayerReadyRef.current();
  }, []);

  /**
   * Emit player:ready only after room:join ack is applied (seated, lobby before deal).
   * Uses server matchStarted — not local state — so a partial state:update cannot block ready.
   */
  const schedulePlayerReady = useCallback(async () => {
    if (!isSeatedPlayerRef.current || playerReadyEmittedRef.current) return;
    const activeSocket = socketRef.current;
    const roomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!activeSocket?.connected || !roomCode || matchStartedRef.current) {
      return;
    }

    playerReadyEmittedRef.current = true;
    try {
      const ack = await emitWithAck<any>(activeSocket, 'player:ready', roomCode);
      if (ack?.started === true) {
        matchStartedRef.current = true;
      }
    } catch (error) {
      playerReadyEmittedRef.current = false;
      console.error('[mp] player:ready failed', error instanceof Error ? error.message : error);
    }
  }, [normalizeRoomCode, emitWithAck]);

  fetchGameStateRef.current = fetchGameState;
  applyRoomEventMetaRef.current = applyRoomEventMeta;
  schedulePlayerReadyRef.current = schedulePlayerReady;
  applyJoinedRoomResponseRef.current = applyJoinedRoomResponse;
  trySchedulePlayerReadyRef.current = trySchedulePlayerReady;

  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const roomCode = payload.roomCode.trim().toUpperCase();
      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) {
        return;
      }
      if (normalizeRoomCode(joinedRoomRef.current) === roomCode) {
        return;
      }

      setOverlayPayload(payload);

      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      setAppMode('multiplayer');
      activeSocket.emit(
        'room:join',
        roomCode,
        { username, userId: multiplayerIdentityUserId, authToken: multiplayerAuthToken },
        (resp: any) => {
          if (!resp?.ok) {
            showToast(resp?.error ?? 'Could not join matched room.', 2500);
            return;
          }
          applyJoinedRoomResponse(resp);
        },
      );
    },
    [
      normalizeRoomCode,
      authProfile?.username,
      authUser?.email,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      applyJoinedRoomResponse,
      showToast,
      setAppMode,
    ],
  );

  useEffect(() => {
    if (mpSubView !== 'quick' || !joinedRoom || state) return;
    const roomCode = joinedRoom;
    const timer = window.setTimeout(() => {
      if (!matchStartedRef.current && isSeatedPlayerRef.current) {
        playerReadyEmittedRef.current = false;
        trySchedulePlayerReadyRef.current();
      }
      void fetchGameState('quick_match_stall');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [mpSubView, joinedRoom, state, fetchGameState]);

  useEffect(() => {
    if (!friendInvite) return;
    const timer = setTimeout(() => {
      setFriendInvite(null);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

  useEffect(() => {
    if (!socket) return;
    const onDeclined = (payload: { inviteId?: string; fromUsername?: string }) => {
      setOutboundChallenge((current) => {
        if (!current) return null;
        if (payload.inviteId && current.inviteId !== payload.inviteId) return current;
        const name = payload.fromUsername ?? current.friendUsername;
        showToast(`${name} declined the challenge.`, 2400);
        return null;
      });
    };
    socket.on('friend:invite:declined', onDeclined);
    return () => {
      socket.off('friend:invite:declined', onDeclined);
    };
  }, [showToast, socket]);

  useEffect(() => {
    if (!outboundChallenge) return;
    const delay = Math.max(0, outboundChallenge.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setOutboundChallenge((current) => {
        if (!current || current.inviteId !== outboundChallenge.inviteId) return current;
        return null;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [outboundChallenge]);

  useEffect(() => {
    if (players.length >= 2 && outboundChallenge) {
      clearOutboundChallenge();
    }
  }, [players.length, outboundChallenge, clearOutboundChallenge]);

  useEffect(() => {
    if (appMode !== 'feed' || !authUser) return;
    if (!socket?.connected) connectRef.current();
  }, [appMode, authUser, socket?.connected]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (appRootRef.current) {
        await appRootRef.current.requestFullscreen();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to toggle fullscreen.';
      setError(`Fullscreen error: ${message}`);
    }
  }, []);

  const { connect, retryRoomRecovery, disconnect } = useMultiplayerConnection({
    emitWithAck,
    normalizeRoomCode,
    lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
    serverUrl,
    socket,
    isConnecting,
    isConnected,
    roomRecoveryState,
    appMode,
    authUserId: authUser?.id ?? null,
    authEmail: authUser?.email ?? null,
    authProfileUsername: authProfile?.username ?? null,
    tournamentId,
    tournamentStateStatus: tournamentState?.status ?? null,
    roomCode,
    connectRef,
    socketRef,
    authUserRef,
    authProfileRef,
    authAccessTokenRef,
    multiplayerIdentityUserIdRef,
    joinedRoomRef,
    youRef,
    stateRef,
    pendingCreateOnConnectRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    preventAutoRejoinRef,
    autoJoinAttemptedRef,
    joinInFlightRef,
    createInFlightRef,
    inviteJoinInFlightRef,
    rejoinInFlightRef,
    intentionalDisconnectRef,
    reconnectAttemptTimerRef,
    reconnectAttemptCountRef,
    autoConnectAttemptedRef,
    draggingStateRef,
    isMutedRef,
    handRevealShownRef,
    handRevealTimerRef,
    maxSequenceRef,
    roomIdentityRef,
    setSocket,
    setIsConnected,
    setIsConnecting,
    setIsRecoveringConnection,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setYou,
    setServerWaking,
    setError,
    setActionError,
    setRematchRequested,
    setRematchReadyIds,
    setOpponentDragging,
    setJoinedRoom,
    setState,
    setLegalMoves,
    setCanDraw,
    setTournamentId,
    setTournamentState,
    setTournamentActiveRoom,
    setRoomCode,
    setAppMode,
    setRoomReactions,
    setHandReveal,
    setPlayers,
    setSelectedTile,
    setPendingUiAction,
    showToast,
    applyJoinedRoomResponse,
    emitCreateRoom,
    clearReconnectAttemptTimer,
    clearTransientRoomUi,
    fetchGameState,
    resetClientGameSession,
    rematchAwaitingStateRef,
  });

  const authUsernameRef = useRef(authProfile?.username ?? 'Guest');
  const authUserIdRef = useRef<string | null>(multiplayerIdentityUserId);
  const authTokenRef = useRef<string | null>(multiplayerAuthToken);
  useEffect(() => {
    authUsernameRef.current = authProfile?.username ?? 'Guest';
    authUserIdRef.current = multiplayerIdentityUserId;
    authTokenRef.current = multiplayerAuthToken;
  }, [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken]);

  const {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
    acceptFriendInvite,
    declineFriendInvite,
    sendFriendChallenge,
  } = useMultiplayerRoomActions({
    socket,
    socketRef,
    connectRef,
    joinedRoomRef,
    pendingCreateOnConnectRef,
    pendingCreateResolversRef,
    autoJoinAttemptedRef,
    preventAutoRejoinRef,
    joinInFlightRef,
    createInFlightRef,
    inviteJoinInFlightRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    roomCode,
    friendInvite,
    authUsername: authProfile?.username ?? 'Guest',
    authUserId: multiplayerIdentityUserId,
    authToken: multiplayerAuthToken,
    authUsernameRef,
    authUserIdRef,
    authTokenRef,
    normalizeRoomCode,
    normalizeRoomPlayers,
    emitWithAck,
    emitCreateRoom,
    getInviteLink,
    resolvePendingCreate,
    applyJoinedRoomResponse,
    showToast,
    setAppMode,
    setRoomCode,
    setPlayers,
    setError,
    setActionError,
    setPendingUiAction,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setFriendInvite,
    setMpSubView,
    outboundChallenge,
    setOutboundChallenge,
    roomIdentityRef,
    lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
  });

  const friendInvitePopup = friendInvite ? (
    <IncomingFriendChallengeCard
      invite={friendInvite}
      joining={pendingUiAction === 'join'}
      onAccept={() => {
        void acceptFriendInvite();
      }}
      onDecline={declineFriendInvite}
    />
  ) : null;

  useEffect(() => {
    if (!weeklyStatsOpen) return;

    if (!socket || !socket.connected) {
      connect();
      window.setTimeout(() => loadWeeklyAwards(), 250);
      return;
    }

    loadWeeklyAwards();
  }, [weeklyStatsOpen, socket, connect, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) {
      setPlayersOnlineCount(null);
      return;
    }

    let active = true;
    const refreshPresence = () => {
      socket.emit('presence:online', [], (resp: any) => {
        if (!active || !resp?.ok) return;
        if (Number.isFinite(resp.onlineCount)) {
          setPlayersOnlineCount(Number(resp.onlineCount));
          return;
        }
        if (Array.isArray(resp.onlineUserIds)) {
          setPlayersOnlineCount(resp.onlineUserIds.length);
          return;
        }
        setPlayersOnlineCount(null);
      });
    };

    refreshPresence();
    const interval = window.setInterval(refreshPresence, 30000);
    const onConnect = () => refreshPresence();
    socket.on('connect', onConnect);

    return () => {
      active = false;
      window.clearInterval(interval);
      socket.off('connect', onConnect);
    };
  }, [appMode, socket]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) return;

    loadWeeklyAwards();
    const interval = window.setInterval(loadWeeklyAwards, 60000);
    return () => window.clearInterval(interval);
  }, [appMode, socket, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'botSetup') return;
    setBotDealSize(7);
  }, [appMode]);




  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    const inTournament = Boolean(currentTournamentContext) || Boolean(tournamentId) || tournamentState?.status === 'running';
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    if (!inTournament) return disconnect('post-game to home');
    resetMultiplayerRoomState({ keepPlayers: true });
    setActionError('');
    setAppMode('tournament');
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    tournamentId,
    tournamentState?.status,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);

  const _backToTournamentHub = useCallback(() => {
    navigateAfterTournamentMatch('hub');
  }, [navigateAfterTournamentMatch]);

  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!activeSocket?.connected || !activeRoomCode) {
      setActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitRoomAbandonMatch(activeSocket, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', {
          roomCode: activeRoomCode,
          error: errorMessage,
        });
        setActionError(errorMessage);
        showToast(errorMessage, 2200);
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      clearRecoverableRoomState();
      resetMultiplayerRoomState({ keepPlayers: true });
      setActionError('');
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(currentTournamentContext.tournamentId);
        void tournament.refresh();
      } else {
        setAppMode('multiplayer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not leave the match.';
      console.log('[leave-game] ack/error', {
        roomCode: activeRoomCode,
        error: message,
      });
      setActionError(message);
      showToast(message, 2200);
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    emitWithAck,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);

  const openMultiplayerAnalyzer = useCallback(() => {
    const analysis = analyzeMoveLog(multiplayerMoveLog, true);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('multiplayer', analysis);
    setAnalyzerOpen(true);
  }, [multiplayerMoveLog]);

  const isHandActive = Boolean(state) && !state?.handOver && !state?.gameOver;
  const handCompactStacked = myHand.length > 9;

  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const opponent = players.find((pl) => pl.id !== you) ?? null;
  const tournamentOpponentLabel = tournamentMatch
    ? resolveTournamentOpponentLabel({
        opponentUserId: tournamentMatch.opponentUserId,
        opponentUsername: tournamentMatch.opponentUsername,
        round: tournamentMatch.round,
        roomOpponentUsername: opponent?.username ?? null,
      })
    : null;
  const tournamentMyLabel = authProfile?.username
    ? authProfile.username.replace(/^@/, '')
    : 'You';
  const opponentName = tournamentMatch
    ? tournamentOpponentLabel ?? 'Opponent'
    : opponent?.username
      ? opponent.username.startsWith('@')
        ? opponent.username
        : `@${opponent.username}`
      : 'Rival';
  const myName = authProfile?.username ? `@${authProfile.username}` : 'you';
  const myHandle = authProfile?.username
    ? `@${authProfile.username}`
    : authUser?.email
      ? `@${authUser.email.split('@')[0]}`
      : '@player';
  const homeInitials = useMemo(() => {
    const source = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'racehorse';
    const parts = source
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
    return initials || source.slice(0, 2).toUpperCase();
  }, [authProfile?.username, authUser?.email]);
  const homeRatingLabel = (authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : 800).toLocaleString();
  const homeFriendsOnline = 3;
  const homePlayersOnline = playersOnlineCount ?? 142;
  const homeActiveRooms = Math.max(12, Math.round(homePlayersOnline / 12));
  const homeLeaderRating = '1,820';
  const [activeHomeMode, setActiveHomeMode] = useState<
    'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'
  >('multiplayer');
  const weeklyAwardRows = Array.isArray(weeklyAwards?.awards) ? weeklyAwards.awards : [];
  const weeklyLeaderHandle = useMemo(() => {
    const mostWins = weeklyAwardRows.find((entry: any) =>
      `${entry?.key ?? ''} ${entry?.title ?? ''}`.toLowerCase().includes('most wins'),
    );
    const fallback = weeklyAwardRows.find((entry: any) => Boolean(entry?.leader?.username));
    const username = mostWins?.leader?.username ?? fallback?.leader?.username ?? null;
    return username ? `@${username}` : null;
  }, [weeklyAwardRows]);
  const homeLeaderHandle = weeklyLeaderHandle ?? '@kai';
  const weeklyRank: number | null = null;
  const hasSocialProofData =
    playersOnlineCount !== null && weeklyLeaderHandle !== null && weeklyRank !== null;
  useRenderProfiler(inGame ? 'MultiplayerGameShell' : 'AppNonGame');
  const isSpectatingMatch = Boolean(tournamentId && joinedRoom && state && !state.playerIds.includes(you));
  const isTournamentMatch = Boolean(tournamentMatch?.isTournament || tournamentId || tournamentState?.status === 'running');
  const spectateRightPlayerId = isSpectatingMatch ? (state?.playerIds?.[1] ?? null) : null;
  const spectateRightPlayer = spectateRightPlayerId ? players.find((pl) => pl.id === spectateRightPlayerId) ?? null : null;
  const hudRightLabel = isSpectatingMatch
    ? (spectateRightPlayer?.username ? `@${spectateRightPlayer.username}` : 'Spectating')
    : myName;
  const hudRightScore =
    isSpectatingMatch && spectateRightPlayerId ? (state?.players[spectateRightPlayerId]?.score ?? 0) : myScore;
  const hudRightScorePulse = isSpectatingMatch && spectateRightPlayerId ? Boolean(hudScorePulse[spectateRightPlayerId]) : Boolean(hudScorePulse[you]);
  const openEndsSum = state?.board ? computeOpenEndsSum(state.board) : 0;
  if (state?.board) {
    assertDisplayedOpenCountMatchesCanonical(state.board, openEndsSum, 'multiplayer');
  }
  const canUseRematch = Boolean(
    state?.gameOver && joinedRoom && !isSpectatingMatch && !isTournamentMatch && state.playerIds.includes(you),
  );
  const isRoomHost = players[0]?.id === you;
  const rematchWaitingText = rematchRequested
    ? (() => {
        const readyNames = rematchReadyIds
          .map((pid) => {
            if (pid === you) return 'You';
            const player = players.find((pl) => pl.id === pid);
            return player?.username ? `@${player.username}` : 'Opponent';
          })
          .join(', ');
        return readyNames ? `Waiting for opponent... Ready: ${readyNames}` : 'Waiting for opponent...';
      })()
    : undefined;
  const multiplayerRatingEligible = Boolean(
    !isTournamentMatch &&
    !isSpectatingMatch &&
    authUser &&
    players.length === 2 &&
    players.every((p) => Boolean(p.userId)),
  );
  const multiplayerRatingSummary =
    multiplayerRatingEligible && state?.gameOver
      ? {
          pending: multiplayerRatingPending,
          delta:
            multiplayerRatingBaseline != null && authProfile?.glicko_rating != null
              ? Math.round(Number(authProfile.glicko_rating) - multiplayerRatingBaseline)
              : null,
          newRating:
            authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null,
        }
      : null;

  useEffect(() => {
    setRematchRequested(false);
    setRematchReadyIds([]);
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
    setMultiplayerRatingPending(false);
    multiplayerRatingRefreshKeyRef.current = '';
    previousMultiplayerGameOverRef.current = false;
  }, [joinedRoom]);

  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    const showPrivateMatchLobby =
      (!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && Boolean(joinedRoom) && !state);
    if (!showPrivateMatchLobby) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    let cancelled = false;
    void fetchUserStatsByUserId(authUser.id).then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setPrivateLobbyHostWinStreak(null);
        return;
      }
      setPrivateLobbyHostWinStreak(res.data.currentWinStreak);
    });
    return () => {
      cancelled = true;
    };
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, state]);

  useEffect(() => {
    if (!joinedRoom || state?.gameOver) return;
    if (multiplayerRatingBaseline != null) return;
    if (authProfile?.glicko_rating == null) return;
    setMultiplayerRatingBaseline(Number(authProfile.glicko_rating));
  }, [authProfile?.glicko_rating, joinedRoom, multiplayerRatingBaseline, state?.gameOver]);

  useEffect(() => {
    const wasGameOver = previousMultiplayerGameOverRef.current;
    const isGameOver = Boolean(state?.gameOver);
    if (wasGameOver && !isGameOver) {
      setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
      setMultiplayerRatingPending(false);
      multiplayerRatingRefreshKeyRef.current = '';
    }
    previousMultiplayerGameOverRef.current = isGameOver;
  }, [authProfile?.glicko_rating, state?.gameOver]);

  useEffect(() => {
    if (!state?.gameOver || !joinedRoom || !authUser || isSpectatingMatch || isTournamentMatch) return;
    const ratingEligible = players.length === 2 && players.every((p) => Boolean(p.userId));
    if (!ratingEligible) return;
    const key = `${joinedRoom}:${state.handNumber}:${state.players[you]?.score ?? 0}:${state.winnerId ?? ''}`;
    if (multiplayerRatingRefreshKeyRef.current === key) return;
    multiplayerRatingRefreshKeyRef.current = key;
    setMultiplayerRatingPending(true);
    let cancelled = false;
    const baselineRating = multiplayerRatingBaseline;
    const retryDelaysMs = [0, 700, 1400, 2400, 3600, 5200];

    void (async () => {
      try {
        for (let i = 0; i < retryDelaysMs.length; i += 1) {
          const delayMs = retryDelaysMs[i];
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          if (cancelled) return;

          try {
            await Promise.resolve(refreshAuthProfile());
          } catch (err) {
            console.warn('[Multiplayer Rating] profile refresh failed:', err);
          }

          if (cancelled) return;
          const latestRating = authProfileRef.current?.glicko_rating;
          if (
            latestRating != null &&
            (baselineRating == null || Number(latestRating) !== baselineRating || i === retryDelaysMs.length - 1)
          ) {
            return;
          }
        }
      } finally {
        if (!cancelled) {
          setMultiplayerRatingPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authUser,
    isSpectatingMatch,
    isTournamentMatch,
    joinedRoom,
    multiplayerRatingBaseline,
    players,
    refreshAuthProfile,
    state,
    you,
  ]);

  useEffect(() => {
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, myHand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = tileCount > 9;
      const maxTileSize = (isLandscape && isMobileWidth) ? 42 : (tileCount > 9 ? 50 : 68);
      const containerWidth = trayCenterRef.current?.offsetWidth ?? window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      setHandTileSize(tileWidth);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [myHand.length]);

  useEffect(() => {
    if (!inGame) {
      prevMyHandLenRef.current = 0;
      setDrawPulseIndex(null);
      return;
    }

    if (myHand.length > prevMyHandLenRef.current) {
      setDrawPulseIndex(myHand.length - 1);
      const timer = setTimeout(() => setDrawPulseIndex(null), 360);
      prevMyHandLenRef.current = myHand.length;
      return () => clearTimeout(timer);
    }

    prevMyHandLenRef.current = myHand.length;
    setDrawPulseIndex(null);
  }, [inGame, myHand.length]);

  useEffect(() => {
    if (!state) {
      previousStateForAnalysisRef.current = null;
      return;
    }
    const prev = previousStateForAnalysisRef.current;
    previousStateForAnalysisRef.current = state;
    if (!prev) return;
    if (state.handNumber !== prev.handNumber) return;
    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId || actorId === you) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    let action: MoveEntry['action'] = 'pass';
    if (nextBoardCount > prevBoardCount) action = 'place';
    else if ((state.boneyard?.length ?? 0) < (prev.boneyard?.length ?? 0)) action = 'draw';
    if (action === 'place') {
      flashLastPlayed(findPlacedTile(prev.board, state.board));
    }

    appendMultiplayerMove({
      player: 'opponent',
      action,
      boardEnds: getBoardEnds(prev.board),
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: snapshotBoardState(prev.board),
      boardRenderState: cloneBoardState(prev.board),
      handSnapshot: (prev.players[you]?.hand ?? []).map(toTileTuple),
      engineBestMove: null,
    });
  }, [state, you, appendMultiplayerMove, flashLastPlayed]);

  // Pulse the opp-tile card whenever the count changes
  useEffect(() => {
    if (prevOppCountRef.current !== null && prevOppCountRef.current !== opponentTileCount) {
      setOppTilePulse(true);
      const t = setTimeout(() => setOppTilePulse(false), 250);
      return () => clearTimeout(t);
    }
    prevOppCountRef.current = opponentTileCount;
  }, [opponentTileCount]);

  // Pulse score cards on scoring events.
  useEffect(() => {
    if (!state) return;

    const nextScores: Record<string, number> = {};
    const nextPulse: Record<string, boolean> = {};
    let changed = false;

    for (const pid of state.playerIds) {
      const score = state.players[pid]?.score ?? 0;
      const prevScore = prevHudScoresRef.current[pid];
      nextScores[pid] = score;
      if (prevScore !== undefined && prevScore !== score) {
        nextPulse[pid] = true;
        changed = true;
        const delta = score - prevScore;
        if (delta > 0 && !state.handOver && !state.gameOver) {
          playScoreSound(delta, isMutedRef.current);
          if (pid === you) {
            showScoreToast('you', delta, 'You');
          } else {
            const playerName =
              players.find((p) => p.id === pid)?.username?.trim() || opponentName || 'Opponent';
            showScoreToast('opp', delta, playerName);
          }
        }
      }
    }

    prevHudScoresRef.current = nextScores;
    if (!changed) return;

    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state, you, players, opponentName, showScoreToast]);

  // Track turn changes for UI state sync.
  useEffect(() => {
    if (!inGame || !state) {
      prevBoardTileCountRef.current = 0;
      prevTurnIdRef.current = null;
      return;
    }

    const currentTileCount = getBoardTileCount(state.board);
    prevBoardTileCountRef.current = currentTileCount;

    const activePlayerId = state.playerIds[state.currentPlayerIndex] ?? null;
    prevTurnIdRef.current = activePlayerId;
  }, [inGame, state]);

  useEffect(() => {
    const finalState = state;
    const isGameOver = Boolean(finalState?.gameOver);
    if (!isGameOver) {
      prevGameOverRef.current = false;
      matchRecordKeyRef.current = '';
      return;
    }
    if (!finalState) return;
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    if (!joinedRoom) return;

    const winnerSocketId = finalState?.winnerId ?? null;
    if (!winnerSocketId) return;
    if (winnerSocketId === you) {
      playMatchWinSound(isMutedRef.current);
    } else {
      playMatchLoseSound(isMutedRef.current);
    }
    if (winnerSocketId === you) {
      const canvas = confettiCanvasRef.current;
      if (canvas) {
        void import('canvas-confetti').then(({ default: confetti }) => {
          const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
          const colors = ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff', '#f59e0b'];

          myConfetti({
            particleCount: 120,
            spread: 100,
            origin: { x: 0.5, y: 0.4 },
            colors,
            scalar: 1.3,
          });
          setTimeout(
            () =>
              myConfetti({
                particleCount: 80,
                spread: 120,
                origin: { x: 0.2, y: 0.5 },
                colors,
                scalar: 1.1,
              }),
            200,
          );
          setTimeout(
            () =>
              myConfetti({
                particleCount: 80,
                spread: 120,
                origin: { x: 0.8, y: 0.5 },
                colors,
                scalar: 1.1,
              }),
            400,
          );
        }).catch(() => {
          // Confetti is celebratory only; skip if the chunk fails to load.
        });
      }
    }
    const loserSocketId = finalState.playerIds.find((pid) => pid !== winnerSocketId) ?? null;
    if (!loserSocketId) return;

    const key = `${joinedRoom}:${winnerSocketId}:${loserSocketId}`;
    if (matchRecordKeyRef.current === key) return;
    matchRecordKeyRef.current = key;

    if (!supabaseEnabled || !authUser) return;

    const bySocketId = new Map(players.map((p) => [p.id, p.userId ?? null] as const));
    let winnerUserId = bySocketId.get(winnerSocketId) ?? null;
    let loserUserId = bySocketId.get(loserSocketId) ?? null;

    // Always ensure the authenticated user's ID is set
    // correctly - never leave both sides unidentified.
    if (winnerSocketId === you) {
      winnerUserId = authUser.id;
    } else if (loserSocketId === you) {
      loserUserId = authUser.id;
    }

    // If we still can't place the current user as a
    // participant, skip recording - better no record
    // than a corrupted one.
    if (winnerUserId !== authUser.id && loserUserId !== authUser.id) return;

    // Server records authenticated online H2H once on game over; both clients used to insert.
    if (winnerUserId && loserUserId) return;

    const winnerScore = finalState.players[winnerSocketId]?.score ?? null;
    const loserScore = finalState.players[loserSocketId]?.score ?? null;
    const matchAnalysis = analyzeMoveLog(multiplayerMoveLog, true);
    const avgMoveQuality =
      matchAnalysis.analyzedMoves.length > 0 && matchAnalysis.accuracy > 0
        ? matchAnalysis.accuracy
        : undefined;

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.log('[StatsDebug] about to record match', {
        joinedRoom,
        you,
        winnerSocketId,
        loserSocketId,
        winnerUserId,
        loserUserId,
        winnerScore,
        loserScore,
      });
    }

    void recordMatchResult({
      mode: 'online',
      opponentType: 'online',
      winnerUserId,
        loserUserId,
        winnerScore,
        loserScore,
        avgMoveQuality,
        moveCount: null,
        roomCode: joinedRoom,
        metadata: { roomCode: joinedRoom, winnerSocketId, loserSocketId },
    }).then(({ error }) => {
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.log('[StatsDebug] recordMatchResult response', { error });
      }

      if (error && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.error('[Stats] recordMatchResult failed:', error);
      }
    });
  }, [state, joinedRoom, players, supabaseEnabled, authUser, you, multiplayerMoveLog]);


  // ─── Render ───────────────────────────────────────────────
  const appRootClassName = 'app large-mode';
  const showLearnAdminView = (() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('learnAdmin')?.trim().toLowerCase();
      return raw === '1' || raw === 'true' || raw === 'yes';
    } catch {
      return false;
    }
  })();

  const handleOpenAuthModal = () => setAuthModalOpen(true);
  const handleOpenAccountModal = () => setUsernameModalOpen(true);

  const authModalsLayer = (
    <Suspense fallback={null}>
      <AuthModal
        open={authModalOpen}
        supabaseEnabled={supabaseEnabled}
        supabaseConfigError={supabaseConfigError}
        onClose={() => setAuthModalOpen(false)}
        onSignIn={signIn}
        onSignUp={signUp}
        onResetPassword={resetPassword}
      />
      <UsernameModal
        open={(!onboardingDismissed && needsUsernameOnboarding) || usernameModalOpen}
        currentUsername={authProfile?.username ?? null}
        isProfileEdit={usernameModalOpen}
        onSave={async (username) => {
          const result = await updateUsername(username);
          if (!result.error) {
            window.localStorage.removeItem('username_onboarding_dismissed');
            setOnboardingDismissed(false);
            setUsernameModalOpen(false);
          }
          return result;
        }}
        onClose={() => {
          window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
          setOnboardingDismissed(true);
          setUsernameModalOpen(false);
        }}
        onSignOut={async () => {
          resetRoomRecoveryState();
          setSigningOut(true);
          setAppMode('home');
          resetMultiplayerRoomState();
          setError('');
          setActionError('');
          try {
            void signOut().catch(() => {});
          } catch {
            // no-op
          } finally {
            setSigningOut(false);
            setUsernameModalOpen(false);
            setOnboardingDismissed(false);
            setAuthModalOpen(true);
          }
        }}
        signingOut={signingOut}
      />
    </Suspense>
  );

  const withAuthModals = (node: React.ReactNode) => (
    <>
      {node}
      {authModalsLayer}
    </>
  );

  if (typeof window !== 'undefined' && (window.location.pathname === '/redesign' || window.location.pathname === '/') && appMode === 'home') {
    return withAuthModals(
      <RacehorseHomeScreen
        setAppMode={setAppMode}
        onOpenAuth={handleOpenAuthModal}
        onOpenAccount={handleOpenAccountModal}
      />,
    );
  }

  if (appMode === 'noBrainer') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading No Brainer Lab…" />}>
          <NoBrainerLabScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('singlePlayerHub')}
          />
        </Suspense>
      </div>,
    );
  }

  if (appMode === 'learn' && LEARN_MODE_VISIBLE) {
    if (selectedLearnLessonId) {
      return withAuthModals(
        <div className={appRootClassName}>
          <Suspense fallback={<ScreenLoader label="Loading Lesson…" />}>
            <LearnPlayer
              lessonId={selectedLearnLessonId}
              onExit={() => {
                setSelectedLearnLessonId(null);
              }}
            />
          </Suspense>
        </div>
      );
    }
    if (learnHowToPlayOpen && canOpenHowToPlayPreview) {
      return withAuthModals(
        <div className={appRootClassName}>
          <Suspense fallback={<ScreenLoader label="Loading Learn…" />}>
            <LearnHowToPlayRacehorse
              onBack={() => setLearnHowToPlayOpen(false)}
              onNavigate={setAppMode}
              onStartGuidedMatch={() => {
                setLearnHowToPlayOpen(false);
                const start = resolveGuidedMatchStart();
                if (!start.route) return;
                setIsGuidedMode(start.route === 'v1');
                setIsGuidedV2Mode(start.route === 'v2');
                setBotFritzTier('standard');
                setBotDealSize(7);
                setAppMode('bot');
              }}
            />
          </Suspense>
        </div>
      );
    }
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Learn Mode…" />}>
          <LearnHome
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
            isAdmin={isAdmin}
            showAdminView={Boolean(isAdmin && showLearnAdminView)}
            canOpenHowToPlay={canOpenHowToPlayPreview}
            onOpenHowToPlay={
              canOpenHowToPlayPreview ? () => setLearnHowToPlayOpen(true) : undefined
            }
            onStartGuidedGame={() => {
              setIsGuidedMode(true);
              setBotFritzTier('standard');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartGuidedAuthoring={() => {
              setIsAuthoringMode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onFreezeLesson={() => {
              const session = loadAuthoringSession();
              if (session) {
                saveFrozenLesson(session);
              }
            }}
            onStartGuidedV2Game={() => {
              const start = resolveGuidedMatchStart();
              if (!start.route) return;
              setIsGuidedMode(start.route === 'v1');
              setIsGuidedV2Mode(start.route === 'v2');
              setBotFritzTier('standard');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartAuthoringV2={() => {
              setIsAuthoringV2Mode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartGuidedMatchRecorder={() => {
              setAppMode('guidedMatchRecorder');
            }}
            onOpenGuidedMatchAnnotator={() => {
              setAppMode('guidedMatchAnnotator');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'guidedMatchAnnotator') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Guided Match Annotator…" />}>
          <GuidedMatchAnnotatorScreen
            onBack={() => setAppMode('learn')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'guidedMatchRecorder') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Guided Match Recorder…" />}>
          <GuidedMatchRecorderScreen
            onBack={() => setAppMode('learn')}
            onNavigate={setAppMode}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'botSetup') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Setup…" />}>
          <PlayVsFritz
            onStart={({ difficulty, dealSize }) => {
              setBotFritzTier(difficulty);
              setBotDealSize(dealSize);
              setAppMode('bot');
            }}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'bot') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Match…" />}>
          <BotMatchScreen
            onBack={() => {
              setIsGuidedMode(false);
              setIsAuthoringMode(false);
              setIsAuthoringV2Mode(false);
              setIsGuidedV2Mode(false);
              setAppMode('home');
            }}
            onNavigate={(mode) => {
              if (mode === 'learn') {
                setIsGuidedMode(false);
                setIsAuthoringMode(false);
                setIsAuthoringV2Mode(false);
                setIsGuidedV2Mode(false);
              }
              setAppMode(mode);
            }}
            dealSize={botDealSize}
            fritzTier={botFritzTier}
            isGuidedMode={isGuidedMode}
            isAuthoringMode={isAuthoringMode}
            isAuthoringV2Mode={isAuthoringV2Mode}
            isGuidedV2Mode={isGuidedV2Mode}
            enableGuidedMatchCandidateCapture={
              Boolean(isAdmin) &&
              !isGuidedMode &&
              !isAuthoringMode &&
              !isAuthoringV2Mode &&
              !isGuidedV2Mode &&
              botFritzTier === 'standard' &&
              botDealSize === 7
            }
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghostSetup') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Setup…" />}>
          <GhostSetupScreen
            userId={authUser?.id ?? null}
            fritzGamesPlayed={authProfile?.ranked_games_played ?? 0}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onStart={(summary, opponentName, opponentUserId) => {
              setGhostProfile(summary);
              setGhostOpponentName(opponentName);
              setGhostOpponentUserId(opponentUserId);
              setAppMode('ghost');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghost') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Match…" />}>
          <BotMatchScreen
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            dealSize={botDealSize}
            mode="ghost"
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            opponentName={ghostOpponentName}
            opponentUserId={ghostOpponentUserId}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'daily') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle…" />}>
          <DailyPuzzleScreen
            user={authUser}
            profile={authProfile}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'dailyFritz') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Fritz…" />}>
          <DailyFritzScreen
            user={authUser}
            profile={authProfile}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
          />

        </Suspense>
      </div>
    );
  }

  if (appMode === 'ratingHistory') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Rating History…" />}>
          <RatingHistoryPage
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'friends') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Friends…" />}>
          <FriendsScreen
            open={true}
            user={authUser}
            socket={socket}
            joinedRoom={joinedRoom}
            currentUsername={authProfile?.username ?? ''}
            showToast={showToast}
            onCopyInviteLink={copyInviteLink}
            onCreatePrivateRoom={onCreatePrivateRoom}
            onClose={() => setAppMode('home')}
            onViewProfile={(username) => { setProfileTarget(username); setAppMode('profile'); }}
          />
        </Suspense>
        {friendInvitePopup}
      </div>
    );
  }

  if (appMode === 'stats') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Stats…" />}>
          <StatsScreen
            open={true}
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'feed') {
    return withAuthModals(
      <div className={appRootClassName}>
        {toast && <div className="toast">{toast}</div>}
        <Suspense fallback={<ScreenLoader label="Loading Feed…" />}>
          <ActivityFeedScreen
            user={authUser}
            socket={socket}
            connect={connect}
            sendFriendChallenge={sendFriendChallenge}
            showToast={showToast}
            outboundChallenge={outboundChallenge}
            clearOutboundChallenge={clearOutboundChallenge}
            onViewProfile={(username) => { setProfileTarget(username); setAppMode('profile'); }}
            onClose={() => setAppMode('home')}
            onNavigateToFriends={() => setAppMode('friends')}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
          />
        </Suspense>
        {friendInvitePopup}
      </div>
    );
  }

  if (appMode === 'leaderboard') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Leaderboard…" />}>
          <DailyFritzLeaderboardRoute
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'profile') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Profile…" />}>
          <PublicProfileScreen
            username={profileTarget ?? ''}
            user={authUser}
            showToast={showToast}
            onClose={() => setAppMode('home')}
            onChallenge={() => setAppMode('multiplayer')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'singlePlayerHub') {
    return withAuthModals(
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Single Player…" />}>
          <SinglePlayerHubScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('home')}
            onNavigate={(mode) => setAppMode(mode as any)}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
          />
        </Suspense>
      </div>
    );
  }
  if (appMode === 'tournament') {
    const tIdentity = authUser?.id
      ? { userId: authUser.id, username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player' }
      : null;

    // Reference legacy screen so the import isn't flagged as unused.
    void TournamentScreen;

    if (tournamentSubView === 'bracket' && activeTournamentId) {
      return withAuthModals(
        <TournamentBracketScreen
          identity={tIdentity}
          tournamentId={activeTournamentId}
          bracket={tournament.activeBracket}
          tournamentPhase={tournament.tournamentPhase}
          assignedMatch={
            tournament.assignedMatch?.tournamentId === activeTournamentId
              ? tournament.assignedMatch
              : null
          }
          countdownAt={tournament.countdown?.at ?? null}
          countdownKind={tournament.countdown?.kind ?? null}
          onLoadBracket={(id) => { void tournament.openBracket(id); }}
          onBack={() => exitToTournamentHub('bracket_back')}
          onExitToHub={() => exitToTournamentHub('bracket_back')}
          onWithdraw={(id) => {
            void tournament.withdraw(id).then(() => exitToTournamentHub('withdraw'));
          }}
          onViewResult={() => {
            if (!activeTournamentId) return;
            setTournamentSubView('result');
            void tournament.openBracket(activeTournamentId);
          }}
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onOpenAccount={handleOpenAccountModal}
          onAttachAssignedMatch={attachAssignedTournamentMatch}
          attachJoinPhase={tournamentAttachPhase}
          attachJoinError={tournamentAttachError}
        />,
      );
    }

    if (tournamentSubView === 'result' && activeTournamentId) {
      const myUserId = authUser?.id ?? null;
      const yourPlacement =
        (myUserId
          ? tournamentResult?.placements.find((placement) => placement.userId === myUserId)?.placementLabel
          : null) ?? null;

      const nextSlot = tournament.upcoming[0];
      const nextCountdown = nextSlot
        ? (() => {
            const ms = Math.max(0, Date.parse(nextSlot.scheduled_start) - Date.now());
            const total = Math.floor(ms / 1000);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
          })()
        : '—';

      return withAuthModals(
        <TournamentResultScreen
          isLoading={tournamentResultLoading}
          error={tournamentResultError}
          championName={tournamentResult?.championName ?? null}
          yourPlacement={yourPlacement}
          nextTournamentCountdown={nextCountdown}
          onRetry={() => {
            if (activeTournamentId) {
              setTournamentResultLoading(true);
              void tournamentApi.fetchResult(activeTournamentId)
                .then((result) => {
                  setTournamentResult(result);
                  setTournamentResultError(null);
                })
                .catch((err) => {
                  setTournamentResultError(err instanceof Error ? err.message : 'Failed to load tournament result');
                })
                .finally(() => setTournamentResultLoading(false));
            }
          }}
          onNextTournament={() => {
            setTournamentSubView('hub');
            setActiveTournamentId(null);
            setTournamentResult(null);
          }}
        />,
      );
    }

    return withAuthModals(
      <TournamentHubScreen
        identity={tIdentity}
        upcoming={tournament.upcoming}
        registrations={tournament.registrations}
        recoveryMatch={tournament.recoveryMatch}
        tournamentPhase={tournament.tournamentPhase}
        error={tournament.error}
        isLoading={tournament.isLoading}
        hasLoaded={tournament.hasLoaded}
        activeBracketStatus={tournament.activeBracket?.tournament.status ?? null}
        activeTournamentId={tournament.activeTournamentId}
        onNavigate={setAppMode}
        onOpenAuth={handleOpenAuthModal}
        onOpenAccount={handleOpenAccountModal}
        onBackHome={() => setAppMode('home')}
        onOpenBracket={(id) => enterTournamentLobby(id)}
        onRegister={async (id) => {
          await tournament.register(id);
          enterTournamentLobby(id);
        }}
        onWithdraw={async (id) => {
          await tournament.withdraw(id);
          if (activeTournamentId === id) exitToTournamentHub('withdraw');
        }}
        onRetry={() => {
          void tournament.refresh();
        }}
        onAttachAssignedMatch={attachAssignedTournamentMatch}
        attachJoinPhase={tournamentAttachPhase}
        attachJoinError={tournamentAttachError}
      />,
    );
  }

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hasSeenWelcome', 'true');
    }
    setWelcomeOpen(false);
  };
  const welcomeModal =
    appMode === 'home' && welcomeOpen ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Racehorse Dominoes"
        onClick={dismissWelcome}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1600,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          padding: 12,
        }}
      >
        <div
          className="card welcome-modal-card"
          onClick={(e) => e.stopPropagation()}
          style={{ textAlign: 'left' }}
        >
          <h3 className="welcome-modal-title" style={{ margin: 0, lineHeight: 1.2 }}>
            How to Play
          </h3>
          <p className="welcome-modal-subtitle">
            Quick guide to each game mode.
          </p>
          <div className="welcome-mode-list">
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#38bdf8' }} aria-hidden="true" />
                Multiplayer Online
              </div>
              <div className="welcome-mode-desc">Play live 1v1 against a friend with a room code</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#e05c6a' }} aria-hidden="true" />
                Tournament Mode
              </div>
              <div className="welcome-mode-desc">Round robin (4+ players), matches to 30, play everyone once</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#f59e0b' }} aria-hidden="true" />
                Daily Puzzle
              </div>
              <div className="welcome-mode-desc">One puzzle per day, compete on the leaderboard</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#60a5fa' }} aria-hidden="true" />
                vs Bot
              </div>
              <div className="welcome-mode-desc">Practice against an AI opponent</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#a78bfa' }} aria-hidden="true" />
                No Brainer Lab
              </div>
              <div className="welcome-mode-desc">Practice clearing all 7 tiles in one turn</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#34d399' }} aria-hidden="true" />
                Stats &amp; Leaderboard
              </div>
              <div className="welcome-mode-desc">Track your wins, streaks, and weekly rank</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex' }}>
            <button
              className="mode-inline-btn welcome-cta"
              onClick={dismissWelcome}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (appMode === 'home') {
    return withAuthModals(
      <div ref={appRootRef} className={appRootClassName}>
        <div className="layout-screen screen lobby-screen mode-home-screen mode-accent-multiplayer home-lobby-screen claude-home-shell claude-home-screen-shell">
          <div className="layout-screen-bg" aria-hidden="true" />
          <div className="layout-screen-beam" aria-hidden="true" />
          <div className="layout-screen-vignette" aria-hidden="true" />
          <div className="layout-screen-inner home-lobby-shell">
            <div className="claude-accordion-home">
              <div className="claude-accordion-home__topbar">
                <div className="claude-accordion-home__brand">RACEHORSE</div>
                <div className="claude-accordion-home__utilities">
                  {authUser ? (
                    <button className="claude-accordion-home__utility" onClick={() => setUsernameModalOpen(true)}>
                      {myHandle} · {homeRatingLabel}
                    </button>
                  ) : (
                    <button className="claude-accordion-home__utility" onClick={() => setAuthModalOpen(true)}>
                      Sign In · Profile
                    </button>
                  )}
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('friends')}>
                    Friends
                  </button>
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('stats')}>
                    Stats
                  </button>
                </div>
              </div>
              <div className="claude-accordion-home__body">
                {[
                  { id: 'multiplayer', short: 'MULTI', label: 'Multiplayer Online', desc: 'Create a private room and play head to head in real time', accent: '#38bdf8', live: true, action: () => setAppMode('multiplayer') },
                  { id: 'singlePlayerHub', short: 'SOLO', label: 'Single Player Modes', desc: 'Play vs Fritz, Ghost Mode & No Brainer Lab', accent: '#a78bfa', action: () => setAppMode('singlePlayerHub') },
                  { id: 'dailyFritz', short: 'FRITZ', label: 'Daily Fritz Set', desc: 'One fixed best of 3 Fritz set per day. Same deals for everyone.', accent: '#e05c6a', action: () => setAppMode('dailyFritz') },
                  { id: 'daily', short: 'PUZZLE', label: 'Daily Puzzle', desc: 'Solve today’s featured scenario and compare leaderboard results', accent: '#f0c040', action: () => setAppMode('daily') },
                  { id: 'tournament', short: 'TOURN', label: 'Tournament Mode', desc: 'Round robin (4+ players), matches to 30, play everyone once', accent: '#fb923c', action: () => { setError(''); setAppMode('tournament'); } },
                  { id: 'learn', short: 'LEARN', label: 'Learn Academy', desc: 'New to dominoes? Learn how to play and win.', accent: '#34d399', action: () => setAppMode('learn') },
                ].map((mode, index, all) => {
                  const isActive = activeHomeMode === mode.id;
                  const hasActive = activeHomeMode !== null;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`claude-accordion-home__panel${isActive ? ' is-active' : ''}${hasActive ? ' has-active' : ''}`}
                      style={{ ['--panel-accent' as string]: mode.accent, ['--panel-accent-rgb' as string]: claudeRgb(mode.accent), borderRight: index < all.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                      onMouseEnter={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onFocus={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onClick={mode.action}
                    >
                      <div className="claude-accordion-home__panel-atmo" />
                      <div className="claude-accordion-home__big-number">{index + 1}</div>
                      {mode.live ? <div className="claude-accordion-home__live">LIVE</div> : null}
                      <div className="claude-accordion-home__panel-content">
                        <div className="claude-accordion-home__mode-number">MODE {String(index + 1).padStart(2, '0')}</div>
                        <div className="claude-accordion-home__mode-title">{mode.label}</div>
                        <div className="claude-accordion-home__mode-desc">{mode.desc}</div>
                        <div className="claude-accordion-home__enter">Enter</div>
                      </div>
                      <div className="claude-accordion-home__collapsed">
                        <div className="claude-accordion-home__collapsed-label">{mode.short}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!supabaseEnabled && (
              <p className="lobby-server mode-subtitle" style={{ marginTop: 12 }}>
                {supabaseConfigError ?? 'Supabase not configured.'}
              </p>
            )}
          </div>
        </div>
        {welcomeModal}
        <WeeklyStatsScreen
          open={weeklyStatsOpen}
          onClose={() => setWeeklyStatsOpen(false)}
          user={authUser}
        />
        {friendInvitePopup}
</div>,
    );
  }

  return withAuthModals(
    <div ref={appRootRef} className={appRootClassName}>
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
      {friendInvitePopup}

      {/* Error Banner */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && state && !state.handOver && !state.gameOver && (
        <div className="error-banner">
          {actionError}
          <button onClick={() => setActionError('')}>×</button>
        </div>
      )}

      {(!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && joinedRoom && !state) ? (
        mpSubView === 'quick' && !joinedRoom ? (
          <MatchmakingScreen
            socket={socket}
            isConnected={isConnected}
            isConnecting={isConnecting}
            serverUrl={serverUrl}
            onRetryConnect={connect}
            identity={
              authUser?.id
                ? {
                    userId: authUser.id,
                    username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player',
                  }
                : null
            }
            myRating={
              authProfile?.glicko_rating != null
                ? Math.round(Number(authProfile.glicko_rating))
                : null
            }
            myWinStreak={privateLobbyHostWinStreak}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onOpenAccount={handleOpenAccountModal}
            onBackHome={() => setAppMode('home')}
            onOpenPrivateMatch={() => setMpSubView('private')}
            onAutoJoinRoom={handleMatchmakingAutoJoin}
          />
        ) : mpSubView === 'quick' && joinedRoom && !state ? (
          <div
            className="mp-quick-starting"
            style={{
              flex: '1 1 0',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary, rgba(255,255,255,0.72))',
              fontSize: '1.05rem',
              letterSpacing: '0.04em',
            }}
          >
            Starting match…
          </div>
        ) : (
          <PrivateMatchLobbyScreen
            phase={
              !isConnected && !isRecoveringConnection
                ? 'disconnected'
                : isConnected && !joinedRoom
                  ? 'lobby'
                  : 'room'
            }
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onBackHome={() => {
              setMpSubView('quick');
              setAppMode('home');
            }}
            isConnecting={isConnecting}
            serverWaking={serverWaking}
            serverUrl={serverUrl}
            onConnect={connect}
            roomCode={roomCode}
            onRoomCodeChange={setRoomCode}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            pendingLobbyAction={
              pendingUiAction === 'create' || pendingUiAction === 'join' ? pendingUiAction : null
            }
            joinedRoom={joinedRoom ?? ''}
            players={players}
            you={you}
            isRoomHost={isRoomHost}
            onLeaveRoom={leavePrivateLobbyRoom}
            onStartGame={startGame}
            pendingStart={pendingUiAction === 'start'}
            onCopyInviteLink={copyInviteLink}
            onCopyRoomCode={copyRoomCodeToClipboard}
            myRating={
              authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null
            }
            myUsername={authProfile?.username ?? null}
            roomChatFeed={roomReactions}
            onSendRoomChat={sendRoomChat}
            winTarget={60}
            roomRecoveryState={roomRecoveryState}
            roomRecoveryMessage={roomRecoveryMessage}
            onRetryRoomRecovery={retryRoomRecovery}
            hostWinStreak={privateLobbyHostWinStreak}
            onOpenQuickMatch={() => setMpSubView('quick')}
            socket={socket}
            pendingChallenge={
              outboundChallenge && players.length < 2
                ? {
                    friendUsername: outboundChallenge.friendUsername,
                    matchSummary: outboundChallenge.matchSummary,
                    expiresAt: outboundChallenge.expiresAt,
                  }
                : null
            }
          />
        )
      ) : null}

      <LiveMatchScreen
        visible={Boolean((isConnected || isRecoveringConnection) && joinedRoom && state)}
        state={state}
        you={you}
        opponentId={opponentId}
        opponentName={opponentName}
        myName={myName}
        myScore={myScore}
        opponentScore={opponentScore}
        opponentTileCount={opponentTileCount}
        isMyTurn={isMyTurn}
        isHandActive={isHandActive}
        hudScorePulse={hudScorePulse}
        hudRightLabel={hudRightLabel}
        hudRightScore={hudRightScore}
        hudRightScorePulse={hudRightScorePulse}
        opponentPillRef={opponentPillRef}
        boneyardRef={boneyardRef}
        boneyardCount={boneyardCount}
        openEndsSum={openEndsSum}
        boardRef={boardRef}
        handAreaRef={handAreaRef}
        trayCenterRef={trayCenterRef}
        confettiCanvasRef={confettiCanvasRef}
        boardForDisplay={boardForDisplay}
        boardLegalMoves={boardLegalMoves}
        boardSelectedTile={boardSelectedTile}
        lastPlayedTile={lastPlayedTile}
        boardShowOpenEndGlow={boardShowOpenEndGlow}
        onPositionClick={play}
        myHand={myHand}
        handSelectedTile={handSelectedTile}
        onHandTileSelect={handleTileTap}
        legalMoves={legalMoves}
        handTileSize={handTileSize}
        handCompactStacked={handCompactStacked}
        drawPulseIndex={drawPulseIndex}
        scoreToast={scoreToast}
        scoreTrackOpen={scoreTrackOpen}
        onScoreTrackOpenChange={setScoreTrackOpen}
        roomReactions={roomReactions}
        onSendRoomChat={sendRoomChat}
        onSendRoomEmote={sendRoomEmote}
        isMuted={isMuted}
        onToggleMute={() => setIsMuted((prev) => !prev)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        opponentDisconnected={opponentDisconnected}
        opponentDisconnectMessage={opponentDisconnectMessage}
        roomRecoveryState={roomRecoveryState}
        roomRecoveryMessage={roomRecoveryMessage}
        onRetryRoomRecovery={retryRoomRecovery}
        winTarget={state?.config?.winningScore ?? 60}
        tournamentMatch={tournamentMatch}
        consumedTournamentGameOverMatchIdsRef={consumedTournamentGameOverMatchIdsRef}
        tournamentMyLabel={tournamentMyLabel}
        tournamentOpponentLabel={tournamentOpponentLabel}
        onTournamentViewBracket={() => navigateAfterTournamentMatch('bracket')}
        onTournamentViewFinalResult={() => navigateAfterTournamentMatch('result')}
        onTournamentReturnToHub={() => navigateAfterTournamentMatch('hub')}
        canUseRematch={canUseRematch}
        rematchRequested={rematchRequested}
        rematchWaitingText={rematchWaitingText}
        onRematch={requestRematch}
        onPostGame={handlePostGame}
        players={players}
        multiplayerRatingSummary={multiplayerRatingSummary}
        onOpenMultiplayerAnalyzer={openMultiplayerAnalyzer}
        handReveal={handReveal}
        handRevealAutoProgress={handRevealAutoProgress}
        flyingTiles={flyingTiles}
        showLeaveConfirm={showLeaveConfirm}
        onRequestLeaveConfirm={() => setShowLeaveConfirm(true)}
        onLeaveConfirmDismiss={() => setShowLeaveConfirm(false)}
        leaveModalIsTournament={Boolean(currentTournamentContext)}
        onConfirmLeaveMatch={() => {
          setShowLeaveConfirm(false);
          void abandonCurrentMatch();
        }}
        abandonedMatchNotice={abandonedMatchNotice}
        onAbandonedPrimary={() => {
          if (abandonedMatchNotice?.context === 'tournament' && abandonedMatchNotice.tournamentId) {
            setActiveTournamentId(abandonedMatchNotice.tournamentId);
            setTournamentSubView('bracket');
            setAppMode('tournament');
          } else {
            setAppMode('multiplayer');
          }
          setAbandonedMatchNotice(null);
        }}
        onAbandonedSecondary={() => {
          if (abandonedMatchNotice?.context === 'tournament') {
            setTournamentSubView('hub');
            setAppMode('tournament');
          } else {
            setAppMode('home');
          }
          setAbandonedMatchNotice(null);
        }}
        onAbandonedDismiss={() => setAbandonedMatchNotice(null)}
      />

      {overlayPayload && (
        <MatchFoundOverlay
          payload={overlayPayload}
          yourUsername={authProfile?.username ?? 'Guest'}
          onComplete={() => {
            setOverlayPayload(null);
          }}
        />
      )}
    </div>,
  );
}
