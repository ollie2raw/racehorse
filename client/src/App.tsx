import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { Board, DominoTile } from "./components";
import { playTileSound } from "./utils/sound";
import type {
  Tile,
  PlacementPosition,
  GameState,
  Move,
  StateUpdate,
} from "./types";

// ─── Utilities ───────────────────────────────────────────────

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
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
  const playableTiles = useMemo(() => {
    return legalMoves
      .filter(m => m.type === "play" && m.tile)
      .map(m => m.tile!);
  }, [legalMoves]);

  const canPlayTile = (tile: Tile) => {
    return playableTiles.some(t => tileEquals(t, tile));
  };

  return (
    <div
      className={`hand-container ${handScrollable ? "is-scrollable" : ""}`}
      style={{
        ["--hand-scale" as any]: handScale,
        ["--hand-gap" as any]: `${Math.max(8, Math.round(10 * handScale))}px`,
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
            className={drawPulseIndex === idx ? "new-draw" : ""}
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

function GameOverOverlay({ state, myId, onNewGame }: GameOverOverlayProps) {
  const winner = state.winnerId;
  const iWon = winner === myId;

  return (
    <div className="game-over-overlay">
      <div className="game-over-card">
        <h2 className="victory-title">{iWon ? "You Win!" : "You Lose"}</h2>
        <div className="final-scores">
          {state.playerIds.map((pid, idx) => (
            <div key={pid} className={`final-score ${pid === winner ? "winner" : ""}`}>
              <span className="player-name">
                {pid === myId ? "You" : `Player ${idx + 1}`}
              </span>
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
  const turnToastRef = useRef<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [serverUrl] = useState(import.meta.env.VITE_SERVER_URL || "http://localhost:3001");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiTheme, setUiTheme] = useState<"green" | "brown">(() => {
    if (typeof window === "undefined") return "green";
    const stored = window.localStorage.getItem("racehorse_ui_theme");
    return stored === "brown" ? "brown" : "green";
  });

  const [roomCode, setRoomCode] = useState("");
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [you, setYou] = useState<string>("");
  const [players, setPlayers] = useState<string[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [canDraw, setCanDraw] = useState(false);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const [handReveal, setHandReveal] = useState<HandEndedPayload | null>(null);

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(70);
  const [handScale, setHandScale] = useState(1);
  const [handScrollable, setHandScrollable] = useState(false);
  const autoTurnActionKeyRef = useRef<string>("");
  const handRevealShownRef = useRef<number | null>(null);
  const prevOppCountRef = useRef<number | null>(null);
  const [oppTilePulse, setOppTilePulse] = useState(false);
  const prevBoardTileCountRef = useRef(0);
  const prevTurnIdRef = useRef<string | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);

  const showToast = useCallback((msg: string, duration = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(""), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("racehorse_ui_theme", uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
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
      const message = err instanceof Error ? err.message : "Unable to toggle fullscreen.";
      setError(`Fullscreen error: ${message}`);
    }
  }, []);

  // Connection
  const connect = useCallback(() => {
    if (isConnecting || socket?.connected) return;
    setError("");
    setIsConnecting(true);
    const s = io(serverUrl, { transports: ["websocket"] });

    s.on("connect", () => {
      setIsConnected(true);
      setYou(s.id ?? "");
      setIsConnecting(false);
    });

    s.on("disconnect", () => {
      setIsConnected(false);
      setIsConnecting(false);
      setJoinedRoom(null);
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setError("");
      setActionError("");
    });

    s.on("state:update", (update: StateUpdate) => {
      setState(update.state);
      setLegalMoves(update.legalMoves);
      setCanDraw(update.canDraw);
      setSelectedTile(null);
      setActionError("");
      if (update.state.handOver && !update.state.gameOver) {
        showToast("Hand over", 1200);
      }
      if (update.state.gameOver) {
        showToast(update.state.winnerId === s.id ? "You win!" : "Game over!");
      }
    });

    s.on("room:update", (data: { players: string[] }) => {
      setPlayers(data.players);
    });

    s.on("hand:ended", (payload: HandEndedPayload) => {
      setHandReveal(payload);
      handRevealShownRef.current = payload.handNumber;
    });

    s.on("connect_error", (e) => {
      setIsConnecting(false);
      setError(`Connection error: ${e.message}`);
    });

    setSocket(s);
  }, [isConnecting, socket, serverUrl, showToast]);

  useEffect(() => {
    if (autoConnectAttemptedRef.current) return;
    if (!serverUrl) return;
    autoConnectAttemptedRef.current = true;
    connect();
  }, [connect, serverUrl]);

  const disconnect = useCallback(() => {
    socket?.disconnect();
    setSocket(null);
    setJoinedRoom(null);
    setState(null);
    setLegalMoves([]);
    setCanDraw(false);
    setError("");
    setActionError("");
    setYou("");
    setSelectedTile(null);
    setIsConnected(false);
    setIsConnecting(false);
    setPlayers([]);
    setHandReveal(null);
    handRevealShownRef.current = null;
  }, [socket]);

  // Room actions
  const createRoom = useCallback(() => {
    setError("");
    setActionError("");
    if (!socket) return setError("Not connected to server.");
    socket.emit("room:create", {}, (resp: any) => {
      if (!resp.ok) return setError(resp.error);
      setError("");
      setActionError("");
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setSelectedTile(null);
      setJoinedRoom(resp.roomCode);
      setRoomCode(resp.roomCode);
      setPlayers(resp.players);
    });
  }, [socket]);

  const joinRoom = useCallback(() => {
    setError("");
    setActionError("");
    if (!socket) return setError("Not connected to server.");
    socket.emit("room:join", roomCode.trim().toUpperCase(), (resp: any) => {
      if (!resp.ok) return setError(resp.error);
      setError("");
      setActionError("");
      setJoinedRoom(resp.roomCode);
      setState(resp.state ?? null);
      setPlayers(resp.players);
      setSelectedTile(null);
      setLegalMoves([]);
      setCanDraw(false);
    });
  }, [socket, roomCode]);

  const startGame = useCallback(() => {
    setError("");
    setActionError("");
    if (!socket || !joinedRoom) return setError("Not in a room.");
    socket.emit("game:start", joinedRoom, (resp: any) => {
      if (!resp.ok) return setError(resp.error);
    });
  }, [socket, joinedRoom]);

  // Game actions
  const draw = useCallback(() => {
    setActionError("");
    if (!socket || !joinedRoom) return;
    socket.emit("game:action", joinedRoom, { type: "DRAW" }, (resp: any) => {
      if (!resp.ok) setActionError(resp.error);
    });
  }, [socket, joinedRoom]);

  const pass = useCallback(() => {
    setActionError("");
    if (!socket || !joinedRoom) return;
    socket.emit("game:action", joinedRoom, { type: "PASS" }, (resp: any) => {
      if (!resp.ok) setActionError(resp.error);
    });
  }, [socket, joinedRoom]);

  const play = useCallback(
    (position: PlacementPosition) => {
      setActionError("");
      if (!socket || !joinedRoom || !selectedTile) return;

      socket.emit(
        "game:action",
        joinedRoom,
        {
          type: "MOVE",
          move: { tile: selectedTile, position },
        },
        (resp: any) => {
          if (!resp.ok) setActionError(resp.error);
          setSelectedTile(null);
        }
      );
    },
    [socket, joinedRoom, selectedTile]
  );

  // Derived state
  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const myHand = state?.players[you]?.hand ?? [];
  const opponentId = state?.playerIds.find(pid => pid !== you) ?? null;
  const opponentTileCount = state && opponentId
    ? (state.handCounts?.[opponentId] ?? state.players[opponentId]?.hand?.length ?? 0)
    : 0;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const inGame = Boolean(isConnected && joinedRoom && state);
  const canPass = legalMoves.some(m => m.type === "pass");
  const hasPlayMoves = legalMoves.some(m => m.type === "play");

  useEffect(() => {
    const centerEl = trayCenterRef.current;
    if (!centerEl) return;

    const getStableTileSize = () => {
      const vw = window.innerWidth;
      if (vw >= 1500) return 104;
      if (vw >= 1280) return 98;
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
      const scaledTileWidth = nextSize * 2 + 9;
      const neededScaledWidth = count * scaledTileWidth + (count - 1) * scaledGap;
      const shouldScroll = neededScaledWidth > availableWidth + 1;
      const nextScale = nextSize / 70;

      setHandScale(prev => (Math.abs(prev - nextScale) < 0.005 ? prev : nextScale));
      setHandScrollable(prev => (prev === shouldScroll ? prev : shouldScroll));
      setHandTileSize(prev => (prev === nextSize ? prev : nextSize));
    };

    updateHandTileSize();
    const observer = new ResizeObserver(updateHandTileSize);
    observer.observe(centerEl);
    window.addEventListener("resize", updateHandTileSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHandTileSize);
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
      opponentRemainingTiles: opponentIdFromState ? state.players[opponentIdFromState]?.hand ?? [] : [],
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
      socket.emit("hand:ready", joinedRoom, () => {});
      setHandReveal(null);
    }, HAND_OVER_REVEAL_MS);

    return () => clearTimeout(timer);
  }, [handReveal, socket, joinedRoom, state?.gameOver]);

  useEffect(() => {
    const handActive = Boolean(state) && !state?.handOver && !state?.gameOver;
    if (!handActive || !isMyTurn || hasPlayMoves) {
      autoTurnActionKeyRef.current = "";
      return;
    }

    const autoAction: "draw" | "pass" | null = canDraw ? "draw" : canPass ? "pass" : null;
    if (!autoAction) return;

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHand.length}:${state?.boneyard.length ?? 0}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === "draw") {
      draw();
    } else {
      pass();
    }
  }, [
    state,
    isMyTurn,
    hasPlayMoves,
    canDraw,
    canPass,
    myHand.length,
    draw,
    pass,
  ]);

  useEffect(() => {
    if (!inGame || !state || state.handOver || state.gameOver) {
      turnToastRef.current = null;
      return;
    }

    const activePlayerId = state.playerIds[state.currentPlayerIndex];
    if (!activePlayerId || turnToastRef.current === activePlayerId) return;

    if (turnToastRef.current !== null) {
      showToast(activePlayerId === you ? "Your turn" : "Opponent's turn", 1200);
    }
    turnToastRef.current = activePlayerId;
  }, [inGame, state, showToast, you]);

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

    playTileSound("slam", false);
    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state]);

  // Add tactile audio feedback for turn switches and tile placements.
  useEffect(() => {
    if (!inGame || !state) {
      prevBoardTileCountRef.current = 0;
      prevTurnIdRef.current = null;
      return;
    }

    const currentTileCount = state.board?.mainLine.length ?? 0;
    if (
      prevBoardTileCountRef.current > 0 &&
      currentTileCount > prevBoardTileCountRef.current
    ) {
      playTileSound(currentTileCount - prevBoardTileCountRef.current > 1 ? "slam" : "standard", false);
    }
    prevBoardTileCountRef.current = currentTileCount;

    const activePlayerId = state.playerIds[state.currentPlayerIndex] ?? null;
    if (
      prevTurnIdRef.current !== null &&
      activePlayerId &&
      prevTurnIdRef.current !== activePlayerId
    ) {
      playTileSound("deal", false);
    }
    prevTurnIdRef.current = activePlayerId;
  }, [inGame, state]);

  // ─── Render ───────────────────────────────────────────────

  return (
    <div ref={appRootRef} className="app">
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      {!inGame && (
        <header className="header uiPanelWood">
          <h1>Racehorse Dominoes</h1>
          <div className="connection-status">
            {isConnected ? (
              <span className="status connected">● Connected</span>
            ) : (
              <span className="status disconnected">○ Disconnected</span>
            )}
            <button
              className="btn text icon-btn fullscreen-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <span aria-hidden="true">{isFullscreen ? "🗗" : "⛶"}</span>
            </button>
          </div>
        </header>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && state && !state.handOver && !state.gameOver && (
        <div className="error-banner">
          {actionError}
          <button onClick={() => setActionError("")}>×</button>
        </div>
      )}

      {/* Disconnected Lobby Screen */}
      {!isConnected && (
        <div className="screen lobby-screen">
          <div className="card lobby-card">
            <p className="lobby-kicker">Racehorse Dominoes</p>
            <h2>Play online with a friend</h2>
            <p className="lobby-server">Server: {serverUrl}</p>
            <div className="lobby-actions">
              <button className="btn primary lobby-connect-btn" onClick={connect} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
              <div className="divider">or</div>
              <button className="btn primary" onClick={createRoom} disabled>
                Create New Room
              </button>
              <div className="join-form">
                <input
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled
                />
                <button className="btn secondary" onClick={joinRoom} disabled>
                  Join Room
                </button>
              </div>
              <p className="lobby-server">Connect to enable room actions.</p>
            </div>
          </div>
        </div>
      )}

      {/* Lobby Screen */}
      {isConnected && !joinedRoom && (
        <div className="screen lobby-screen">
          <div className="card uiPanelWood">
            <h2>Join or Create a Room</h2>
            <div className="lobby-actions">
              <button className="btn primary" onClick={createRoom}>
                Create New Room
              </button>
              <div className="divider">or</div>
              <div className="join-form">
                <input
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                />
                <button className="btn secondary" onClick={joinRoom}>
                  Join Room
                </button>
              </div>
            </div>
          </div>
          <button className="btn text" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      )}

      {/* Room Screen (waiting for game) */}
      {isConnected && joinedRoom && !state && (
        <div className="screen room-screen">
          <div className="card uiPanelWood">
            <h2>Room: {joinedRoom}</h2>
            <div className="players-list">
              <h3>Players ({players.length}/2)</h3>
              {players.map((p, i) => (
                <div key={p} className={`player-item ${p === you ? "you" : ""}`}>
                  {p === you ? "You" : `Player ${i + 1}`}
                  {p === you && <span className="badge">Host</span>}
                </div>
              ))}
              {players.length < 2 && (
                <div className="waiting">Waiting for another player...</div>
              )}
            </div>
            {players.length === 2 && (
              <button className="btn primary" onClick={startGame}>
                Start Game
              </button>
            )}
          </div>
          <button className="btn text" onClick={disconnect}>
            Leave Room
          </button>
        </div>
      )}

      {/* Game Screen */}
      {isConnected && joinedRoom && state && (
        <div className={`screen game-screen walnut-live theme-${uiTheme}`}>
          {/* Game Over Overlay */}
          {state.gameOver && (
            <GameOverOverlay state={state} myId={you} onNewGame={disconnect} />
          )}
          {handReveal && !state.gameOver && (
            <div className="hand-reveal-overlay">
              <div className="hand-reveal-backdrop" />
              <div className="hand-reveal-modal">
                <div className="hand-reveal-card">
                  <h3>Hand Over</h3>
                  <p className="reveal-points">
                    You: {handReveal.pointsAwarded.you >= 0 ? `+${handReveal.pointsAwarded.you}` : handReveal.pointsAwarded.you}
                    {" · "}
                    Opponent: {handReveal.pointsAwarded.opponent >= 0 ? `+${handReveal.pointsAwarded.opponent}` : handReveal.pointsAwarded.opponent}
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
            <div className={`wl-player-pill ${!isMyTurn ? "is-active" : ""} ${opponentId && hudScorePulse[opponentId] ? "score-hit" : ""}`}>
              <div className="wl-pill-top">
                <span className="wl-player-label">Rival</span>
                <span className={`wl-tiles-chip ${oppTilePulse ? "is-pulsing" : ""}`}>{opponentTileCount} tiles</span>
              </div>
              <span className="wl-player-score">{opponentScore}</span>
            </div>
            <div className="wl-center-status">
              <span className={`wl-turn-label ${isMyTurn ? "your-turn" : "opp-turn"}`}>
                {isMyTurn ? "Your move" : "Opponent thinking"}
              </span>
              <span className="wl-room-code">Room {joinedRoom}</span>
            </div>
            <div className={`wl-player-pill is-you ${isMyTurn ? "is-active" : ""} ${hudScorePulse[you] ? "score-hit" : ""}`}>
              <span className="wl-player-label">You</span>
              <span className="wl-player-score">{myScore}</span>
            </div>
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
                  <button
                    className="btn text icon-btn fullscreen-btn"
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  >
                    <span aria-hidden="true">{isFullscreen ? "🗗" : "⛶"}</span>
                  </button>
                  <button
                    className="btn text compact"
                    onClick={() => setUiTheme(prev => (prev === "green" ? "brown" : "green"))}
                    title={uiTheme === "green" ? "Switch to brown felt + colored pips" : "Switch to green felt + black pips"}
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
