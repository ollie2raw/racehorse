import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
import AuthModal from './auth/AuthModal';
import UsernameModal from './auth/UsernameModal';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import StatsScreen from './stats/StatsScreen';
import { recordMatchResult } from './stats/statsApi';
import type { Tile, PlacementPosition, GameState, Move, StateUpdate } from './types';

// ─── Utilities ───────────────────────────────────────────────
type RoomPlayer = { id: string; username: string; userId: string | null };

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
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
  handScale: number;
  handScrollable: boolean;
  drawPulseIndex: number | null;
}

function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  handScale,
  handScrollable,
  drawPulseIndex,
}: HandViewProps) {
  const handContainerRef = useRef<HTMLDivElement>(null);

  const playableTiles = useMemo(() => {
    return legalMoves.filter((m) => m.type === 'play' && m.tile).map((m) => m.tile!);
  }, [legalMoves]);

  const canPlayTile = (tile: Tile) => {
    return playableTiles.some((t) => tileEquals(t, tile));
  };

  useEffect(() => {
    const el = handContainerRef.current;
    if (!el) return;

    // Keep hand visually centered and avoid stale left offsets from previous scroll states.
    if (!handScrollable) {
      el.scrollLeft = 0;
      return;
    }

    const overflow = el.scrollWidth - el.clientWidth;
    el.scrollLeft = overflow > 0 ? Math.round(overflow / 2) : 0;
  }, [handScrollable, hand.length, tileSize, handScale]);

  return (
    <div
      ref={handContainerRef}
      className="hand-container is-scrollable"
      style={{
        ['--hand-scale' as any]: handScale,
        ['--hand-gap' as any]: `${Math.max(8, Math.round(10 * handScale))}px`,
      }}
    >
      {hand.map((tile, idx) => {
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
      })}
    </div>
  );
}

// ─── Game Over Overlay ───────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onNewGame: () => void;
  players: RoomPlayer[];
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

