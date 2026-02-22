import { useEffect, useMemo, useRef, useState } from "react";
import { Board, DominoTile, ScoreTrackOverlay } from "../components";
import type { Move, Tile } from "../types";
import {
  applyPlayMove,
  createBotMatch,
  drawUntilPlayableOrEmpty,
  getDisplayOpenEnds,
  getLegalMoves,
  startNextBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotMatchState,
} from "./botEngine";
import { chooseBotMove, type BotChoice, type BotDifficulty } from "./botHeuristics";
import { getLocalDateKey } from "../dailyPuzzle/date";
import "./botMatch.css";

interface BotMatchScreenProps {
  onBack: () => void;
}

interface BotHandReveal {
  winner: "you" | "bot" | null;
  reason: "domino" | "blocked";
  pointsAwarded: number;
  loserPips: number;
  calcText: string;
  botRemainingTiles: Tile[];
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
    return `${result.scored.player === "you" ? "You" : "Bot"} scored +${result.scored.points}`;
  }
  if (result.handEnded) {
    const winner = result.handEnded.winner === "you" ? "You" : "Bot";
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.drew) return `${result.drew.player === "you" ? "You" : "Bot"} drew`;
  if (result.passed) return `${result.passed.player === "you" ? "You" : "Bot"} passed`;
  return "";
}

