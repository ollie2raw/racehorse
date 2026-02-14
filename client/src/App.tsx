import { useMemo, useState, useCallback } from "react";
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

  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (branch.openEndIsDouble) {
        sum += branch.openEnd * 2;
      } else {
        sum += branch.openEnd;
      }
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
            size={54}
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
}

function ScoreBoard({ state, myId }: ScoreBoardProps) {
  const openEndsSum = useMemo(() => {
    if (!state.board) return 0;
    return computeOpenEndsSum(state.board);
  }, [state.board]);

  const winningScore = state.config.winningScore ?? 60;

  return (
    <div className="scoreboard">
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
              className={`player-score ${pid === myId ? "you" : ""} ${isActive ? "active" : ""} ${isWinner ? "winner" : ""}`}
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
  const [serverUrl] = useState("http://localhost:3001");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
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
  const canPass = legalMoves.some(m => m.type === "pass");

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="app">
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <header className="header">
        <h1>Racehorse Dominoes</h1>
        <div className="connection-status">
          {isConnected ? (
            <span className="status connected">● Connected</span>
          ) : (
            <span className="status disconnected">○ Disconnected</span>
          )}
        </div>
      </header>

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
          <div className="card">
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
          <div className="card">
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
          <div className="card">
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

          {/* Top Bar: Room + Scores */}
          <div className="game-top-bar">
            <div className="room-info">
              <span className="room-label">Room</span>
              <span className="room-code">{joinedRoom}</span>
              <span className="hand-number">Hand #{state.handNumber}</span>
            </div>
            <ScoreBoard state={state} myId={you} />
          </div>

          {/* Turn Indicator */}
          <div className={`turn-indicator ${isMyTurn ? "your-turn" : ""}`}>
            {state.gameOver
              ? state.winnerId === you
                ? "You Win!"
                : "Game Over"
              : state.handOver
              ? "Hand Over"
              : isMyTurn
              ? "Your Turn"
              : "Opponent's Turn"}
          </div>

          {/* Board */}
          <div className="board-area">
            <Board
              board={state.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              onPositionClick={play}
              tileSize={60}
            />
          </div>

          {/* Action Buttons */}
          <div className="actions">
            {state.handOver && !state.gameOver ? (
              <button className="btn primary" onClick={nextHand}>
                Next Hand
              </button>
            ) : (
              <>
                <button
                  className="btn action"
                  disabled={!isMyTurn || !canDraw}
                  onClick={draw}
                >
                  Draw ({state.boneyard.length})
                </button>
                <button
                  className="btn action"
                  disabled={!isMyTurn || !canPass}
                  onClick={pass}
                >
                  Pass
                </button>
              </>
            )}
          </div>

          {/* Your Hand */}
          <div className="hand-area">
            <div className="hand-header">
              <h3>Your Hand ({myHand.length})</h3>
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
            </div>
            <HandView
              hand={myHand}
              selectedTile={selectedTile}
              onSelect={setSelectedTile}
              isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
              legalMoves={legalMoves}
            />
          </div>

          {/* Leave button */}
          <button className="btn text leave-btn" onClick={disconnect}>
            Leave Game
          </button>
        </div>
      )}
    </div>
  );
}
