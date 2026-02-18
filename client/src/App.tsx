import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { Board, DominoTile } from "./components";
import type {
  Tile,
  PlacementPosition,
  BoardState,
  GameState,
  Move,
  StateUpdate,
} from "./types";

// ─── Utilities ───────────────────────────────────────────────

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

// Compute open ends sum (doubles count as 2x)
function computeOpenEndsSum(board: BoardState): number {
  if (board.mainLine.length === 1) {
    const t = board.mainLine[0].tile;
    return t.high + t.low;
  }

  let sum = 0;

  if (board.leftEndIsDouble) {
    sum += board.leftEnd * 2;
  } else {
    sum += board.leftEnd;
  }

  if (board.rightEndIsDouble) {
    sum += board.rightEnd * 2;
  } else {
    sum += board.rightEnd;
  }

  const loggedInvalidHubs = new Set<string>();
  for (const hub of board.hubDoubles) {
    const branches = Array.isArray(hub.branches) ? hub.branches : [];
    const hubLogKey = typeof hub.hubId === "number" ? `hub-${hub.hubId}` : `tileIndex-${hub.tileIndex}`;

    if (import.meta.env.DEV && !Array.isArray(hub.branches) && !loggedInvalidHubs.has(hubLogKey)) {
      console.warn("[computeOpenEndsSum] Hub has invalid branches container", {
        hubId: hub.hubId,
        tileIndex: hub.tileIndex,
        laneType: hub.laneType,
        branchesType: typeof hub.branches,
      });
      loggedInvalidHubs.add(hubLogKey);
    }

    for (const branch of branches) {
      if (!branch || typeof branch.openEnd !== "number") {
        if (import.meta.env.DEV && !loggedInvalidHubs.has(hubLogKey)) {
          console.warn("[computeOpenEndsSum] Ignoring invalid branch entry", {
            hubId: hub.hubId,
            tileIndex: hub.tileIndex,
            laneType: hub.laneType,
            branchesLength: branches.length,
            branchValue: branch,
          });
          loggedInvalidHubs.add(hubLogKey);
        }
        continue;
      }

      const isDouble = branch.openEndIsDouble === true;
      sum += isDouble ? branch.openEnd * 2 : branch.openEnd;
    }
  }

  return sum;
}

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
}

function HandView({ hand, selectedTile, onSelect, isMyTurn, legalMoves }: HandViewProps) {
  const playableTiles = useMemo(() => {
    return legalMoves
      .filter(m => m.type === "play" && m.tile)
      .map(m => m.tile!);
  }, [legalMoves]);

  const canPlayTile = (tile: Tile) => {
    return playableTiles.some(t => tileEquals(t, tile));
  };

  return (
    <div className="hand-container">
      {hand.map((tile, idx) => {
        const isSel = selectedTile && tileEquals(tile, selectedTile);
        const canPlay = isMyTurn && canPlayTile(tile);

        return (
          <DominoTile
            key={`${idx}-${tile.low}-${tile.high}`}
            tile={tile}
            size={70}
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
  const openEndsSum = useMemo(() => {
    if (!state.board) return 0;
    return computeOpenEndsSum(state.board);
  }, [state.board]);
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

  const winningScore = state.config.winningScore ?? 60;

  return (
    <div className={`scoreboard uiPanelWood ${isMyTurn ? "my-turn" : ""}`}>
      <div className="scoreboard-header">
        <span className="scoreboard-title">Race to {winningScore}</span>
        {state.board && (
          <span className="ends-sum">
            Open: {openEndsSum} {openEndsSum % 5 === 0 ? `= ${openEndsSum / 5} pts` : ""}
          </span>
        )}
      </div>
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
              <div className="score-bar">
                <div
                  className="score-fill"
                  style={{ width: `${Math.min(100, (score / winningScore) * 100)}%` }}
                />
              </div>
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
        <h2>{iWon ? "You Win!" : "Game Over"}</h2>
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
        <button className="btn primary" onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────

export default function App() {
  const appRootRef = useRef<HTMLDivElement>(null);
  const [serverUrl] = useState("http://localhost:3001");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
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
    setError("");
    const s = io(serverUrl, { transports: ["websocket"] });

    s.on("connect", () => {
      setIsConnected(true);
      setYou(s.id ?? "");
    });

    s.on("disconnect", () => {
      setIsConnected(false);
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
      setError(`Connection error: ${e.message}`);
    });

    setSocket(s);
  }, [serverUrl, showToast]);

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
  const inGame = Boolean(isConnected && joinedRoom && state);
  const canPass = legalMoves.some(m => m.type === "pass");
  const hasPlayMoves = legalMoves.some(m => m.type === "play");

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
            <button className="btn text fullscreen-btn" onClick={toggleFullscreen}>
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
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

      {/* Connection Screen */}
      {!isConnected && (
        <div className="screen connect-screen">
          <div className="card uiPanelWood">
            <h2>Connect to Server</h2>
            <p>Server: {serverUrl}</p>
            <button className="btn primary" onClick={connect}>
              Connect
            </button>
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

          <div className="game-top-bar uiPanelWood" data-ui="hud">
            <div className="room-info">
              <span className="room-label">Room</span>
              <span className="room-code">{joinedRoom}</span>
              <span className="hand-number">Hand #{state.handNumber}</span>
            </div>
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

          <div className="hand-area uiPanelWood" data-ui="tray">
            <div className="hand-header">
              <h3>Your Hand ({myHand.length})</h3>
              <div className="hand-controls" data-ui="actions">
                {selectedTile && (
                  <span className="selection-info">
                    Selected: [{selectedTile.low}|{selectedTile.high}]
                    {legalMoves.some(m => m.type === "play" && m.tile && tileEquals(m.tile, selectedTile)) ? (
                      <span className="hint"> — Click a zone on the board</span>
                    ) : (
                      <span className="invalid"> — Cannot play this tile</span>
                    )}
                  </span>
                )}
                {isMyTurn && !state.handOver && !state.gameOver && hasPlayMoves && canDraw && (
                  <button className="btn text optional-draw-btn" onClick={draw}>
                    Draw ({state.boneyard.length})
                  </button>
                )}
                <button className="btn text fullscreen-btn" onClick={toggleFullscreen}>
                  {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
                <span className={`status ${isConnected ? "connected" : "disconnected"}`}>
                  {isConnected ? "● Connected" : "○ Disconnected"}
                </span>
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
            <HandView
              hand={myHand}
              selectedTile={selectedTile}
              onSelect={setSelectedTile}
              isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
              legalMoves={legalMoves}
            />
          </div>
        </div>
      )}
    </div>
  );
}