export default function BotMatchScreen({ onBack }: BotMatchScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dealSize, setDealSize] = useState<BotDealSize>(7);
  const [match, setMatch] = useState<BotMatchState>(() => createBotMatch(60, 7));
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [toast, setToast] = useState("");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("standard");
  const [lastBotChoice, setLastBotChoice] = useState<BotChoice | null>(null);
  const [handReveal, setHandReveal] = useState<BotHandReveal | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDebug = typeof window !== "undefined" && window.localStorage.getItem("BOT_DEBUG") === "1";
  const showDevCapture = true;

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

  const copyAsDailyPuzzleJson = async () => {
    if (!match.board) {
      pushToast("Open the hand first to capture a puzzle state");
      return;
    }

    const payload = {
      title: "Captured Puzzle",
      puzzle_date: getLocalDateKey(),
      puzzle_type: "one_turn_high_score",
      max_moves: 1,
      target_score: 1,
      deal_size: match.dealSize,
      starting_board: match.board,
      starting_hand: match.players.you.hand,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      pushToast("Copied puzzle JSON");
    } catch {
      pushToast("Copy failed");
    }
  };

  const startFreshMatch = () => {
    setSelectedTile(null);
    setLastBotChoice(null);
    setHandReveal(null);
    setMatch(createBotMatch(60, dealSize));
  };

  const userLegalMoves = useMemo(() => {
    return match.currentPlayer === "you" ? getLegalMoves(match, "you") : [];
  }, [match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);

  const applyAndNotify = (result: BotActionResult) => {
    setMatch(result.state);
    if (result.handEnded) {
      setHandReveal({
        winner: result.handEnded.winner,
        reason: result.handEnded.reason,
        pointsAwarded: result.handEnded.pointsAwarded,
        loserPips: result.handEnded.loserPips,
        calcText: result.handEnded.calcText,
        botRemainingTiles: result.state.players.bot.hand,
      });
    }
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
    }, 760);

    return () => clearTimeout(timer);
  }, [match, difficulty]);

  useEffect(() => {
    if (!handReveal || match.gameOver) return;
    const timer = setTimeout(() => {
      setSelectedTile(null);
      setLastBotChoice(null);
      setHandReveal(null);
      setMatch(prev => (prev.handOver && !prev.gameOver ? startNextBotHand(prev) : prev));
    }, 4200);
    return () => clearTimeout(timer);
  }, [handReveal, match.gameOver]);

  useEffect(() => {
    if (match.currentPlayer !== "you" || match.handOver || match.gameOver) return;
    if (userPlayMoves.length > 0) return;
    const result = drawUntilPlayableOrEmpty(match, "you");
    setSelectedTile(null);
    applyAndNotify(result);
  }, [match, userPlayMoves.length]);

  const handActive = !match.handOver && !match.gameOver;
  const botTurn = match.currentPlayer === "bot" && handActive;
  const handTileSize = match.dealSize === 14 ? 84 : 92;
  const handScrollable = match.dealSize === 14;
  const turnLabel = match.handOver
    ? (match.gameOver
      ? (match.winnerId === "you" ? "You win the match" : "Bot wins the match")
      : "Hand complete")
    : (botTurn ? "Bot thinking" : "Your move");

  const openEnds = getDisplayOpenEnds(match);

  return (
    <div ref={rootRef} className={`screen game-screen walnut-live theme-${uiTheme} bot-match-screen`}>
      <ScoreTrackOverlay
        open={scoreTrackOpen}
        onClose={() => setScoreTrackOpen(false)}
        target={60}
        players={[
          { label: "Bot", score: match.players.bot.score, tone: "opp" },
          { label: "You", score: match.players.you.score, tone: "you" },
        ]}
      />
      {toast && <div className="toast">{toast}</div>}
      {handReveal && !match.gameOver && (
        <div className="hand-reveal-overlay">
          <div className="hand-reveal-backdrop" />
          <div className="hand-reveal-modal">
            <div className="hand-reveal-card">
              <h3>Hand Over</h3>
              <p className="reveal-points">
                {handReveal.winner === "you" ? "You" : "Bot"} +{handReveal.pointsAwarded}
                {" · "}
                {handReveal.reason} ({handReveal.calcText})
              </p>
              <p className="reveal-label">Bot remaining tiles</p>
              <div className="reveal-tiles">
                {handReveal.botRemainingTiles.map((tile, idx) => (
                  <DominoTile key={`bot-reveal-${idx}-${tile.low}-${tile.high}`} tile={tile} size={34} className="hand-over-tile" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {match.gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-card bot-victory-card">
            <h2 className="victory-title">{match.winnerId === "you" ? "Champion!" : "Bot Wins"}</h2>
            <p className="bot-victory-meta">
              Final hand {match.handNumber} · {match.dealSize}-tile mode
            </p>
            <div className="final-scores">
              <div className={`final-score ${match.winnerId === "you" ? "winner" : ""}`}>
                <span className="player-name">You</span>
                <span className="score">{match.players.you.score}</span>
                {match.winnerId === "you" && <span className="crown">👑</span>}
              </div>
              <div className={`final-score ${match.winnerId === "bot" ? "winner" : ""}`}>
                <span className="player-name">Bot</span>
                <span className="score">{match.players.bot.score}</span>
                {match.winnerId === "bot" && <span className="crown">👑</span>}
              </div>
            </div>
            <div className="bot-victory-actions">
              <button className="btn primary victory-cta" onClick={startFreshMatch}>
                New Match
              </button>
              <button className="btn text compact" onClick={onBack}>
                Home
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="wl-top-rail bot-top-rail" data-ui="hud">
        <button
          type="button"
          className={`wl-player-pill wl-player-pill-btn ${botTurn ? "is-active" : ""}`}
          onClick={() => setScoreTrackOpen(true)}
          aria-label="Open score track"
        >
          <div className="wl-pill-top">
            <span className="wl-player-label">Bot</span>
            <span className="wl-tiles-chip">
              <span className="wl-tiles-count">{match.players.bot.hand.length}</span>
              <span className="wl-tiles-text">tiles</span>
            </span>
          </div>
          <span className="wl-player-score">{match.players.bot.score}</span>
        </button>
        <div className="wl-center-status">
          <span className={`wl-turn-label ${botTurn ? "opp-turn" : "your-turn"}`}>{turnLabel}</span>
          <span className="wl-room-code">
            Hand {match.handNumber} · Offline vs Bot · {match.dealSize}-tile
            {match.dealSize === 14 ? " (no boneyard)" : ""}
          </span>
        </div>
        <div className="bot-top-controls bot-top-controls-inline">
          <div className="tray-controls bot-tray-controls">
            <button
              className="btn text icon-btn fullscreen-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
            <label className="bot-difficulty bot-chip-control">
              <span>Bot</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}>
                <option value="casual">Casual</option>
                <option value="standard">Standard</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label className="bot-difficulty bot-chip-control">
              <span>Deal</span>
              <select
                value={dealSize}
                onChange={(e) => {
                  const nextDeal = Number(e.target.value) as BotDealSize;
                  setDealSize(nextDeal);
                  setSelectedTile(null);
                  setLastBotChoice(null);
                  setHandReveal(null);
                  setMatch(createBotMatch(60, nextDeal));
                }}
              >
                <option value={7}>7 tiles + boneyard</option>
                <option value={14}>14 tiles (no boneyard)</option>
              </select>
            </label>
            <button className="btn text compact bot-chip-control" onClick={() => setUiTheme(prev => (prev === "green" ? "brown" : "green"))}>
              Color
            </button>
            <button className="btn text compact bot-chip-control" onClick={startFreshMatch}>
              New Match
            </button>
            {showDevCapture && (
              <button className="btn text compact bot-chip-control" onClick={copyAsDailyPuzzleJson}>
                Copy Puzzle JSON
              </button>
            )}
            <button className="btn text leave-btn compact bot-chip-control" onClick={onBack}>
              Home
            </button>
          </div>
        </div>
        <button
          type="button"
          className={`wl-player-pill wl-player-pill-btn is-you ${!botTurn && handActive ? "is-active" : ""}`}
          onClick={() => setScoreTrackOpen(true)}
          aria-label="Open score track"
        >
          <span className="wl-player-label">You</span>
          <span className="wl-player-score">{match.players.you.score}</span>
        </button>
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
              <div className={`hand-container ${handScrollable ? "is-scrollable" : ""}`}>
              {match.players.you.hand.map((tile, idx) => {
                const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                const playable = userPlayMoves.some(m => m.tile && tileEquals(m.tile, tile));
                return (
                  <DominoTile
                    key={`bot-hand-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={handTileSize}
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
