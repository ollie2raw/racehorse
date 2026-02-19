import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { Board, DominoTile } from "./components";
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
          />
        );
      })}
    </div>
  );
}

// ─── Score Display ───────────────────────────────────────────

interface ScoreBoardProps {
  state: GameState;
  myId: string;
  isMyTurn: boolean;
}

function ScoreBoard({ state, myId, isMyTurn }: ScoreBoardProps) {
  const [scorePulse, setScorePulse] = useState<Record<string, boolean>>({});
  const prevScoresRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const nextScores: Record<string, number> = {};
    const nextPulse: Record<string, boolean> = {};
    let changed = false;

    for (const pid of state.playerIds) {
      const score = state.players[pid]?.score ?? 0;
      nextScores[pid] = score;
      if (prevScoresRef.current[pid] !== undefined && prevScoresRef.current[pid] !== score) {
        nextPulse[pid] = true;
        changed = true;
      }
    }

    prevScoresRef.current = nextScores;
    if (!changed) return;

    setScorePulse(nextPulse);
    const timeout = setTimeout(() => setScorePulse({}), 150);
    return () => clearTimeout(timeout);
  }, [state.playerIds, state.players]);

  return (
    <div className={`scoreboard ${isMyTurn ? "my-turn" : ""}`}>
      <div className="scores-row">
        {state.playerIds.map((pid, idx) => {
          const score = state.players[pid]?.score ?? 0;
          const isWinner = state.winnerId === pid;
          const isActive = idx === state.currentPlayerIndex;

          return (
            <div
              key={pid}
              className={`player-score ${pid === myId ? "you" : ""} ${isActive ? "active" : ""} ${isWinner ? "winner" : ""} ${scorePulse[pid] ? "score-pulse" : ""}`}
            >
              <div className="player-label">
                {pid === myId ? "You" : "Opponent"}
                {isWinner && " 👑"}
              </div>
              <div className="score-number">{score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Game Over Overlay ───────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onNewGame: () => void;
}

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
  const [serverUrl] = useState(import.meta.env.VITE_SERVER_URL || "http://localhost:3001");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(70);
  const [handScale, setHandScale] = useState(1);
  const [handScrollable, setHandScrollable] = useState(false);
  const autoTurnActionKeyRef = useRef<string>("");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

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
        showToast("Hand over! Click 'Next Hand' to continue.");
      }
      if (update.state.gameOver) {
        showToast(update.state.winnerId === s.id ? "You win!" : "Game over!");
      }
    });

    s.on("room:update", (data: { players: string[] }) => {
      setPlayers(data.players);
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

  const nextHand = useCallback(() => {
    setActionError("");
    if (!socket || !joinedRoom) return;
    socket.emit("hand:next", joinedRoom, (resp: any) => {
      if (!resp.ok) setActionError(resp.error);
    });
  }, [socket, joinedRoom]);

  // Derived state
  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const myHand = state?.players[you]?.hand ?? [];
  const opponentId = state?.playerIds.find(pid => pid !== you) ?? null;
  const myTileCount = state ? (state.handCounts?.[you] ?? state.players[you]?.hand?.length ?? 0) : 0;
  const opponentTileCount = state && opponentId
    ? (state.handCounts?.[opponentId] ?? state.players[opponentId]?.hand?.length ?? 0)
    : 0;
  const inGame = Boolean(isConnected && joinedRoom && state);
  const canPass = legalMoves.some(m => m.type === "pass");
  const hasPlayMoves = legalMoves.some(m => m.type === "play");

  useEffect(() => {
    const centerEl = trayCenterRef.current;
    if (!centerEl) return;

    const BASE_TILE_SIZE = 70;
    const BASE_GAP = 10;
    const MIN_SCALE = 0.72;
    const MAX_SCALE = 1.0;

    const updateHandTileSize = () => {
      const count = Math.max(1, myHand.length);
      const availableWidth = Math.max(0, centerEl.clientWidth - 12);
      const baseTileWidth = BASE_TILE_SIZE * 2 + 9;
      const neededBaseWidth = count * baseTileWidth + (count - 1) * BASE_GAP;
      const rawScale = neededBaseWidth > 0 ? availableWidth / neededBaseWidth : 1;
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));
      const nextSize = Math.max(24, Math.floor(BASE_TILE_SIZE * nextScale));
      const scaledGap = Math.max(6, Math.round(BASE_GAP * nextScale));
      const scaledTileWidth = nextSize * 2 + 9;
      const neededScaledWidth = count * scaledTileWidth + (count - 1) * scaledGap;
      const shouldScroll =
        nextScale <= MIN_SCALE + 0.001 && neededScaledWidth > availableWidth + 1;

      setHandScale(prev => (prev === nextScale ? prev : nextScale));
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
        <div className="screen game-screen">
          {/* Game Over Overlay */}
          {state.gameOver && (
            <GameOverOverlay state={state} myId={you} onNewGame={disconnect} />
          )}

          <div className="game-top-bar" data-ui="hud">
            <ScoreBoard state={state} myId={you} isMyTurn={isMyTurn} />
            {state.handOver && !state.gameOver && (
              <button className="btn primary next-hand-btn" onClick={nextHand}>
                Next Hand
              </button>
            )}
          </div>

          <div className="board-area" data-ui="board">
            <Board
              board={state.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              onPositionClick={play}
              tileSize={80}
            />
          </div>

          <div className="hand-area" data-ui="tray">
            <div className="tray-rail">
              <div className="tray-left">
                <h3>Your Hand ({myHand.length})</h3>
                <div className="tile-count-hud">
                  <span className="tile-count-label">You</span>
                  <span className="tile-count-value">{myTileCount}</span>
                </div>
                {selectedTile && (
                  <span className="selection-info">
                    [{selectedTile.low}|{selectedTile.high}]
                  </span>
                )}
              </div>

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
                />
              </div>

              <div className="tray-right" data-ui="actions">
                <div className="tile-count-hud opponent">
                  <span className="tile-count-label">Opponent</span>
                  <span className="tile-count-value">{opponentTileCount}</span>
                </div>
                {isMyTurn && !state.handOver && !state.gameOver && hasPlayMoves && canDraw && (
                  <button className="btn text optional-draw-btn" onClick={draw}>
                    Draw ({state.boneyard.length})
                  </button>
                )}
                <button
                  className="btn text icon-btn fullscreen-btn"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  <span aria-hidden="true">{isFullscreen ? "🗗" : "⛶"}</span>
                </button>
                {state.handOver && !state.gameOver && (
                  <button className="btn primary next-hand-btn" onClick={nextHand}>
                    Next Hand
                  </button>
                )}
                <button className="btn text leave-btn" onClick={disconnect}>
                  Leave Game
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
