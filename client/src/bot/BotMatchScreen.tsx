import { useEffect, useMemo, useRef, useState } from "react";
import { Board, DominoTile } from "../components";
import type { Move, Tile } from "../types";
import {
  applyPlayMove,
  createBotMatch,
  drawUntilPlayableOrEmpty,
  getDisplayOpenEnds,
  getLegalMoves,
  startNextBotHand,
  type BotActionResult,
  type BotMatchState,
} from "./botEngine";
import { chooseBotMove, type BotChoice, type BotDifficulty } from "./botHeuristics";
import "./botMatch.css";

interface BotMatchScreenProps {
  onBack: () => void;
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

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function findMoveForSelection(moves: Move[], tile: Tile, position: Move["position"]): Move | null {
  return moves.find(
    m => m.type === "play" && m.tile && m.position === position && tileEquals(m.tile, tile)
  ) ?? null;
}

function asPlayMoves(moves: Move[]): Move[] {
  return moves.filter(m => m.type === "play");
}

function toastFromResult(result: BotActionResult): string {
  if (result.scored) {
    return `${result.scored.player === "you" ? "You" : "Bot"} scored +${result.scored.points * 5}`;
  }
  if (result.handEnded) {
    if (result.handEnded.winner === null) return "Blocked hand: tie";
    const winner = result.handEnded.winner === "you" ? "You" : "Bot";
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.drew) return `${result.drew.player === "you" ? "You" : "Bot"} drew`;
  if (result.passed) return `${result.passed.player === "you" ? "You" : "Bot"} passed`;
  return "";
}

export default function BotMatchScreen({ onBack }: BotMatchScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [match, setMatch] = useState<BotMatchState>(() => createBotMatch(60));
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [toast, setToast] = useState("");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("standard");
  const [lastBotChoice, setLastBotChoice] = useState<BotChoice | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDebug = typeof window !== "undefined" && window.localStorage.getItem("BOT_DEBUG") === "1";

  const [uiTheme, setUiTheme] = useState<"green" | "brown">(() => {
    if (typeof window === "undefined") return "green";
    const stored = window.localStorage.getItem("racehorse_ui_theme");
    return stored === "brown" ? "brown" : "green";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("racehorse_ui_theme", uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (rootRef.current) {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      // no-op
    }
  };

  const pushToast = (msg: string, ms = 1400) => {
    if (!msg) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(""), ms);
  };

  const userLegalMoves = useMemo(() => {
    return match.currentPlayer === "you" ? getLegalMoves(match, "you") : [];
  }, [match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);

  const applyAndNotify = (result: BotActionResult) => {
    setMatch(result.state);
    const msg = toastFromResult(result);
    if (msg) pushToast(msg);
  };

  const onPositionClick = (position: any) => {
    if (match.currentPlayer !== "you" || !selectedTile || match.handOver || match.gameOver) return;
    const move = findMoveForSelection(userPlayMoves, selectedTile, position);
    if (!move) return;
    const result = applyPlayMove(match, "you", move);
    setSelectedTile(null);
    applyAndNotify(result);
  };

  useEffect(() => {
    if (match.currentPlayer !== "bot" || match.handOver || match.gameOver) return;

    const timer = setTimeout(() => {
      let working = match;
      let result: BotActionResult | null = null;
      let chosen: BotChoice | null = null;

      const botPlayable = asPlayMoves(getLegalMoves(working, "bot"));
      if (botPlayable.length === 0) {
        const drawPass = drawUntilPlayableOrEmpty(working, "bot");
        working = drawPass.state;
        const afterDraw = asPlayMoves(getLegalMoves(working, "bot"));
        if (afterDraw.length === 0) {
          result = drawPass;
        } else {
          chosen = chooseBotMove(working, difficulty);
          result = applyPlayMove(working, "bot", chosen?.move ?? afterDraw[0]);
        }
      } else {
        chosen = chooseBotMove(working, difficulty);
        result = applyPlayMove(working, "bot", chosen?.move ?? botPlayable[0]);
      }

      if (chosen) setLastBotChoice(chosen);
      if (result) {
        setSelectedTile(null);
        applyAndNotify(result);
      }
    }, 560);

    return () => clearTimeout(timer);
  }, [match, difficulty]);

  useEffect(() => {
    if (!match.handOver || match.gameOver) return;
    const timer = setTimeout(() => {
      setSelectedTile(null);
      setLastBotChoice(null);
      setMatch(prev => (prev.handOver && !prev.gameOver ? startNextBotHand(prev) : prev));
    }, 1700);
    return () => clearTimeout(timer);
  }, [match.handOver, match.gameOver]);

  useEffect(() => {
    if (match.currentPlayer !== "you" || match.handOver || match.gameOver) return;
    if (userPlayMoves.length > 0) return;
    const result = drawUntilPlayableOrEmpty(match, "you");
    setSelectedTile(null);
    applyAndNotify(result);
  }, [match, userPlayMoves.length]);

  const handActive = !match.handOver && !match.gameOver;
  const botTurn = match.currentPlayer === "bot" && handActive;
  const turnLabel = match.handOver
    ? (match.gameOver
      ? (match.winnerId === "you" ? "You win the match" : "Bot wins the match")
      : "Hand complete")
    : (botTurn ? "Bot thinking" : "Your move");

  const openEnds = getDisplayOpenEnds(match);

  return (
    <div ref={rootRef} className={`screen game-screen walnut-live theme-${uiTheme} bot-match-screen`}>
      {toast && <div className="toast">{toast}</div>}

      <div className="wl-top-rail" data-ui="hud">
        <div className={`wl-player-pill ${botTurn ? "is-active" : ""}`}>
          <div className="wl-pill-top">
            <span className="wl-player-label">Bot</span>
            <span className="wl-tiles-chip">
              <span className="wl-tiles-count">{match.players.bot.hand.length}</span>
              <span className="wl-tiles-text">tiles</span>
            </span>
          </div>
          <span className="wl-player-score">{match.players.bot.score}</span>
        </div>
        <div className="wl-center-status">
          <span className={`wl-turn-label ${botTurn ? "opp-turn" : "your-turn"}`}>{turnLabel}</span>
          <span className="wl-room-code">Hand {match.handNumber} · Offline vs Bot</span>
        </div>
        <div className={`wl-player-pill is-you ${!botTurn && handActive ? "is-active" : ""}`}>
          <span className="wl-player-label">You</span>
          <span className="wl-player-score">{match.players.you.score}</span>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          <Board
            board={match.board}
            legalMoves={userPlayMoves}
            selectedTile={selectedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div className="hand-container">
              {match.players.you.hand.map((tile, idx) => {
                const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                const playable = userPlayMoves.some(m => m.tile && tileEquals(m.tile, tile));
                return (
                  <DominoTile
                    key={`bot-hand-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={92}
                    selected={selected}
                    highlight={playable}
                    disabled={!handActive || botTurn}
                    onClick={() => {
                      if (!handActive || botTurn) return;
                      if (!playable) return;
                      setSelectedTile(tile);
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="tray-right">
            <div className="tray-controls">
              <div className="tray-icon-row">
                <button
                  className="btn text icon-btn fullscreen-btn"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  <FullscreenIcon isFullscreen={isFullscreen} />
                </button>
              </div>
              <label className="bot-difficulty">
                <span>Bot</span>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}>
                  <option value="casual">Casual</option>
                  <option value="standard">Standard</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <button className="btn text compact" onClick={() => setUiTheme(prev => (prev === "green" ? "brown" : "green"))}>
                Color
              </button>
              <button
                className="btn text compact"
                onClick={() => {
                  setSelectedTile(null);
                  setLastBotChoice(null);
                  setMatch(createBotMatch(60));
                }}
              >
                New Match
              </button>
              <button className="btn text leave-btn compact" onClick={onBack}>
                Home
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDebug && (
        <aside className="bot-debug-panel">
          <div><strong>Bot hand:</strong> {match.players.bot.hand.map(t => `[${t.low}|${t.high}]`).join(" ")}</div>
          <div><strong>Open ends:</strong> {openEnds.join(", ") || "(none)"}</div>
          {lastBotChoice && (
            <div>
              <strong>Last bot eval:</strong>{" "}
              {`score=${lastBotChoice.score.toFixed(2)} `}
              {`immediate=${lastBotChoice.breakdown.immediate} `}
              {`mobility=${lastBotChoice.breakdown.mobility} `}
              {`denial=${lastBotChoice.breakdown.denial.toFixed(1)} `}
              {`risk=${lastBotChoice.breakdown.replyRisk}`}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