function GameOverOverlay({ state, myId, onNewGame, players }: GameOverOverlayProps) {
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
    <div className="game-over-overlay">
      <div className="game-over-card">
        <h2 className="victory-title">{victoryTitle}</h2>
        <div className="final-scores">
          {state.playerIds.map((pid, idx) => (
            <div key={pid} className={`final-score ${pid === winner ? 'winner' : ''}`}>
              <span className="player-name">{getName(pid, idx)}</span>
              <span className="score">{state.players[pid]?.score ?? 0}</span>
              {pid === winner && <span className="crown">👑</span>}
            </div>
          ))}
        </div>
        <button className="btn primary victory-cta" onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
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
            <h3 style={{ margin: 0 }}>Weekly Stats</h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
              Mon–Sun highlights (wins, streaks, blowouts)
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {awards?.awards ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {awards.awards.map((a: any) => (
              <div
                key={a.key}
                style={{
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: '0.92rem', color: 'rgba(191,213,223,0.92)' }}>{a.title}</span>
                <strong style={{ fontSize: '1.02rem', whiteSpace: 'nowrap' }}>
                  {a.leader ? `${a.leader.username} (${a.leader.value})` : '—'}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Tap Refresh to load this week’s highlights.</p>
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
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [weeklyAwards, setWeeklyAwards] = useState<any | null>(null);

  const loadWeeklyAwards = useCallback(() => {
    if (!socket || !socket.connected) return;
    socket.emit("stats:weekly", (resp: any) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(70);
  const [handScale, setHandScale] = useState(1);
  const [handScrollable, setHandScrollable] = useState(false);
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
    window.localStorage.setItem('racehorse_ui_theme', uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);

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
    setError('');
    setIsConnecting(true);
    const s = io(serverUrl, { transports: ['websocket'] });
    s.onAny((event, ...args) => traceSocketEvent(String(event), args.length <= 1 ? args[0] : args));

    s.on('connect', () => {
      setIsConnected(true);
      setYou(s.id ?? '');
      setIsConnecting(false);
    });

    s.on('disconnect', () => {
      setIsConnected(false);
      setIsConnecting(false);
      setJoinedRoom(null);
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setError('');
      setActionError('');
    });

    s.on('state:update', (update: StateUpdate) => {
      setState(update.state);
      setLegalMoves(update.legalMoves);
      setCanDraw(update.canDraw);
      setSelectedTile(null);
      setActionError('');
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

    s.on('connect_error', (e) => {
      setIsConnecting(false);
      setError(`Connection error: ${e.message}`);
    });

    setSocket(s);
  }, [isConnecting, socket, serverUrl, showToast]);

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
    autoConnectAttemptedRef.current = true;
    connect();
  }, [appMode, connect, serverUrl]);

// TOURNAMENT_CONNECT_EFFECT
  useEffect(() => {
    // Ensure tournament mode has an active socket (create/join requires it)
    if (appMode !== 'tournament') return;
    if (socket) return;
    connect();
  }, [appMode, socket, connect]);

  const disconnect = useCallback(() => {
    socket?.disconnect();
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
    handRevealShownRef.current = null;
    setAppMode('home');
    autoConnectAttemptedRef.current = false;
  }, [socket]);

  const handlePostGame = useCallback(() => {
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
    setAppMode('tournament');
  }, [disconnect, tournamentId, tournamentState?.status]);

  const backToTournamentHub = useCallback(() => {
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
    setAppMode('tournament');
  }, [socket, joinedRoom]);


  // Room actions
  const createRoom = useCallback(() => {
    setError('');
    setActionError('');
    if (!socket) return setError('Not connected to server.');
    socket.emit(
      'room:create',
      {
        username: authProfile?.username ?? 'Guest',
        userId: authUser?.id ?? null,
      },
      (resp: any) => {
        if (!resp.ok) return setError(resp.error);
        setError('');
        setActionError('');
        setState(null);
        setLegalMoves([]);
        setCanDraw(false);
        setSelectedTile(null);
        setJoinedRoom(resp.roomCode);
        setRoomCode(resp.roomCode);
        setPlayers(normalizeRoomPlayers(resp.players));
      },
    );
  }, [socket, authProfile?.username, authUser?.id]);

  const joinRoom = useCallback(() => {
    setError('');
    setActionError('');
    if (!socket) return setError('Not connected to server.');
    socket.emit(
      'room:join',
      roomCode.trim().toUpperCase(),
      {
        username: authProfile?.username ?? 'Guest',
        userId: authUser?.id ?? null,
      },
      (resp: any) => {
        if (!resp.ok) return setError(resp.error);
        setError('');
        setActionError('');
        setJoinedRoom(resp.roomCode);
        setState(resp.state ?? null);
        setPlayers(normalizeRoomPlayers(resp.players));
        setSelectedTile(null);
        setLegalMoves([]);
        setCanDraw(false);
      },
    );
  }, [socket, roomCode, authProfile?.username, authUser?.id]);

  const startGame = useCallback(() => {
    setError('');
    setActionError('');
    if (!socket || !joinedRoom) return setError('Not in a room.');
    socket.emit('game:start', joinedRoom, (resp: any) => {
      if (!resp.ok) return setError(resp.error);
    });
  }, [socket, joinedRoom]);

  // Game actions
  const draw = useCallback(() => {
    setActionError('');
    if (!socket || !joinedRoom) return;
    socket.emit('game:action', joinedRoom, { type: 'DRAW' }, (resp: any) => {
      if (!resp.ok) setActionError(resp.error);
    });
  }, [socket, joinedRoom]);

  const pass = useCallback(() => {
    setActionError('');
    if (!socket || !joinedRoom) return;
    socket.emit('game:action', joinedRoom, { type: 'PASS' }, (resp: any) => {
      if (!resp.ok) setActionError(resp.error);
    });
  }, [socket, joinedRoom]);

  const play = useCallback(
    (position: PlacementPosition) => {
      setActionError('');
      if (!socket || !joinedRoom || !selectedTile) return;

      socket.emit(
        'game:action',
        joinedRoom,
        {
          type: 'MOVE',
          move: { tile: selectedTile, position },
        },
        (resp: any) => {
          if (!resp.ok) setActionError(resp.error);
          setSelectedTile(null);
        },
      );
    },
    [socket, joinedRoom, selectedTile],
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

  useEffect(() => {
    const centerEl = trayCenterRef.current;
    if (!centerEl) return;

    const getStableTileSize = () => {
      const vw = window.innerWidth;
      if (vw >= 1500) return 96;
      if (vw >= 1280) return 92;
      if (vw >= 1100) return 92;
      if (vw >= 900) return 86;
      if (vw >= 760) return 80;
      return 72;
    };

    const updateHandTileSize = () => {
      const count = Math.max(1, myHand.length);
      const availableWidth = Math.max(0, centerEl.clientWidth - 20);

      // Keep tile size stable during gameplay; only viewport size can change it.
      const nextSize = getStableTileSize();
      const scaledGap = Math.max(7, Math.round(nextSize * 0.14));
      const scaledTileWidth = nextSize + 9;
      const neededScaledWidth = count * scaledTileWidth + (count - 1) * scaledGap;
      const shouldScroll = neededScaledWidth > availableWidth + 1;
      const nextScale = nextSize / 70;

      setHandScale((prev) => (Math.abs(prev - nextScale) < 0.005 ? prev : nextScale));
      setHandScrollable((prev) => (prev === shouldScroll ? prev : shouldScroll));
      setHandTileSize((prev) => (prev === nextSize ? prev : nextSize));
    };

    updateHandTileSize();
    const observer = new ResizeObserver(updateHandTileSize);
    observer.observe(centerEl);
    window.addEventListener('resize', updateHandTileSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHandTileSize);
    };
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

  // Pulse the opp-tile card whenever the count changes
  useEffect(() => {
    if (prevOppCountRef.current !== null && prevOppCountRef.current !== opponentTileCount) {
      setOppTilePulse(true);
      const t = setTimeout(() => setOppTilePulse(false), 250);
      return () => clearTimeout(t);
    }
    prevOppCountRef.current = opponentTileCount;
  }, [opponentTileCount]);

  // Pulse score cards on scoring events and play a short hit cue.
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

    playTileSound('slam', isMuted);
    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state, isMuted]);

  // Add tactile audio feedback for turn switches and tile placements.
  useEffect(() => {
    if (!inGame || !state) {
      prevBoardTileCountRef.current = 0;
      prevTurnIdRef.current = null;
      return;
    }

    const currentTileCount = state.board?.mainLine.length ?? 0;
    if (prevBoardTileCountRef.current > 0 && currentTileCount > prevBoardTileCountRef.current) {
      playTileSound(
        currentTileCount - prevBoardTileCountRef.current > 1 ? 'slam' : 'standard',
        isMuted,
      );
    }
    prevBoardTileCountRef.current = currentTileCount;

    const activePlayerId = state.playerIds[state.currentPlayerIndex] ?? null;
    if (
      prevTurnIdRef.current !== null &&
      activePlayerId &&
      prevTurnIdRef.current !== activePlayerId
    ) {
      playTileSound('deal', isMuted);
    }
    prevTurnIdRef.current = activePlayerId;
  }, [inGame, state, isMuted]);

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
        <div
          className="card lobby-card mode-card multiplayer-menu-card"
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
                gridTemplateColumns: 'minmax(340px, 360px) minmax(0, 1fr)',
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
              onClick={() => setAppMode('home')}
            >
              <span className="mode-option-title">Disconnect</span>
              <span className="mode-option-meta">Return to offline mode selector</span>
            </button>
          </div>
        </div>
      </div>
    );
  }



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
              <button
                className="mode-inline-btn"
                disabled={signingOut}
                onClick={async () => {
                  try {
                    setSigningOut(true);
                    await signOut();
                  } catch {
                    // no-op: always force local UI reset below
                  } finally {
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
              Pick online multiplayer or a local no-brainer practice run.
            </p>
            <div className="mode-actions">
              <button
                className="mode-option mode-option-primary"
                onClick={() => setAppMode('multiplayer')}
              >
                <span className="mode-option-title">Multiplayer Online</span>
                <span className="mode-option-meta">Play live in private rooms</span>
              </button>
            <button
              className="mode-option"
              onClick={() => {
                setError('');
                setAppMode('tournament');
              }}
            >
              <span className="mode-option-title">Tournament Mode</span>
              <span className="mode-option-meta">Round robin (4+), first to 30</span>
            </button>


              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('noBrainer')}
              >
                <span className="mode-option-title">Practice → No-Brainer Lab</span>
                <span className="mode-option-meta">Offline puzzle mode, no server needed</span>
              </button>
              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('bot')}
              >
                <span className="mode-option-title">Practice → Play vs Bot</span>
                <span className="mode-option-meta">
                  Offline match vs a simple but strong bot (no server)
                </span>
              </button>
              <button
                className="mode-option mode-option-secondary"
                onClick={() => setAppMode('daily')}
              >
                <span className="mode-option-title">Daily Puzzle</span>
                <span className="mode-option-meta">
                  Curated puzzle from today’s board situation
                </span>
              </button>

              <button
                className="mode-option mode-option-secondary"
                onClick={() => setWeeklyStatsOpen(true)}
              >
                <span className="mode-option-title">Weekly Stats</span>
                <span className="mode-option-meta">Fun weekly awards and mini leaderboards</span>
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
        <AuthModal
          open={authModalOpen}
          loading={authLoading}
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
              <WeeklyStatsScreen
          open={weeklyStatsOpen}
          onClose={() => setWeeklyStatsOpen(false)}
          awards={weeklyAwards}
        />
</div>
    );
  }

  return (
    <div ref={appRootRef} className="app">
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

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
              <button className="mode-option mode-option-primary" onClick={createRoom}>
                <span className="mode-option-title">Create New Room</span>
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
                />
                <button className="mode-inline-btn" onClick={joinRoom}>
                  Join Room
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
              <button className="mode-option mode-option-primary" onClick={startGame}>
                <span className="mode-option-title">Start Game</span>
                <span className="mode-option-meta">Begin the live multiplayer hand</span>
              </button>
            )}
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
            <GameOverOverlay state={state} myId={you} onNewGame={handlePostGame} players={players} />
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
              <RoomReactions feed={roomReactions} onSendChat={sendRoomChat} onSendEmote={sendRoomEmote} />
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
              <Board
                board={state.board}
                legalMoves={legalMoves}
                selectedTile={selectedTile}
                onPositionClick={play}
                tileSize={72}
              />
            </div>
          </div>

          <div className="hand-area wl-hand-area" data-ui="tray">
            <div className="tray-rail">
              <div className="tray-center" ref={trayCenterRef}>
                <HandView
                  hand={myHand}
                  selectedTile={selectedTile}
                  onSelect={setSelectedTile}
                  isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                  legalMoves={legalMoves}
                  tileSize={handTileSize}
                  handScale={handScale}
                  handScrollable={handScrollable}
                  drawPulseIndex={drawPulseIndex}
                />
              </div>

              <div className="tray-right" data-ui="actions">
                {isMyTurn && !state.handOver && !state.gameOver && hasPlayMoves && canDraw && (
                  <button className="btn text optional-draw-btn compact" onClick={draw}>
                    Draw ({state.boneyard.length})
                  </button>
                )}
                <div className="tray-controls">
                  <div className="tray-icon-row">
                    <button
                      className="btn text icon-btn fullscreen-btn"
                      onClick={toggleFullscreen}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                      <FullscreenIcon isFullscreen={isFullscreen} />
                    </button>
                    <button
                      className="btn text icon-btn volume-btn"
                      onClick={() => setIsMuted((prev) => !prev)}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <VolumeIcon isMuted={isMuted} />
                    </button>
                  </div>
                  <button
                    className="btn text compact"
                    onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))}
                    title={
                      uiTheme === 'green'
                        ? 'Switch to brown felt + colored pips'
                        : 'Switch to green felt + black pips'
                    }
                  >
                    Color
                  </button>
                  {isSpectatingMatch ? (
                    <button
                      className="btn text leave-btn compact"
                      onClick={backToTournamentHub}
                      title="Back to Hub"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Hub
                    </button>
                  ) : (
                    <button className="btn text leave-btn compact" onClick={disconnect}>
                      Leave
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
