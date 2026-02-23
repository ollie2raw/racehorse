import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
    'home' | 'multiplayer' | 'noBrainer' | 'bot' | 'daily' | 'dailyAdmin'
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
    if (appMode !== 'multiplayer') return;
    if (autoConnectAttemptedRef.current) return;
    if (!serverUrl) return;
    autoConnectAttemptedRef.current = true;
    connect();
  }, [appMode, connect, serverUrl]);

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
            <GameOverOverlay state={state} myId={you} onNewGame={disconnect} players={players} />
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
              className={`wl-player-pill wl-player-pill-btn is-you ${isMyTurn ? 'is-active' : ''} ${hudScorePulse[you] ? 'score-hit' : ''}`}
              onClick={() => setScoreTrackOpen(true)}
              aria-label="Open score track"
            >
              <span className="wl-player-label">{myName}</span>
              <span className="wl-player-score">{myScore}</span>
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
                  <button className="btn text leave-btn compact" onClick={disconnect}>
                    Leave
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
