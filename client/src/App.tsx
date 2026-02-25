import { useMemo, useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from './components/RoomReactions';
import { traceSocketEvent } from "./debug/socketTrace";
import { io, Socket } from 'socket.io-client';
import './App.css';
import { Board, DominoTile, ScoreTrackOverlay } from './components';
import { playTileSound } from './utils/sound';
import NoBrainerLabScreen from './practice/NoBrainerLabScreen';
import BotMatchScreen from './bot/BotMatchScreen';
import DailyPuzzleScreen from './dailyPuzzle/DailyPuzzleScreen';
import DailyPuzzleAdminScreen from './dailyPuzzle/DailyPuzzleAdminScreen';
import GameOverModal from './components/GameOverModal';
import GameReviewer from './analyzer/GameReviewer';
import AuthModal from './auth/AuthModal';
import UsernameModal from './auth/UsernameModal';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import StatsScreen from './stats/StatsScreen';
import FriendsScreen from './friends/FriendsScreen';
import { analyzeMoveLog, saveGameAnalysis, type GameAnalysis } from './analyzer/moveAnalyzer';
import {
  type MoveEntry,
  pickEngineBestMove,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from './analyzer/moveLogger';
import { recordMatchResult } from './stats/statsApi';
import type { Tile, PlacementPosition, GameState, Move, StateUpdate } from './types';

function emitWithAck<TResp>(
  socket: { emit: (...args: any[]) => void },
  event: string,
  ...argsWithoutAck: any[]
): Promise<TResp> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${event} timed out after 8000ms`)),
      8000,
    );
    socket.emit(event, ...argsWithoutAck, (resp: TResp) => {
      window.clearTimeout(t);
      resolve(resp);
    });
  });
}

// ─── Utilities ───────────────────────────────────────────────
type RoomPlayer = { id: string; username: string; userId: string | null };

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
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

const LAST_ROOM_STORAGE_KEY = 'racehorse_last_room_code';

function getBoardEnds(board: GameState['board']): [number, number] {
  if (!board) return [-1, -1];
  return [board.leftEnd, board.rightEnd];
}

function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  let count = board.mainLine.length;
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      if (arm) count += arm.tiles.length;
    }
  }
  return count;
}

function FullscreenIcon({ isFullscreen }: { isFullscreen: boolean }) {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {isFullscreen ? (
        <>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </>
      ) : (
        <>
          <path d="M9 4H4v5" />
          <path d="M15 4h5v5" />
          <path d="M9 20H4v-5" />
          <path d="M15 20h5v-5" />
        </>
      )}
    </svg>
  );
}

function VolumeIcon({ isMuted }: { isMuted: boolean }) {
  return (
    <svg className="icon-svg volume-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10h4l5-4v12l-5-4H4z" />
      {!isMuted && (
        <>
          <path d="M16 9a4 4 0 010 6" />
          <path d="M18 7a7 7 0 010 10" />
        </>
      )}
      {isMuted && <path className="icon-slash" d="M5 5l14 14" />}
    </svg>
  );
}

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
  tileSize: number;
  compactStacked: boolean;
  drawPulseIndex: number | null;
}

function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  compactStacked,
  drawPulseIndex,
}: HandViewProps) {
  const playableTiles = useMemo(() => {
    return legalMoves.filter((m) => m.type === 'play' && m.tile).map((m) => m.tile!);
  }, [legalMoves]);

  const canPlayTile = (tile: Tile) => {
    return playableTiles.some((t) => tileEquals(t, tile));
  };

  const renderTile = (tile: Tile, idx: number) => {
    const isSel = selectedTile && tileEquals(tile, selectedTile);
    const canPlay = isMyTurn && canPlayTile(tile);
    return (
      <DominoTile
        key={`${idx}-${tile.low}-${tile.high}`}
        tile={tile}
        size={tileSize}
        selected={isSel ?? false}
        highlight={canPlay}
        onClick={() => isMyTurn && onSelect(tile)}
        disabled={!isMyTurn}
        className={drawPulseIndex === idx ? 'new-draw' : ''}
      />
    );
  };

  if (compactStacked) {
    const splitAt = Math.ceil(hand.length / 2);
    const firstRow = hand.slice(0, splitAt);
    const secondRow = hand.slice(splitAt);
    return (
      <div className="hand-container is-stacked">
        <div className="hand-row">{firstRow.map((tile, idx) => renderTile(tile, idx))}</div>
        <div className="hand-row">{secondRow.map((tile, idx) => renderTile(tile, splitAt + idx))}</div>
      </div>
    );
  }

  return <div className="hand-container">{hand.map((tile, idx) => renderTile(tile, idx))}</div>;
}

// ─── Game Over Overlay ───────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onPrimary: () => void;
  primaryLabel: string;
  onExit: () => void;
  secondaryLabel: string;
  waitingText?: string;
  players: RoomPlayer[];
  extraActionLabel?: string;
  onExtraAction?: () => void;
}

interface HandEndedPayload {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
}

const HAND_OVER_REVEAL_MS = 5000;

function GameOverOverlay({
  state,
  myId,
  onPrimary,
  primaryLabel,
  onExit,
  secondaryLabel,
  waitingText,
  players,
  extraActionLabel,
  onExtraAction,
}: GameOverOverlayProps) {
  const winner = state.winnerId;
  const iWon = winner === myId;
  const getName = (pid: string, idx: number) => {
    const p = players.find((pl) => pl.id === pid);
    if (p?.username) return `@${p.username}`;
    return pid === myId ? 'You' : `Player ${idx + 1}`;
  };
  const winnerIdx = winner ? state.playerIds.indexOf(winner) : -1;
  const victoryTitle = winner
    ? `${getName(winner, winnerIdx >= 0 ? winnerIdx : 0)} wins!`
    : iWon
      ? 'You Win!'
      : 'You Lose';

  return (
    <GameOverModal
      open
      ariaLabel="Game over"
      title={victoryTitle}
      subtitle="Final score"
      scores={state.playerIds.map((pid, idx) => ({
        label: getName(pid, idx),
        value: state.players[pid]?.score ?? 0,
        winner: pid === winner,
        showCrown: pid === winner,
      }))}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onExit}
      extraActionLabel={extraActionLabel}
      onExtraAction={onExtraAction}
      onClose={onExit}
    >
      {waitingText && (
        <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', fontSize: '0.92rem' }}>{waitingText}</p>
      )}
    </GameOverModal>
  );
}


function WeeklyStatsScreen({
  open,
  onClose,
  awards,
}: {
  open: boolean;
  onClose: () => void;
  awards: any | null;
}) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const rangeFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const weekRange = `${rangeFmt.format(monday)} – ${rangeFmt.format(sunday)}`;

  const items = Array.isArray(awards?.awards) ? awards.awards : [];
  const hasRows = items.length > 0;
  const iconFor = (key: string, title: string): string => {
    const s = `${key} ${title}`.toLowerCase();
    if (s.includes('most wins')) return '🥇';
    if (s.includes('most games')) return '🎮';
    if (s.includes('biggest win')) return '💥';
    if (s.includes('closest win')) return '🎯';
    if (s.includes('biggest comeback')) return '🔥';
    if (s.includes('longest win streak')) return '⚡';
    return '🥇';
  };
  const unitFor = (key: string, title: string): string => {
    const s = `${key} ${title}`.toLowerCase();
    if (s.includes('most wins')) return 'wins';
    if (s.includes('most games')) return 'games';
    if (s.includes('streak')) return 'wins';
    if (s.includes('margin') || s.includes('closest') || s.includes('comeback')) return 'pts';
    return '';
  };

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
          width: 'min(720px, calc(100vw - 24px))',
          borderRadius: '16px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true">🏆</span>
              <span>Weekly Leaderboard</span>
            </h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
              Week of {weekRange}
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {hasRows ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map((a: any) => (
              <div
                key={a.key}
                style={{
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  borderLeft: '3px solid rgba(245, 158, 11, 0.6)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ fontSize: '1rem' }}>
                    {iconFor(String(a.key ?? ''), String(a.title ?? ''))}
                  </span>
                  <span style={{ fontSize: '0.92rem', color: 'rgba(191,213,223,0.92)' }}>{a.title}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 0,
                    justifyContent: 'flex-end',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '1.02rem',
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                      color: 'rgba(245,252,248,0.96)',
                    }}
                  >
                    {a.leader?.username ?? '—'}
                  </strong>
                  {a.leader ? (
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        borderRadius: 999,
                        padding: '4px 8px',
                        background: 'rgba(245, 158, 11, 0.16)',
                        border: '1px solid rgba(245, 158, 11, 0.36)',
                        color: 'rgba(255, 226, 172, 0.96)',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        letterSpacing: '0.01em',
                      }}
                    >
                      {a.leader.value} {unitFor(String(a.key ?? ''), String(a.title ?? ''))}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
            No games played this week yet. Be the first!
          </p>
        )}
      </div>
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────

export default function App() {
  const appRootRef = useRef<HTMLDivElement>(null);
  const trayCenterRef = useRef<HTMLDivElement>(null);
  const autoConnectAttemptedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const pendingCreateOnConnectRef = useRef(false);
  const pendingCreateResolversRef = useRef<Array<(code: string | null) => void>>([]);
  const [serverUrl] = useState(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [appMode, setAppMode] = useState<
    'home' | 'multiplayer' | 'noBrainer' | 'bot' | 'daily' | 'dailyAdmin' | 'tournament'
  >('home');
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [uiTheme, setUiTheme] = useState<'green' | 'brown'>(() => {
    if (typeof window === 'undefined') return 'green';
    const stored = window.localStorage.getItem('racehorse_ui_theme');
    return stored === 'brown' ? 'brown' : 'green';
  });

  const [roomCode, setRoomCode] = useState('');
  const [tournamentCode, setTournamentCode] = useState('');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<any>(null);
  const [tournamentActiveRoom, setTournamentActiveRoom] = useState<string | null>(null);
  const [roomReactions, setRoomReactions] = useState<Array<RoomChatEvent | RoomEmoteEvent>>([]);
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
  const [state, setState] = useState<GameState | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [canDraw, setCanDraw] = useState(false);
  const [error, setError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [handReveal, setHandReveal] = useState<HandEndedPayload | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchReadyIds, setRematchReadyIds] = useState<string[]>([]);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [multiplayerMoveLog, setMultiplayerMoveLog] = useState<MoveEntry[]>([]);
  const multiplayerMoveCounterRef = useRef(1);
  const previousStateForAnalysisRef = useRef<GameState | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [pendingUiAction, setPendingUiAction] = useState<
    null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'
  >(null);
  const {
    user: authUser,
    profile: authProfile,
    loading: authLoading,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    signOut,
    updateUsername,
  } = useAuth();
  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);
  const [weeklyAwards, setWeeklyAwards] = useState<any | null>(null);
  const [friendInvite, setFriendInvite] = useState<{
    fromUsername: string;
    roomCode: string;
    inviteUrl: string;
  } | null>(null);

  const loadWeeklyAwards = useCallback(() => {
    if (!socket || !socket.connected) return;
    socket.emit("stats:weekly", (resp: any) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const joinedRoomRef = useRef<string | null>(null);
  const stateRef = useRef<GameState | null>(state);
  const reconnectRoomCodeRef = useRef<string | null>(null);
  const reconnectShouldJoinRef = useRef(false);
  const preventAutoRejoinRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  const inviteJoinInFlightRef = useRef(false);
  const rejoinInFlightRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(44);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const autoTurnActionKeyRef = useRef<string>('');
  const handRevealShownRef = useRef<number | null>(null);
  const prevOppCountRef = useRef<number | null>(null);
  const [oppTilePulse, setOppTilePulse] = useState(false);
  const prevBoardTileCountRef = useRef(0);
  const prevTurnIdRef = useRef<string | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);
  const [opponentDragging, setOpponentDragging] = useState(false);
  const draggingStateRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  const matchRecordKeyRef = useRef('');
  const prevGameOverRef = useRef(false);
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const isAdmin = Boolean(
    authUser?.email && adminEmail && authUser.email.toLowerCase() === adminEmail.toLowerCase(),
  );
  const needsUsernameOnboarding = Boolean(
    authUser && !authLoading && authProfile !== null && isTemporaryUsername(authProfile.username),
  );
  const onboardingDismissed = Boolean(
    typeof window !== 'undefined' && window.localStorage.getItem('username_onboarding_dismissed'),
  );

  const showToast = useCallback((msg: string, duration = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(''), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSeen = window.localStorage.getItem('hasSeenWelcome');
    if (!hasSeen) setWelcomeOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_ui_theme', uiTheme);
  }, [uiTheme]);

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
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!socket || !authUser?.id) return;

    const username = authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player';

    const emitIdentify = () => {
      console.log('[presence] emitting presence:identify', { userId: authUser.id, connected: socket.connected });
      socket.emit('presence:identify', { userId: authUser.id, username }, () => {
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
  }, [socket, authUser?.id, authProfile?.username, authUser?.email]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (typeof window === 'undefined') return;
    if (joinedRoom) {
      window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, joinedRoom);
    }
  }, [joinedRoom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (inviteJoinInFlightRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkedRoom = normalizeRoomCode(params.get('room'));
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

  const emitCreateRoom = useCallback(
    async (targetSocket: Socket) => {
      setError('');
      setActionError('');
      try {
        const resp = await emitWithAck<any>(
          targetSocket,
          'room:create',
          {
            username: authProfile?.username ?? 'Guest',
            userId: authUser?.id ?? null,
          },
        );
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }
        setError('');
        setActionError('');
        setState(null);
        setLegalMoves([]);
        setCanDraw(false);
        setSelectedTile(null);
        setJoinedRoom(resp.roomCode);
        setRoomCode(resp.roomCode);
        setPlayers(normalizeRoomPlayers(resp.players));
        autoJoinAttemptedRef.current = false;
        preventAutoRejoinRef.current = false;
        resolvePendingCreate(resp.roomCode);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, authUser?.id, resolvePendingCreate],
  );

  useEffect(() => {
    if (!socket) return;
    const onFriendInvited = (payload: {
      fromUsername: string;
      roomCode: string;
      inviteUrl: string;
    }) => {
      console.log('[invite] received friend:invited', payload);
      setFriendInvite(payload);
    };
    const onFriendInviteError = (payload: { ok?: boolean; error?: string }) => {
      console.log('[invite] received friend:invite:error', payload);
      showToast('Invite failed: room not found', 2000);
    };
    const onRoomUpdate = (payload: { players?: unknown }) => {
      const nextPlayers = normalizeRoomPlayers(payload?.players);
      if (import.meta.env.DEV) {
        console.log('[room:update]', {
          joinedRoom: joinedRoomRef.current,
          players: nextPlayers.length,
        });
      }
      // Keep players synced from server push; do not infer or set room code here.
      setPlayers(nextPlayers);
    };
    const onStateUpdate = (payload: {
      state?: GameState | null;
      legalMoves?: Move[];
      canDraw?: boolean;
    }) => {
      if (import.meta.env.DEV) {
        console.log('[state:update]', {
          joinedRoom: joinedRoomRef.current,
          hasState: Boolean(payload?.state),
        });
      }
      setState(payload?.state ?? null);
      setLegalMoves(Array.isArray(payload?.legalMoves) ? payload.legalMoves : []);
      setCanDraw(Boolean(payload?.canDraw));
    };
    socket.on('friend:invited', onFriendInvited);
    socket.on('friend:invite:error', onFriendInviteError);
    socket.on('room:update', onRoomUpdate);
    socket.on('state:update', onStateUpdate);
    return () => {
      socket.off('friend:invited', onFriendInvited);
      socket.off('friend:invite:error', onFriendInviteError);
      socket.off('room:update', onRoomUpdate);
      socket.off('state:update', onStateUpdate);
    };
  }, [socket, showToast]);

  useEffect(() => {
    if (!friendInvite) return;
    const timer = setTimeout(() => setFriendInvite(null), 30000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

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

  // Connection
  const connect = useCallback(() => {
    if (isConnecting || socket?.connected) return;
    intentionalDisconnectRef.current = false;
    setError('');
    setIsConnecting(true);
    const s = io(serverUrl, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: false,
      reconnectionAttempts: 0,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });
    s.onAny((event, ...args) => traceSocketEvent(String(event), args.length <= 1 ? args[0] : args));
    const isDevSocketLogging = import.meta.env.DEV;
    if (isDevSocketLogging) {
      s.on('connect', () => console.log('[socket] connect', s.id));
      s.on('disconnect', (r) => console.log('[socket] disconnect', r));
      s.on('connect_error', (e) => console.log('[socket] connect_error', e?.message));
    }

    s.on('connect', async () => {
      if (intentionalDisconnectRef.current) return;
      setIsConnected(true);
      setYou(s.id ?? '');
      setIsConnecting(false);
      setServerWaking(false);
      const userId = authUserRef.current?.id;
      const username =
        authProfileRef.current?.username ?? authUserRef.current?.email?.split('@')[0] ?? 'player';
      if (userId) {
        if (import.meta.env.DEV) {
          console.log('[presence] socket connect: emitting identify', userId);
        }
        try {
          await emitWithAck<any>(s, 'presence:identify', { userId, username });
        } catch (e) {
          if (import.meta.env.DEV) {
            console.log('[presence] identify failed', e instanceof Error ? e.message : e);
          }
        }
      }
      if (pendingCreateOnConnectRef.current) {
        pendingCreateOnConnectRef.current = false;
        void emitCreateRoom(s).catch((e) => {
          const message = e instanceof Error ? e.message : 'Action failed';
          setError(message);
          showToast(message, 2000);
        });
        return;
      }

      if (!preventAutoRejoinRef.current) {
        const code = normalizeRoomCode(joinedRoomRef.current ?? roomCode);
        if (code && !rejoinInFlightRef.current) {
          rejoinInFlightRef.current = true;
          try {
            const resp = await emitWithAck<any>(
              s,
              'room:join',
              code,
              {
                username: authProfileRef.current?.username ?? 'Guest',
                userId: authUserRef.current?.id ?? null,
              },
            );
            if (resp?.ok) {
              setJoinedRoom(resp.roomCode);
              setRoomCode(resp.roomCode);
              setPlayers(normalizeRoomPlayers(resp.players));
              setState(resp.state ?? null);
              setSelectedTile(null);
              setLegalMoves([]);
              setCanDraw(false);
              reconnectShouldJoinRef.current = false;
              reconnectRoomCodeRef.current = resp.roomCode;
              return;
            }
            if (import.meta.env.DEV) {
              console.log('[rejoin] room:join not ok', { code, resp });
            }
          } catch (e) {
            if (import.meta.env.DEV) {
              console.log('[rejoin] room:join failed', e instanceof Error ? e.message : e);
            }
          } finally {
            rejoinInFlightRef.current = false;
          }
        }
      }

      if (inviteJoinInFlightRef.current) return;
      const reconnectCode = normalizeRoomCode(
        reconnectRoomCodeRef.current ?? joinedRoomRef.current ?? '',
      );
      if (reconnectShouldJoinRef.current && reconnectCode && !preventAutoRejoinRef.current) {
        try {
          const resp = await emitWithAck<any>(
            s,
            'room:join',
            reconnectCode,
            {
              username: authProfileRef.current?.username ?? 'Guest',
              userId: authUserRef.current?.id ?? null,
            },
          );
          if (!resp?.ok) return;
          setJoinedRoom(resp.roomCode);
          setRoomCode(resp.roomCode);
          setState(resp.state ?? null);
          setPlayers(normalizeRoomPlayers(resp.players));
          setSelectedTile(null);
          setLegalMoves([]);
          setCanDraw(false);
          setAppMode('multiplayer');
          reconnectShouldJoinRef.current = false;
          reconnectRoomCodeRef.current = resp.roomCode;
          showToast('Reconnected to room.', 1200);
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Action failed', 2000);
        }
        return;
      }
      if (preventAutoRejoinRef.current || autoJoinAttemptedRef.current) return;
      const savedCode = normalizeRoomCode(
        (typeof window !== 'undefined' && window.localStorage.getItem(LAST_ROOM_STORAGE_KEY)) || '',
      );
      if (!savedCode || joinedRoomRef.current) return;
      autoJoinAttemptedRef.current = true;
      (async () => {
        try {
          const resp = await emitWithAck<any>(
            s,
            'room:join',
            savedCode,
            {
              username: authProfile?.username ?? 'Guest',
              userId: authUser?.id ?? null,
            },
          );
          if (!resp?.ok) return;
          setJoinedRoom(resp.roomCode);
          setRoomCode(resp.roomCode);
          setState(resp.state ?? null);
          setPlayers(normalizeRoomPlayers(resp.players));
          setSelectedTile(null);
          setLegalMoves([]);
          setCanDraw(false);
          showToast('Rejoined room.', 1200);
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Action failed', 2000);
        }
      })();
    });

    s.on('disconnect', (_reason) => {
      const roomBeforeDisconnect = joinedRoomRef.current;
      const stateBeforeDisconnect = stateRef.current;
      if (
        roomBeforeDisconnect &&
        stateBeforeDisconnect &&
        !stateBeforeDisconnect.gameOver &&
        !preventAutoRejoinRef.current
      ) {
        reconnectRoomCodeRef.current = roomBeforeDisconnect;
        reconnectShouldJoinRef.current = true;
      }
      setIsConnected(false);
      setIsConnecting(false);
      setJoinedRoom(null);
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setError('');
      setActionError('');
      setRematchRequested(false);
      setRematchReadyIds([]);
      setOpponentDragging(false);
      draggingStateRef.current = false;
    });

    s.on('state:update', (update: StateUpdate) => {
      setState(update.state);
      setLegalMoves(update.legalMoves);
      setCanDraw(update.canDraw);
      setSelectedTile(null);
      setActionError('');
      const nextBoardCount = getBoardTileCount(update.state.board);
      if (prevBoardTileCountRef.current > 0 && nextBoardCount > prevBoardTileCountRef.current) {
        playTileSound(
          nextBoardCount - prevBoardTileCountRef.current > 1 ? 'slam' : 'standard',
          isMutedRef.current,
        );
      }
      prevBoardTileCountRef.current = nextBoardCount;
      if (!update.state.gameOver) {
        setRematchRequested(false);
        setRematchReadyIds([]);
      }
      if (update.state.handOver && !update.state.gameOver) {
        showToast('Hand over', 1200);
      }
      if (update.state.gameOver) {
        showToast(update.state.winnerId === s.id ? 'You win!' : 'Game over!');
      }
    });

    s.on('room:update', (data: { players: RoomPlayer[] }) => {
      setPlayers(normalizeRoomPlayers(data?.players));
    });
    // TOURNAMENT_LISTENERS
    s.on('tournament:lobby:update', (data: any) => {
      const lobbyCode = typeof data?.lobbyCode === 'string' ? data.lobbyCode : null;

      const players = Array.isArray(data?.players) ? data.players : null;
      if (players) {
        const inferredHostSocketId =
          typeof data?.hostSocketId === 'string'
            ? data.hostSocketId
            : typeof players?.[0]?.socketId === 'string'
              ? players[0].socketId
              : null;

        setTournamentState((prev: any) => ({
          ...(prev ?? {}),
          status: 'lobby',
          lobbyCode: lobbyCode ?? (prev?.lobbyCode ?? null),
          players,
          hostSocketId: inferredHostSocketId ?? prev?.hostSocketId ?? null,
        }));
      }
    });
    s.on('tournament:state', (data: any) => {
      setTournamentState(data);
      if (typeof data?.id === 'string') setTournamentId(data.id);
      setTournamentActiveRoom(typeof data?.activeRoomCode === 'string' ? data.activeRoomCode : null);
    });
    s.on('tournament:match:assigned', (data: any) => {
      if (typeof data?.roomCode === 'string') setTournamentActiveRoom(data.roomCode);
      // Auto-pull players into their match
      if (data?.roomCode && (data?.a === s.id || data?.b === s.id)) {
        const code = String(data.roomCode).trim().toUpperCase();
        setJoinedRoom(code);
        setRoomCode(code);
        setAppMode('multiplayer');
      }
    });
    // ROOM_REACTIONS_LISTENERS
    s.on('room:chat', (msg: RoomChatEvent) => {
      setRoomReactions((prev) => {
        const next = prev.concat(msg);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
    });

    s.on('room:emote', (evt: RoomEmoteEvent) => {
      setRoomReactions((prev) => {
        const next = prev.concat(evt);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
    });

    s.on('hand:ended', (payload: HandEndedPayload) => {
      setHandReveal(payload);
      handRevealShownRef.current = payload.handNumber;
    });

    s.on('game:rematch:status', (payload: any) => {
      const readyPlayerIds = Array.isArray(payload?.readyPlayerIds)
        ? payload.readyPlayerIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      setRematchReadyIds(readyPlayerIds);
      setRematchRequested(readyPlayerIds.includes(s.id ?? ''));
    });

    s.on('game:rematch:started', () => {
      setRematchRequested(false);
      setRematchReadyIds([]);
      showToast('Rematch started.', 1200);
    });

    s.on('player:dragging', (payload: { playerId?: string; dragging?: boolean }) => {
      if (!payload?.playerId || payload.playerId === s.id) return;
      setOpponentDragging(Boolean(payload.dragging));
    });

    s.on('connect_error', () => {
      setIsConnecting(false);
      setServerWaking(true);
      setError('');
    });

    setSocket(s);
  }, [isConnecting, socket, serverUrl, showToast, authProfile?.username, authUser?.id, emitCreateRoom]);

  const onCreatePrivateRoom = useCallback(async (): Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }> => {
    setAppMode('home');
    preventAutoRejoinRef.current = false;
    autoJoinAttemptedRef.current = false;
    const activeSocket = socketRef.current;
    if (joinedRoomRef.current) {
      setAppMode('multiplayer');
      setRoomCode(joinedRoomRef.current);
      resolvePendingCreate(joinedRoomRef.current);
      const code = normalizeRoomCode(joinedRoomRef.current);
      return {
        ok: Boolean(code),
        roomCode: code || null,
        inviteUrl: code ? getInviteLink(code) : null,
      };
    }
    if (activeSocket?.connected) {
      try {
        const resp = await emitCreateRoom(activeSocket);
        const code = normalizeRoomCode(resp?.roomCode);
        if (code) {
          setJoinedRoom(code);
          setRoomCode(code);
          setPlayers(normalizeRoomPlayers(resp.players ?? []));
          setAppMode('multiplayer');
        }
        return {
          ok: Boolean(code),
          roomCode: code || null,
          inviteUrl: code ? getInviteLink(code) : null,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Action failed';
        setError(message);
        showToast(message, 2000);
        return { ok: false, roomCode: null, inviteUrl: null };
      }
    }
    pendingCreateOnConnectRef.current = true;
    connectRef.current();
    const roomCode = await new Promise<string | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, 8000);
      pendingCreateResolversRef.current.push((code) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(code);
      });
    });
    const code = normalizeRoomCode(roomCode);
    if (!code) return { ok: false, roomCode: null, inviteUrl: null };
    return { ok: true, roomCode: code, inviteUrl: getInviteLink(code) };
  }, [emitCreateRoom, getInviteLink, resolvePendingCreate, showToast]);

  const copyInviteLink = useCallback(
    async (): Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }> => {
      let code = normalizeRoomCode(joinedRoomRef.current ?? roomCode);
      if (!code) {
        const created = await onCreatePrivateRoom();
        code = normalizeRoomCode(created.roomCode ?? roomCode);
      }
      if (!code) {
        showToast('Could not prepare an invite link.');
        return { ok: false, roomCode: null, inviteUrl: null };
      }
      const link = getInviteLink(code);
      if (!link) return { ok: false, roomCode: null, inviteUrl: null };
      try {
        await navigator.clipboard.writeText(link);
        showToast('Invite link copied.');
        return { ok: true, roomCode: code, inviteUrl: link };
      } catch {
        showToast('Could not copy invite link.');
        return { ok: false, roomCode: code, inviteUrl: link };
      }
    },
    [roomCode, getInviteLink, showToast, onCreatePrivateRoom],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (isConnected) return;
    if (intentionalDisconnectRef.current) return;
    if (!joinedRoomRef.current) return;
    if (!stateRef.current || stateRef.current.gameOver) return;

    // Only reconnect if we were mid-game and got accidentally dropped
    const timer = setTimeout(() => {
      if (!intentionalDisconnectRef.current && joinedRoomRef.current) {
        connectRef.current?.();
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [isConnected]);

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
    if (appMode !== 'multiplayer' && appMode !== 'tournament') return;
    if (autoConnectAttemptedRef.current) return;
    if (!serverUrl) return;
    if (intentionalDisconnectRef.current) return;
    autoConnectAttemptedRef.current = true;
    connect();
  }, [appMode, connect, serverUrl]);

// TOURNAMENT_CONNECT_EFFECT
  useEffect(() => {
    // Ensure tournament mode has an active socket (create/join requires it)
    if (appMode !== 'tournament') return;
    if (socket) return;
    if (intentionalDisconnectRef.current) return;
    connect();
  }, [appMode, socket, connect]);

  useEffect(() => {
    if (!authUser?.id) return;
    if (!serverUrl || socket || isConnecting) return;
    if (intentionalDisconnectRef.current) return;
    connect();
  }, [authUser?.id, serverUrl, socket, isConnecting, connect]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    reconnectRoomCodeRef.current = null;
    reconnectShouldJoinRef.current = false;
    preventAutoRejoinRef.current = true;
    autoJoinAttemptedRef.current = false;
    setAppMode('home');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LAST_ROOM_STORAGE_KEY);
    }
    const s = socketRef.current;
    if (s) {
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
    }
    setSocket(null);
    setJoinedRoom(null);
    setState(null);
    setLegalMoves([]);
    setCanDraw(false);
    setError('');
    setActionError('');
    setYou('');
    setSelectedTile(null);
    setIsConnected(false);
    setIsConnecting(false);
    setPlayers([]);
    setHandReveal(null);
    setRematchRequested(false);
    setRematchReadyIds([]);
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setPendingUiAction(null);
    handRevealShownRef.current = null;
    setAppMode('home');
    autoConnectAttemptedRef.current = false;
  }, []);

  const handlePostGame = useCallback(() => {
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    preventAutoRejoinRef.current = true;
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    const inTournament = Boolean(tournamentId) || tournamentState?.status === 'running';
    if (!inTournament) return disconnect();

    setJoinedRoom(null);
    setRoomCode('');
    setState(null);
    setLegalMoves([]);
    setCanDraw(false);
    setSelectedTile(null);
    setActionError('');
    setHandReveal(null);
    setRematchRequested(false);
    setRematchReadyIds([]);
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setAppMode('tournament');
  }, [disconnect, tournamentId, tournamentState?.status]);

  const _backToTournamentHub = useCallback(() => {
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    preventAutoRejoinRef.current = true;
    if (socket && joinedRoom) {
      socket.emit('room:leave', joinedRoom);
    }
    setJoinedRoom(null);
    setRoomCode('');
    setState(null);
    setLegalMoves([]);
    setCanDraw(false);
    setSelectedTile(null);
    setActionError('');
    setHandReveal(null);
    setRematchRequested(false);
    setRematchReadyIds([]);
    setAppMode('tournament');
  }, [socket, joinedRoom]);


  // Room actions
  const createRoom = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket) return setError('Not connected to server.');
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setPendingUiAction('create');
    try {
      await emitCreateRoom(socket);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      createInFlightRef.current = false;
      setPendingUiAction((prev) => (prev === 'create' ? null : prev));
    }
  }, [socket, emitCreateRoom, showToast]);

  const joinRoom = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket) return setError('Not connected to server.');
    if (joinInFlightRef.current) return;
    joinInFlightRef.current = true;
    setPendingUiAction('join');
    try {
      const resp = await emitWithAck<any>(
        socket,
        'room:join',
        roomCode.trim().toUpperCase(),
        {
          username: authProfile?.username ?? 'Guest',
          userId: authUser?.id ?? null,
        },
      );
      if (!resp?.ok) {
        setError(resp?.error ?? 'Unable to join room.');
        return;
      }
      setError('');
      setActionError('');
      setJoinedRoom(resp.roomCode);
      setState(resp.state ?? null);
      setPlayers(normalizeRoomPlayers(resp.players));
      setSelectedTile(null);
      setLegalMoves([]);
      setCanDraw(false);
      autoJoinAttemptedRef.current = false;
      preventAutoRejoinRef.current = false;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      joinInFlightRef.current = false;
      setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [socket, roomCode, authProfile?.username, authUser?.id, showToast]);

  useEffect(() => {
    if (!socket || !socket.connected || joinedRoom || autoJoinAttemptedRef.current) return;
    if (inviteJoinInFlightRef.current) return;
    const linkedCode =
      typeof window !== 'undefined'
        ? normalizeRoomCode(new URLSearchParams(window.location.search).get('room'))
        : '';
    if (!linkedCode) return;
    autoJoinAttemptedRef.current = true;
    setRoomCode(linkedCode);
    (async () => {
      try {
        const resp = await emitWithAck<any>(
          socket,
          'room:join',
          linkedCode,
          {
            username: authProfile?.username ?? 'Guest',
            userId: authUser?.id ?? null,
          },
        );
        if (!resp?.ok) {
          setError(resp?.error ?? 'Unable to join room from invite link.');
          return;
        }
        setJoinedRoom(resp.roomCode);
        setState(resp.state ?? null);
        setPlayers(normalizeRoomPlayers(resp.players));
        setSelectedTile(null);
        setLegalMoves([]);
        setCanDraw(false);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      }
    })();
  }, [socket, joinedRoom, authProfile?.username, authUser?.id, showToast]);

  const acceptFriendInvite = useCallback(async () => {
    if (!socket || !friendInvite) return;
    if (inviteJoinInFlightRef.current) return;
    inviteJoinInFlightRef.current = true;

    // If socket exists but isn't connected, wait for connection before joining
    if (!socket.connected) {
      try {
        socket.connect();
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Connection timed out')), 15000);
          socket.once('connect', () => {
            window.clearTimeout(timeout);
            resolve();
          });
          socket.once('connect_error', () => {
            window.clearTimeout(timeout);
            reject(new Error('Connection failed'));
          });
        });
      } catch {
        showToast('Could not connect to server. Try again.', 2000);
        inviteJoinInFlightRef.current = false;
        setPendingUiAction(null);
        return;
      }
    }

    preventAutoRejoinRef.current = true;
    setPendingUiAction('join');
    setError('');
    setActionError('');

    try {
      const resp = await emitWithAck<any>(
        socket,
        'room:join',
        normalizeRoomCode(friendInvite.roomCode),
        {
          username: authProfile?.username ?? 'Guest',
          userId: authUser?.id ?? null,
        },
      );
      if (!resp?.ok) {
        throw new Error(resp?.error ?? 'Unable to join room from invite.');
      }

      setJoinedRoom(resp.roomCode);
      setRoomCode(resp.roomCode);
      setState(resp.state ?? null);
      setPlayers(normalizeRoomPlayers(resp.players));
      setSelectedTile(null);
      setLegalMoves([]);
      setCanDraw(false);
      setAppMode('multiplayer');
      setFriendsOpen(false);
      autoJoinAttemptedRef.current = false;
      setFriendInvite(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      inviteJoinInFlightRef.current = false;
      preventAutoRejoinRef.current = false;
      setPendingUiAction((prev) => (prev === 'join' ? null : prev));
    }
  }, [socket, friendInvite, authProfile?.username, authUser?.id, showToast]);

  const startGame = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket || !joinedRoom) return setError('Not in a room.');
    setPendingUiAction('start');
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    try {
      const resp = await emitWithAck<any>(socket, 'game:start', joinedRoom);
      if (!resp?.ok) return setError(resp?.error ?? 'Unable to start game.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'start' ? null : prev));
    }
  }, [socket, joinedRoom, showToast]);

  const requestRematch = useCallback(() => {
    if (!socket || !joinedRoom || !state?.gameOver || rematchRequested) return;
    setRematchRequested(true);
    socket.emit('game:rematch', joinedRoom, (resp: any) => {
      if (resp?.ok) return;
      setRematchRequested(false);
      showToast(resp?.error ?? 'Rematch failed.');
    });
  }, [socket, joinedRoom, state?.gameOver, rematchRequested, showToast]);

  const appendMultiplayerMove = useCallback((entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you'
        ? multiplayerMoveCounterRef.current++
        : multiplayerMoveCounterRef.current;
    setMultiplayerMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const openMultiplayerAnalyzer = useCallback(() => {
    const analysis = analyzeMoveLog(multiplayerMoveLog);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('multiplayer', analysis);
    setAnalyzerOpen(true);
  }, [multiplayerMoveLog]);

  const emitDraggingState = useCallback(
    (dragging: boolean) => {
      if (draggingStateRef.current === dragging) return;
      draggingStateRef.current = dragging;
      if (!socket || !joinedRoom || !state || state.gameOver || state.handOver) return;
      if (!state.playerIds.includes(you)) return;
      socket.emit('player:dragging', joinedRoom, { dragging });
    },
    [socket, joinedRoom, state, you],
  );

  // Game actions
  const draw = useCallback(async () => {
    setActionError('');
    const boneyardLockedNow = (state?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow) return;
    emitDraggingState(false);
    setPendingUiAction('draw');
    const boardEnds = getBoardEnds(state?.board ?? null);
    const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMoves
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitWithAck<any>(socket, 'game:action', joinedRoom, { type: 'DRAW' });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to draw.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        boardState: snapshotBoardState(state?.board ?? null),
        boardRenderState: cloneBoardState(state?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
    }
  }, [socket, joinedRoom, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast]);

  const pass = useCallback(async () => {
    setActionError('');
    if (!socket || !joinedRoom) return;
    emitDraggingState(false);
    setPendingUiAction('pass');
    const boardEnds = getBoardEnds(state?.board ?? null);
    const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMoves
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitWithAck<any>(socket, 'game:action', joinedRoom, { type: 'PASS' });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to pass.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        boardState: snapshotBoardState(state?.board ?? null),
        boardRenderState: cloneBoardState(state?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
    }
  }, [socket, joinedRoom, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast]);

  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      if (!socket || !joinedRoom || !selectedTile) return;
      emitDraggingState(false);
      setPendingUiAction('play');
      const boardEnds = getBoardEnds(state?.board ?? null);
      const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
      const validMoves = legalMoves
        .filter((m) => m.type === 'play' && m.tile)
        .map((m) => toTileTuple(m.tile as Tile));
      const playedTile = toTileTuple(selectedTile);

      try {
        const resp = await emitWithAck<any>(
          socket,
          'game:action',
          joinedRoom,
          {
            type: 'MOVE',
            move: { tile: selectedTile, position },
          },
        );
        if (!resp?.ok) {
          setActionError(resp?.error ?? 'Unable to play tile.');
          setSelectedTile(null);
          return;
        }
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          boardEnds,
          handBefore,
          validMoves,
          pipDelta: -(playedTile[0] + playedTile[1]),
          boardState: snapshotBoardState(state?.board ?? null),
          boardRenderState: cloneBoardState(state?.board ?? null),
          handSnapshot: handBefore,
          engineBestMove: pickEngineBestMove(
            legalMoves
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
        });
        setSelectedTile(null);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
      }
    },
    [socket, joinedRoom, selectedTile, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast],
  );

  // Derived state
  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const myHand = state?.players[you]?.hand ?? [];
  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const opponentTileCount =
    state && opponentId
      ? (state.handCounts?.[opponentId] ?? state.players[opponentId]?.hand?.length ?? 0)
      : 0;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const opponent = players.find((pl) => pl.id !== you) ?? null;
  const opponentName = opponent?.username ? `@${opponent.username}` : 'Rival';
  const myName = authProfile?.username ? `You · @${authProfile.username}` : 'You';
  const myHandle = authProfile?.username
    ? `@${authProfile.username}`
    : authUser?.email
      ? `@${authUser.email.split('@')[0]}`
      : '@player';
  const inGame = Boolean(isConnected && joinedRoom && state);
  const isSpectatingMatch = Boolean(tournamentId && joinedRoom && state && !state.playerIds.includes(you));
  const isTournamentMatch = Boolean(tournamentId || tournamentState?.status === 'running');
  const spectateRightPlayerId = isSpectatingMatch ? (state?.playerIds?.[1] ?? null) : null;
  const spectateRightPlayer = spectateRightPlayerId ? players.find((pl) => pl.id === spectateRightPlayerId) ?? null : null;
  const hudRightLabel = isSpectatingMatch
    ? (spectateRightPlayer?.username ? `@${spectateRightPlayer.username}` : 'Spectating')
    : myName;
  const hudRightScore =
    isSpectatingMatch && spectateRightPlayerId ? (state?.players[spectateRightPlayerId]?.score ?? 0) : myScore;
  const hudRightScorePulse = isSpectatingMatch && spectateRightPlayerId ? Boolean(hudScorePulse[spectateRightPlayerId]) : Boolean(hudScorePulse[you]);
  const canPass = legalMoves.some((m) => m.type === 'pass');
  const hasPlayMoves = legalMoves.some((m) => m.type === 'play');
  const boneyardCount = state?.boneyard.length ?? 0;
  const isBoneyardLocked = boneyardCount <= 2;
  const canUseRematch = Boolean(
    state?.gameOver && joinedRoom && !isSpectatingMatch && !isTournamentMatch && state.playerIds.includes(you),
  );
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

  const handleTileTap = useCallback(
    (tile: Tile) => {
      if (!isMyTurn || state?.handOver || state?.gameOver) return;
      if (selectedTile && tileEquals(selectedTile, tile)) {
        const tileMoves = legalMoves.filter(
          (m) => m.type === 'play' && m.tile && tileEquals(m.tile as Tile, tile),
        );
        if (tileMoves.length === 1 && tileMoves[0].position) {
          play(tileMoves[0].position as PlacementPosition);
          return;
        }
      }
      setSelectedTile(tile);
      emitDraggingState(true);
    },
    [isMyTurn, state?.handOver, state?.gameOver, selectedTile, legalMoves, play, emitDraggingState],
  );

  useEffect(() => {
    emitDraggingState(Boolean(selectedTile));
  }, [selectedTile, emitDraggingState]);

  useEffect(() => {
    setRematchRequested(false);
    setRematchReadyIds([]);
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    setOpponentDragging(false);
    draggingStateRef.current = false;
  }, [joinedRoom]);

  useEffect(() => {
    if (!isMyTurn || state?.gameOver || state?.handOver) {
      emitDraggingState(false);
      setSelectedTile(null);
    }
  }, [isMyTurn, state?.gameOver, state?.handOver, emitDraggingState]);

  useEffect(() => {
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, myHand.length);
      const forceTwoRows = tileCount > 9;
      const maxSizeAtLowCounts = 56; // 14-tile reference size cap
      let tileWidth = maxSizeAtLowCounts;
      if (tileCount >= 9 && tileCount <= 10) tileWidth = 64;
      else if (tileCount >= 11 && tileCount <= 14) tileWidth = 56;
      else if (tileCount >= 15) tileWidth = 48;
      const trayHeight = forceTwoRows ? 138 : 120;
      document.documentElement.style.setProperty('--tray-height', `${trayHeight}px`);
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
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
    if (!inGame || !state || state.gameOver || !state.handOver) return;
    if (handRevealShownRef.current === state.handNumber) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    setHandReveal({
      handNumber: state.handNumber,
      opponentRemainingTiles: opponentIdFromState
        ? (state.players[opponentIdFromState]?.hand ?? [])
        : [],
      pointsAwarded: { you: 0, opponent: 0 },
    });
    handRevealShownRef.current = state.handNumber;
  }, [inGame, state, you]);

  useEffect(() => {
    if (!handReveal || !socket || !joinedRoom) return;
    if (state?.gameOver) {
      setHandReveal(null);
      return;
    }

    const timer = setTimeout(() => {
      socket.emit('hand:ready', joinedRoom, () => {});
      setHandReveal(null);
    }, HAND_OVER_REVEAL_MS);

    return () => clearTimeout(timer);
  }, [handReveal, socket, joinedRoom, state?.gameOver]);

  useEffect(() => {
    const handActive = Boolean(state) && !state?.handOver && !state?.gameOver;
    if (!handActive || !isMyTurn || hasPlayMoves) {
      autoTurnActionKeyRef.current = '';
      return;
    }

    const autoAction: 'draw' | 'pass' | null = canDraw ? 'draw' : canPass ? 'pass' : null;
    if (!autoAction) return;

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHand.length}:${state?.boneyard.length ?? 0}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === 'draw') {
      draw();
    } else {
      pass();
    }
  }, [state, isMyTurn, hasPlayMoves, canDraw, canPass, myHand.length, draw, pass]);

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

    appendMultiplayerMove({
      player: 'opponent',
      action,
      boardEnds: getBoardEnds(prev.board),
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      boardState: snapshotBoardState(prev.board),
      boardRenderState: cloneBoardState(prev.board),
      handSnapshot: (prev.players[you]?.hand ?? []).map(toTileTuple),
      engineBestMove: null,
    });
  }, [state, you, appendMultiplayerMove]);

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
      nextScores[pid] = score;
      if (prevHudScoresRef.current[pid] !== undefined && prevHudScoresRef.current[pid] !== score) {
        nextPulse[pid] = true;
        changed = true;
      }
    }

    prevHudScoresRef.current = nextScores;
    if (!changed) return;

    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state]);

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
    const loserSocketId = finalState.playerIds.find((pid) => pid !== winnerSocketId) ?? null;
    if (!loserSocketId) return;

    const key = `${joinedRoom}:${winnerSocketId}:${loserSocketId}`;
    if (matchRecordKeyRef.current === key) return;
    matchRecordKeyRef.current = key;

    if (!supabaseEnabled || !authUser) return;

    const bySocketId = new Map(players.map((p) => [p.id, p.userId ?? null] as const));
    let winnerUserId = bySocketId.get(winnerSocketId) ?? null;
    let loserUserId = bySocketId.get(loserSocketId) ?? null;

    if (winnerUserId !== authUser.id && loserUserId !== authUser.id) {
      if (winnerSocketId === you) {
        winnerUserId = authUser.id;
      } else if (loserSocketId === you) {
        loserUserId = authUser.id;
      } else if (!winnerUserId) {
        winnerUserId = authUser.id;
      } else {
        loserUserId = authUser.id;
      }
    }

    const winnerScore = finalState.players[winnerSocketId]?.score ?? null;
    const loserScore = finalState.players[loserSocketId]?.score ?? null;

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
  }, [state, joinedRoom, players, supabaseEnabled, authUser, you]);

  // ─── Render ───────────────────────────────────────────────

  if (appMode === 'noBrainer') {
    return <NoBrainerLabScreen onBack={() => setAppMode('home')} />;
  }

  if (appMode === 'bot') {
    return (
      <div className="app">
        <BotMatchScreen
          onBack={() => setAppMode('home')}
          userId={authUser?.id ?? null}
          username={authProfile?.username ?? null}
        />
      </div>
    );
  }

  if (appMode === 'daily') {
    return (
      <DailyPuzzleScreen user={authUser} profile={authProfile} onBack={() => setAppMode('home')} />
    );
  }

  if (appMode === 'dailyAdmin') {
    if (!isAdmin) {
      return (
        <div className="app">
          <div className="screen lobby-screen mode-home-screen">
            <div className="mode-home-glow" aria-hidden="true" />
            <div className="card lobby-card mode-card">
              <h2>Admin: Daily Puzzles</h2>
              <p>You are not authorized to access the puzzle editor.</p>
              <button className="mode-inline-btn" onClick={() => setAppMode('home')}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <DailyPuzzleAdminScreen onBack={() => setAppMode('home')} />;
  }
  if (appMode === 'tournament') {
    const players = tournamentState?.players ?? [];
    const standingsRaw = (tournamentState as any)?.standings;
    const standings = Array.isArray(standingsRaw)
      ? standingsRaw
      : standingsRaw && typeof standingsRaw === 'object'
        ? Object.values(standingsRaw)
        : [];
    const matchesRaw = (tournamentState as any)?.matches;
    const matches = Array.isArray(matchesRaw) ? matchesRaw : [];
    const activeRoom = tournamentActiveRoom ?? tournamentState?.activeRoomCode ?? null;
    const activeMatchId = tournamentState?.activeMatchId ?? null;
    const isHost = Boolean(tournamentState?.hostSocketId && socket?.id && tournamentState.hostSocketId === socket.id);

    const mySocketId = socket?.id ?? null;
    const nameFor = (sid: string) =>
      (players.find((p: any) => p.socketId === sid)?.username as string | undefined) ?? 'Player';

    const activeMatch =
      (activeMatchId ? matches.find((m: any) => m.id === activeMatchId) : null) ??
      matches.find((m: any) => m.status === 'active') ??
      null;

    const doneCount = matches.filter((m: any) => m.status === 'done').length;
    const totalMatches = matches.length;

    const youArePlaying = Boolean(
      activeMatch && mySocketId && (activeMatch.a === mySocketId || activeMatch.b === mySocketId),
    );

    const nextForYou =
      mySocketId
        ? matches.find(
            (m: any) =>
              m.status !== 'done' &&
              (m.a === mySocketId || m.b === mySocketId) &&
              (!activeMatch || m.id !== activeMatch.id),
          ) ?? null
        : null;

    const yourStatus =
      tournamentState?.status === 'complete'
        ? 'Tournament complete'
        : youArePlaying
          ? 'Playing now'
          : nextForYou
            ? 'Waiting for your next match'
            : tournamentState?.status === 'running'
              ? 'Waiting for assignment'
              : 'Lobby';
    const showLobbySetup = !tournamentId || tournamentState?.status === 'lobby';

    const createLobby = () => {
      if (!socket) return setError('Not connected.');
      socket.emit(
        'tournament:create',
        { username: authProfile?.username ?? 'Guest', userId: authUser?.id ?? null },
        (resp: any) => {
          if (!resp?.ok) return setError('Failed to create lobby.');
          setTournamentId(resp.id);
          setTournamentCode(resp.lobbyCode);
          setError('');
        },
      );
    };

    const joinLobby = () => {
      if (!socket) return setError('Not connected.');
      const code = tournamentCode.trim().toUpperCase();
      if (!code) return setError('Enter a lobby code.');
      socket.emit(
        'tournament:join',
        code,
        { username: authProfile?.username ?? 'Guest', userId: authUser?.id ?? null },
        (resp: any) => {
          if (!resp?.ok) {
            return setError(resp?.error === 'already_started' ? 'Tournament already started.' : 'Join failed.');
          }
          setTournamentId(resp.id);
          setTournamentCode(resp.lobbyCode);
          setError('');
        },
      );
    };

    const start = () => {
      if (!socket) return setError('Not connected.');
      socket.emit('tournament:start', (resp: any) => {
        if (!resp?.ok) return setError(resp?.error === 'need_4' ? 'Need 4+ players.' : 'Start failed.');
        setError('');
      });
    };

    const spectate = () => {
      if (!socket) return setError('Not connected.');
      if (!activeRoom) return setError('No active match yet.');
      const code = String(activeRoom).trim().toUpperCase();
      socket.emit(
        'room:spectate',
        code,
        {
          username: authProfile?.username ?? 'Guest',
          userId: authUser?.id ?? null,
        },
        (resp: any) => {
          if (!resp?.ok) return setError('Spectate failed.');
          setJoinedRoom(code);
          setRoomCode(code);
          setAppMode('multiplayer');
          setError('');
        },
      );
    };

    return (
      <div
        className="screen lobby-screen mode-home-screen"
>
        <div className="mode-home-glow" aria-hidden="true" />
        <div style={{ overflowY: 'auto', height: '100%', width: '100%' }}>
        <div
          className="card lobby-card mode-card multiplayer-menu-card"
          style={{ width: '100%' }}
        >
          <p className="lobby-kicker">Racehorse Dominoes</p>
          <h2>{tournamentId ? 'Tournament Hub' : 'Join or Create a Lobby'}</h2>
          <p className="lobby-server mode-subtitle">
            {tournamentId
              ? 'Finish your match, then wait here for the next round. Watch live games and track the standings.'
              : 'Create a new lobby or enter a code to join your friends instantly.'}
          </p>

          {error && (
            <div className="error-banner">
              {error}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}

          <div className="mode-actions" style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
            {/* TOURNAMENT_TWO_COL_LAYOUT */}
            <div style={{ display: 'flex', width: '100%', minWidth: 0, gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ width: '100%', minWidth: 0, display: 'grid', gap: 14 }}>
            {showLobbySetup && (
              <>
                <button className="mode-option mode-option-primary" onClick={createLobby}>
                  <span className="mode-option-title">Create Lobby</span>
                  <span className="mode-option-meta">Start a tournament lobby and share the code</span>
                </button>
                <div className="mode-option" style={{ cursor: 'default' }}>
                  <span className="mode-option-title">Join Lobby</span>
                  <span className="mode-option-meta">Enter a lobby code to join an existing tournament</span>
                  <div className="mode-join-row" style={{ marginTop: 10 }}>
                    <input
                      className="mode-join-input"
                      type="text"
                      placeholder="Lobby Code"
                      value={tournamentCode}
                      onChange={(e) => setTournamentCode(e.target.value.toUpperCase())}
                      maxLength={6}
                    />
                    <button className="mode-inline-btn" onClick={joinLobby} disabled={!tournamentCode.trim()}>
                      Join Lobby
                    </button>
                  </div>
                </div>
              </>
            )}
            {!!tournamentCode && (
              <div className="mode-option" style={{ cursor: 'default' }}>
                <span className="mode-option-title">Lobby Code</span>
                <span className="mode-option-meta">Share this code to invite players</span>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontSize: 22, letterSpacing: 1, opacity: 0.95 }}>{tournamentCode}</div>
                  <button
                    className="btn text compact"
                    onClick={() => navigator.clipboard?.writeText(String(tournamentCode))}
                    title="Copy lobby code"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            {isHost && tournamentState?.status !== 'running' && (
              <button className="mode-option mode-option-primary" onClick={start} disabled={players.length < 4}>
                <span className="mode-option-title">Start Tournament</span>
                <span className="mode-option-meta">
                  {players.length < 4 ? 'Need 4+ players to start' : 'Generate schedule and begin first match'}
                </span>
              </button>
            )}


            {/* Tournament Hub (waiting room) */}
                        {/* TOURNAMENT_TWO_COL_LAYOUT (grid) */}
            <div
              style={{
                display: 'grid',
                width: '100%',
                minWidth: 0,
                gridTemplateColumns: 'minmax(300px, 340px) minmax(0, 1fr)',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'grid', minWidth: 0, gap: 14 }}>
{tournamentId && (
              <div className="mode-option" style={{ cursor: 'default' }}>
                <span className="mode-option-title">Status</span>
                <span className="mode-option-meta">
                  {yourStatus}
                  {totalMatches ? ` • ${doneCount}/${totalMatches} complete` : ''}
                </span>

                <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ opacity: 0.9 }}>Now Playing</span>
                    <span style={{ opacity: 0.9 }}>
                      {activeMatch ? `${nameFor(activeMatch.a)} vs ${nameFor(activeMatch.b)}` : 'Waiting…'}
                    </span>
                  </div>

                  {!!nextForYou && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ opacity: 0.9 }}>Up Next</span>
                      <span style={{ opacity: 0.9 }}>
                        {nextForYou.a === mySocketId ? nameFor(nextForYou.b) : nameFor(nextForYou.a)}
                      </span>
                    </div>
                  )}
                </div>

                {tournamentState?.status === 'running' && activeRoom && !youArePlaying && (
                  <button
                    className="btn text compact"
                    style={{ marginTop: 12 }}
                    onClick={spectate}
                    disabled={!activeRoom}
                    title="Watch the current match"
                  >
                    Watch match
                  </button>
                )}
              </div>
            )}

            
              </div>
              <div style={{ width: '100%', minWidth: 0, display: 'grid', gap: 14 }}>
{tournamentId && matches.length > 0 && (
              <div className="mode-option" style={{ cursor: 'default' }}>
                <span className="mode-option-title">Bracket</span>
                <span className="mode-option-meta">Round robin schedule</span>

                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {matches.map((m: any, i: number) => {
                    const isActive = Boolean(activeMatch && m.id === activeMatch.id);
                    const involvesYou = Boolean(mySocketId && (m.a === mySocketId || m.b === mySocketId));
                    const rowOpacity = m.status === 'done' ? 0.7 : 0.92;

                    const left = nameFor(m.a);
                    const right = nameFor(m.b);

                    const label =
                      m.status === 'done' ? 'Done' : m.status === 'active' ? 'Playing' : 'Queued';

                    const winnerName =
                      m.status === 'done' && m.winner ? nameFor(m.winner) : null;

                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 10px',
                          borderRadius: 12,
                          opacity: rowOpacity,
                          outline: isActive ? '2px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.06)',
                          background: involvesYou ? 'rgba(255,255,255,0.04)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 2 }}>
                          <div style={{ opacity: 0.95 }}>
                            {left} <span style={{ opacity: 0.65 }}>vs</span> {right}
                          </div>
                          {winnerName && (
                            <div style={{ opacity: 0.75, fontSize: 12 }}>
                              Winner: {winnerName}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ opacity: 0.7, fontSize: 12 }}>#{i + 1}</span>
                          <span style={{ opacity: 0.85 }}>{label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
{tournamentId && Array.isArray(standings) && standings.length > 0 && (
              <div className="mode-option" style={{ cursor: 'default' }}>
                <span className="mode-option-title">Standings</span>
                <span className="mode-option-meta">Wins • point diff</span>

                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {standings.map((st: any, idx: number) => {
                    const diff = (st.pointsFor ?? 0) - (st.pointsAgainst ?? 0);
                    const me = Boolean(mySocketId && st.socketId === mySocketId);

                    return (
                      <div
                        key={st.socketId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 10px',
                          borderRadius: 12,
                          outline: '1px solid rgba(255,255,255,0.06)',
                          background: me ? 'rgba(255,255,255,0.05)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ opacity: 0.65, width: 18, textAlign: 'right' }}>{idx + 1}</span>
                          <span style={{ opacity: 0.95 }}>{st.username ?? 'Player'}</span>
                        </div>
                        <span style={{ opacity: 0.9 }}>
                          {st.wins ?? 0}-{st.losses ?? 0} ({diff >= 0 ? '+' : ''}{diff})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            

              </div>
            </div>
              </div>
            </div>

<button
              className="mode-option mode-option-secondary"
              style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
              onClick={disconnect}
            >
              <span className="mode-option-title">Disconnect</span>
              <span className="mode-option-meta">Return to offline mode selector</span>
            </button>
          </div>
        </div>
        </div>
      </div>
    );
  }



  const friendInvitePopup = friendInvite ? (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 2000,
        background: 'linear-gradient(170deg, rgba(18,26,39,0.96), rgba(9,15,26,0.98))',
        border: '1px solid rgba(236,252,245,0.2)',
        borderRadius: 14,
        padding: '16px 20px',
        color: 'rgba(235,245,242,0.96)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'grid',
        gap: 10,
        minWidth: 280,
      }}
    >
      <p style={{ margin: 0 }}>
        ⚡ <strong>@{friendInvite.fromUsername}</strong> invited you to a game!
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="mode-inline-btn"
          onClick={() => {
            void acceptFriendInvite();
          }}
          disabled={pendingUiAction === 'join'}
        >
          {pendingUiAction === 'join' ? 'Joining…' : 'Join'}
        </button>
        {friendInvite.inviteUrl && (
          <button
            className="mode-inline-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(friendInvite.inviteUrl);
                showToast('Invite link copied.', 1200);
              } catch {
                showToast('Could not copy invite link.', 1200);
              }
            }}
          >
            Copy Link
          </button>
        )}
        <button className="mode-inline-btn" onClick={() => setFriendInvite(null)}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hasSeenWelcome', 'true');
    }
    setWelcomeOpen(false);
  };
  const welcomeFeatureCardStyle: CSSProperties = {
    cursor: 'default',
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
          background: 'rgba(6,10,18,0.62)',
          backdropFilter: 'blur(8px)',
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
            🁣 Welcome to Racehorse Dominoes
          </h3>
          <p className="welcome-modal-subtitle" style={{ margin: '6px 0 10px', color: 'rgba(223,236,244,0.86)' }}>
            Pick a mode and jump in. Everything tracks automatically as you play.
          </p>
          <div className="welcome-features-grid">
            <div className="mode-option welcome-feature-card welcome-feature-multiplayer" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">🎮 Multiplayer Online</span>
              <span className="mode-option-meta welcome-feature-meta">
                Create a private room and play live 1v1 against friends with a room code
              </span>
            </div>
            <div className="mode-option welcome-feature-card welcome-feature-tournament" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">🏆 Tournament Mode</span>
              <span className="mode-option-meta welcome-feature-meta">
                Create or join a round-robin lobby (4+ players), share the code, compete through a full bracket playing shorter games to 30
              </span>
            </div>
            <div className="mode-option welcome-feature-card welcome-feature-bot" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">🤖 vs Bot</span>
              <span className="mode-option-meta welcome-feature-meta">
                Practice against an AI bot with normal rules, or a special 14 tile deal
              </span>
            </div>
            <div className="mode-option welcome-feature-card welcome-feature-lab" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">🧠 No-Brainer Lab</span>
              <span className="mode-option-meta welcome-feature-meta">
                Practice one-turn clear runs with curated hands. Can you clear all 7 tiles in one
                shot?
              </span>
            </div>
            <div className="mode-option welcome-feature-card welcome-feature-daily" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">🧩 Daily Puzzle</span>
              <span className="mode-option-meta welcome-feature-meta">
                One puzzle per day, solve it and compete on the leaderboard
              </span>
            </div>
            <div className="mode-option welcome-feature-card welcome-feature-stats" style={welcomeFeatureCardStyle}>
              <span className="mode-option-title welcome-feature-title">📊 Stats & Leaderboard</span>
              <span className="mode-option-meta welcome-feature-meta">
                Track wins, point diff, and streaks. Compete for the weekly leaderboard. View stats and challenge friends from the top bar
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex' }}>
            <button
              className="mode-inline-btn welcome-cta"
              onClick={dismissWelcome}
            >
              Let&apos;s Play →
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (appMode === 'home') {
    return (
      <div ref={appRootRef} className="app">
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 16,
            zIndex: 120,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {!authUser && (
            <button className="mode-inline-btn" onClick={() => setAuthModalOpen(true)}>
              Sign in
            </button>
          )}
          {authUser && (
            <>
              <button className="mode-inline-btn" onClick={() => setUsernameModalOpen(true)}>
                {myHandle}
              </button>
              <button className="mode-inline-btn" onClick={() => setStatsOpen(true)}>
                Stats
              </button>
              <button className="mode-inline-btn" onClick={() => setFriendsOpen(true)}>
                Friends
              </button>
              <button
                className="mode-inline-btn"
                disabled={signingOut}
                onClick={async () => {
                  reconnectShouldJoinRef.current = false;
                  reconnectRoomCodeRef.current = null;
                  preventAutoRejoinRef.current = true;
                  setSigningOut(true);
                  // Reset UI immediately; complete remote sign-out in the background.
                  setAppMode('home');
                  setJoinedRoom(null);
                  setState(null);
                  setPlayers([]);
                  setLegalMoves([]);
                  setCanDraw(false);
                  setSelectedTile(null);
                  setHandReveal(null);
                  setScoreTrackOpen(false);
                  setError('');
                  setActionError('');
                  try {
                    void signOut().catch(() => {});
                  } catch {
                    // no-op
                  } finally {
                    setSigningOut(false);
                  }
                }}
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </>
          )}
        </div>
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card">
            <p className="lobby-kicker">Racehorse Dominoes</p>
            <h2>Choose Game Mode</h2>
            <p className="lobby-server mode-subtitle">
              Choose how you want to play: live online matches, practice modes, or daily challenges.
            </p>
            <div className="mode-actions" style={{ maxWidth: '680px', width: '100%' }}>
              <button
                className="mode-option mode-option-primary"
                onClick={() => setAppMode('multiplayer')}
              >
                <span className="mode-option-title">Multiplayer Online</span>
                <span className="mode-option-meta">Create a private room and play head-to-head in real time</span>
              </button>
              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('bot')}
              >
                <span className="mode-option-title">Practice → Play vs Bot</span>
                <span className="mode-option-meta">Sharpen your game offline against an AI opponent</span>
              </button>
              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('noBrainer')}
              >
                <span className="mode-option-title">Practice → No-Brainer Lab</span>
                <span className="mode-option-meta">Practice one-turn clear runs with curated hands</span>
              </button>
            <button
              className="mode-option"
              onClick={() => {
                setError('');
                setAppMode('tournament');
              }}
            >
              <span className="mode-option-title">Tournament Mode</span>
              <span className="mode-option-meta">Round robin (4+ players), first to 30 points</span>
            </button>
              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('daily')}
              >
                <span className="mode-option-title">Daily Puzzle</span>
                <span className="mode-option-meta">
                  Solve today’s featured scenario and compare leaderboard results
                </span>
              </button>

              <button
                className="mode-option mode-option-secondary"
                onClick={() => setWeeklyStatsOpen(true)}
              >
                <span className="mode-option-title">Weekly Stats</span>
                <span className="mode-option-meta">See weekly highlights, awards, and leaderboard snapshots</span>
              </button>
              {isAdmin && (
                <button
                  className="mode-option mode-option-secondary"
                  onClick={() => setAppMode('dailyAdmin')}
                >
                  <span className="mode-option-title">Admin: Daily Puzzles</span>
                  <span className="mode-option-meta">
                    Create or edit curated daily puzzle entries
                  </span>
                </button>
              )}
            </div>

            {!supabaseEnabled && (
              <p className="lobby-server mode-subtitle" style={{ marginTop: 12 }}>
                {supabaseConfigError ?? 'Supabase not configured.'}
              </p>
            )}
          </div>
        </div>
        {welcomeModal}
        <AuthModal
          open={authModalOpen}
          supabaseEnabled={supabaseEnabled}
          supabaseConfigError={supabaseConfigError}
          onClose={() => setAuthModalOpen(false)}
          onSignIn={signIn}
          onSignUp={signUp}
        />
        <UsernameModal
          open={(!onboardingDismissed && needsUsernameOnboarding) || usernameModalOpen}
          currentUsername={authProfile?.username ?? null}
          onSave={async (username) => {
            const result = await updateUsername(username);
            if (!result.error) {
              window.localStorage.removeItem('username_onboarding_dismissed');
              setUsernameModalOpen(false);
            }
            return result;
          }}
          onClose={() => {
            window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
            setUsernameModalOpen(false);
          }}
        />
        <StatsScreen
          open={statsOpen}
          user={authUser}
          profile={authProfile}
          onClose={() => setStatsOpen(false)}
        />
        <FriendsScreen
          open={friendsOpen}
          user={authUser}
          socket={socket}
          joinedRoom={joinedRoom}
          currentUsername={authProfile?.username ?? ''}
          showToast={showToast}
          onCopyInviteLink={copyInviteLink}
          onCreatePrivateRoom={onCreatePrivateRoom}
          onClose={() => setFriendsOpen(false)}
        />
              <WeeklyStatsScreen
          open={weeklyStatsOpen}
          onClose={() => setWeeklyStatsOpen(false)}
          awards={weeklyAwards}
        />
        {friendInvitePopup}
</div>
    );
  }

  return (
    <div ref={appRootRef} className="app">
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

      {/* Disconnected Lobby Screen */}
      {!isConnected && (
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card multiplayer-menu-card">
            <p className="lobby-kicker">Racehorse Dominoes</p>
            <h2>Multiplayer Online</h2>
            <p className="lobby-server mode-subtitle">
              Connect to create a room or join a friend using a room code.
            </p>
            <p className="lobby-server mode-server-line">Server: {serverUrl}</p>
            <div className="mode-actions">
              <button
                className="mode-option mode-option-primary"
                onClick={connect}
                disabled={isConnecting}
              >
                <span className="mode-option-title">
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </span>
                <span className="mode-option-meta">Enable room creation and room joins</span>
              </button>
              <button className="mode-option mode-option-secondary" onClick={createRoom} disabled>
                <span className="mode-option-title">Create New Room</span>
                <span className="mode-option-meta">Connect first to start hosting</span>
              </button>
              <div className="mode-join-row">
                <input
                  className="mode-join-input"
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled
                />
                <button className="mode-inline-btn" onClick={joinRoom} disabled>
                  Join Room
                </button>
              </div>
              {serverWaking && (
                <p className="mode-subtitle" style={{ margin: '2px 0 0' }}>
                  Connecting to server... (this may take up to 60 seconds on first load)
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lobby Screen */}
      {isConnected && !joinedRoom && (
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card multiplayer-menu-card">
            <p className="lobby-kicker">Racehorse Dominoes</p>
            <h2>Join or Create a Room</h2>
            <p className="lobby-server mode-subtitle">
              Create a new room or enter a code to join your friend instantly.
            </p>
            <div className="mode-actions">
              <button
                className={`mode-option mode-option-primary ${pendingUiAction === 'create' ? 'is-loading' : ''}`}
                onClick={createRoom}
                disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
              >
                <span className="mode-option-title">{pendingUiAction === 'create' ? 'Creating…' : 'Create New Room'}</span>
                <span className="mode-option-meta">Start a room and share the code</span>
              </button>
              <div className="mode-join-row">
                <input
                  className="mode-join-input"
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
                />
                <button
                  className={`mode-inline-btn ${pendingUiAction === 'join' ? 'is-loading' : ''}`}
                  onClick={joinRoom}
                  disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
                >
                  {pendingUiAction === 'join' ? 'Joining…' : 'Join Room'}
                </button>
              </div>
              <button className="mode-option mode-option-secondary" onClick={disconnect}>
                <span className="mode-option-title">Disconnect</span>
                <span className="mode-option-meta">Return to offline mode selector</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Screen (waiting for game) */}
      {isConnected && joinedRoom && !state && (
        <div className="screen room-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card multiplayer-menu-card">
            <p className="lobby-kicker">Racehorse Dominoes</p>
            <h2>Room: {joinedRoom}</h2>
            <p className="lobby-server mode-subtitle">
              Waiting for all players to join before starting the hand.
            </p>
            <div className="players-list mode-room-list">
              <h3>Players ({players.length}/2)</h3>
              {players.map((p) => (
                <div
                  key={p.id}
                  className={`player-item mode-room-item ${p.id === you ? 'you' : ''}`}
                >
                  <div className="mode-room-item-label">
                    <span className="mode-room-item-title">
                      {p.id === you ? 'You' : `@${p.username}`}
                    </span>
                    {p.id === you && <span className="mode-room-item-sub">@{p.username}</span>}
                  </div>
                  {p.id === you && <span className="badge">Host</span>}
                </div>
              ))}
              {players.length < 2 && <div className="waiting">Waiting for another player...</div>}
            </div>
            {players.length === 2 && (
              <button
                className={`mode-option mode-option-primary ${pendingUiAction === 'start' ? 'is-loading' : ''}`}
                onClick={startGame}
                disabled={pendingUiAction === 'start'}
              >
                <span className="mode-option-title">{pendingUiAction === 'start' ? 'Starting…' : 'Start Game'}</span>
                <span className="mode-option-meta">Begin the live multiplayer hand</span>
              </button>
            )}
            <button className="mode-option mode-option-secondary" onClick={copyInviteLink}>
              <span className="mode-option-title">Copy Invite Link</span>
              <span className="mode-option-meta">Share one-tap room join with friends</span>
            </button>
            <button className="mode-option mode-option-secondary" onClick={disconnect}>
              <span className="mode-option-title">Leave Room</span>
              <span className="mode-option-meta">Exit this room and return to setup</span>
            </button>
          </div>
        </div>
      )}

      {/* Game Screen */}
      {isConnected && joinedRoom && state && (
        <div className={`screen game-screen walnut-live theme-${uiTheme}`}>
          <ScoreTrackOverlay
            open={scoreTrackOpen}
            onClose={() => setScoreTrackOpen(false)}
            target={60}
            players={[
              { label: opponentName, score: opponentScore, tone: 'opp' },
              { label: myName, score: myScore, tone: 'you' },
            ]}
          />
          {/* Game Over Overlay */}
          {state.gameOver && (
            <GameOverOverlay
              state={state}
              myId={you}
              onPrimary={canUseRematch ? requestRematch : handlePostGame}
              primaryLabel={canUseRematch ? (rematchRequested ? 'Rematch Requested' : 'Rematch') : 'New Game'}
              onExit={handlePostGame}
              secondaryLabel={canUseRematch ? 'Home' : 'Back'}
              waitingText={canUseRematch ? rematchWaitingText : undefined}
              players={players}
              extraActionLabel="Analyze Game"
              onExtraAction={openMultiplayerAnalyzer}
            />
          )}
          {handReveal && !state.gameOver && (
            <div className="hand-reveal-overlay">
              <div className="hand-reveal-backdrop" />
              <div className="hand-reveal-modal">
                <div className="hand-reveal-card">
                  <h3>Hand Over</h3>
                  <p className="reveal-points">
                    You:{' '}
                    {handReveal.pointsAwarded.you >= 0
                      ? `+${handReveal.pointsAwarded.you}`
                      : handReveal.pointsAwarded.you}
                    {' · '}
                    Opponent:{' '}
                    {handReveal.pointsAwarded.opponent >= 0
                      ? `+${handReveal.pointsAwarded.opponent}`
                      : handReveal.pointsAwarded.opponent}
                  </p>
                  <p className="reveal-label">Opponent remaining tiles</p>
                  <div className="reveal-tiles">
                    {handReveal.opponentRemainingTiles.map((tile, idx) => (
                      <DominoTile
                        key={`reveal-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={34}
                        className="hand-over-tile"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="wl-top-rail" data-ui="hud">
            <button
              type="button"
              className={`wl-player-pill wl-player-pill-btn ${!isMyTurn ? 'is-active' : ''} ${opponentId && hudScorePulse[opponentId] ? 'score-hit' : ''}`}
              onClick={() => setScoreTrackOpen(true)}
              aria-label="Open score track"
            >
              <div className="wl-pill-top">
                <span className="wl-player-label">{opponentName}</span>
                <span className={`wl-tiles-chip ${oppTilePulse ? 'is-pulsing' : ''}`}>
                  <span className="wl-tiles-count">{opponentTileCount}</span>
                  <span className="wl-tiles-text">tiles</span>
                </span>
              </div>
              <span className="wl-player-score">{opponentScore}</span>
            </button>
            <div className="wl-center-status">
              <span className={`wl-turn-label ${isMyTurn ? 'your-turn' : 'opp-turn'}`}>
                {isMyTurn ? 'Your move' : 'Opponent thinking'}
              </span>
              <span className="wl-room-code">Room {joinedRoom}</span>
            </div>
            <button
              type="button"
              className={`wl-player-pill wl-player-pill-btn is-you ${isMyTurn ? 'is-active' : ''} ${hudRightScorePulse ? 'score-hit' : ''}`}
              onClick={() => setScoreTrackOpen(true)}
              aria-label="Open score track"
            >
              <span className="wl-player-label">{hudRightLabel}</span>
              <span className="wl-player-score">{hudRightScore}</span>
            </button>
          </div>

          <div className="wl-stage-shell">
            <div className="board-area wl-board-area" data-ui="board">
              {!state.gameOver && (
                <div
                  className={`boneyard-pill${isBoneyardLocked ? ' locked' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 8,
                    borderRadius: 999,
                    border: '1px solid rgba(236,252,245,0.24)',
                    background: 'rgba(255,255,255,0.06)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    color: 'rgba(232,245,240,0.85)',
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    pointerEvents: 'none',
                  }}
                >
                  Boneyard:{' '}
                  {boneyardCount > 0 ? `${boneyardCount} left` : 'Empty'}
                  {isBoneyardLocked ? ' 🔒' : ''}
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 20, display: 'flex', gap: 2, alignItems: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: '4px 6px', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
                <RoomReactions feed={roomReactions} onSendChat={sendRoomChat} onSendEmote={sendRoomEmote} />
                <button onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))} title="Toggle table color" style={{ padding: '4px 6px', color: 'rgba(200,220,215,0.55)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/></svg>
                </button>
                <button className="btn text icon-btn volume-btn" onClick={() => setIsMuted((prev) => !prev)} title={isMuted ? 'Unmute' : 'Mute'} style={{ padding: '4px 6px', color: 'rgba(200,220,215,0.7)', background: 'none', border: 'none' }}>
                  <VolumeIcon isMuted={isMuted} />
                </button>
                <button className="btn text icon-btn fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} style={{ padding: '4px 6px', color: 'rgba(200,220,215,0.7)', background: 'none', border: 'none' }}>
                  <FullscreenIcon isFullscreen={isFullscreen} />
                </button>
                <button onClick={disconnect} title="Leave game" style={{ padding: '4px 6px', color: 'rgba(200,220,215,0.55)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
              </div>
              <Board
                board={state.board}
                legalMoves={isMyTurn ? legalMoves : []}
                selectedTile={isMyTurn ? selectedTile : null}
                onPositionClick={play}
                tileSize={72}
                showOpenEndGlow={isMyTurn && opponentDragging}
              />
            </div>
          </div>

          <div className="hand-area wl-hand-area" data-ui="tray">
            <div className="tray-rail">
              <div className="tray-center" ref={trayCenterRef}>
                <HandView
                  hand={myHand}
                  selectedTile={selectedTile}
                  onSelect={handleTileTap}
                  isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                  legalMoves={legalMoves}
                  tileSize={handTileSize}
                  compactStacked={handCompactStacked}
                  drawPulseIndex={drawPulseIndex}
                />
              </div>


            </div>
          </div>
        </div>
      )}
      <GameReviewer
        open={analyzerOpen}
        onClose={() => setAnalyzerOpen(false)}
        analysis={currentAnalysis}
        title="Game Review"
      />
    </div>
  );
}
