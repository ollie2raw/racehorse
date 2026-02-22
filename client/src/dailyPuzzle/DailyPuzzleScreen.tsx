import { useEffect, useMemo, useState } from "react";
import { Board, DominoTile } from "../components";
import { applyPlayMove, getDisplayOpenEnds, getLegalMoves } from "../bot/botEngine";
import type { Move, Tile } from "../types";
import { getDailyPuzzleForDate, getLocalDateKey } from "./api";
import { createPuzzleMatchState, validatePuzzle } from "./validator";
import type { CuratedDailyPuzzle, PuzzleValidationResult } from "./types";
import "./dailyPuzzle.css";

interface DailyPuzzleScreenProps {
  onBack: () => void;
}

type PlayStatus = "IN_PROGRESS" | "SOLVED" | "FAILED";

interface DailyProgress {
  attempts: number;
  bestMoves: number | null;
  lastResult: PlayStatus | null;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function progressKey(dateSeed: string): string {
  return `dailyPuzzle:${dateSeed}`;
}

function readProgress(dateSeed: string): DailyProgress {
  if (typeof window === "undefined") {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
  try {
    const raw = window.localStorage.getItem(progressKey(dateSeed));
    if (!raw) return { attempts: 0, bestMoves: null, lastResult: null };
    const parsed = JSON.parse(raw) as DailyProgress;
    return {
      attempts: Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      bestMoves: typeof parsed.bestMoves === "number" ? parsed.bestMoves : null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
}

function writeProgress(dateSeed: string, progress: DailyProgress): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(progressKey(dateSeed), JSON.stringify(progress));
}

export default function DailyPuzzleScreen({ onBack }: DailyPuzzleScreenProps) {
  const localDateKey = useMemo(() => getLocalDateKey(), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [puzzle, setPuzzle] = useState<CuratedDailyPuzzle | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayStatus>("IN_PROGRESS");
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [lastMovePoints, setLastMovePoints] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [bestMoves, setBestMoves] = useState<number | null>(null);

  const { match, matchError } = useMemo(() => {
    if (!puzzle) return { match: null, matchError: null as string | null };
    try {
      return { match: createPuzzleMatchState(puzzle), matchError: null as string | null };
    } catch (err) {
      return {
        match: null,
        matchError: err instanceof Error ? err.message : "Invalid puzzle board configuration.",
      };
    }
  }, [puzzle]);
  const [runtimeState, setRuntimeState] = useState(match);

  useEffect(() => {
    setRuntimeState(match);
  }, [match]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // eslint-disable-next-line no-console
        console.log("[DailyPuzzle] loading", { localDateKey, timezone });
        const today = await getDailyPuzzleForDate(new Date());
        if (!active) return;
        if (!today) {
          setPuzzle(null);
          setValidation(null);
          setLoading(false);
          return;
        }

        const check = today.puzzleType === "reach_target" ? validatePuzzle(today) : null;
        setPuzzle(today);
        setValidation(check);
        setStatus("IN_PROGRESS");
        setSelectedTile(null);
        setMovesUsed(0);
        setLastMovePoints(0);
        setFinalScore(null);
        setStatusMessage(
          today.puzzleType === "one_turn_high_score"
            ? "High Score — 1 move."
            : `Score Attack — Reach ${today.targetScore} in ${today.maxMoves} moves.`
        );

        const progress = readProgress(today.puzzleDate);
        const nextAttempts = progress.attempts + 1;
        writeProgress(today.puzzleDate, { ...progress, attempts: nextAttempts });
        setAttempts(nextAttempts);
        setBestMoves(progress.bestMoves);
      } catch (err) {
        if (!active) return;
        // eslint-disable-next-line no-console
        console.error("[DailyPuzzle] load error", { localDateKey, timezone, err });
        setLoadError(err instanceof Error ? err.message : "Failed to load daily puzzle.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [localDateKey, timezone]);

  const legalMoves = useMemo(() => {
    if (!runtimeState || status !== "IN_PROGRESS") return [] as Move[];
    return getLegalMoves(runtimeState, "you").filter((move) => move.type === "play");
  }, [runtimeState, status]);

  const openEnds = useMemo(() => {
    if (!runtimeState) return [] as number[];
    return getDisplayOpenEnds(runtimeState);
  }, [runtimeState]);

  const resetAttempt = () => {
    if (!puzzle) return;
    const start = createPuzzleMatchState(puzzle);
    setRuntimeState(start);
    setStatus("IN_PROGRESS");
    setSelectedTile(null);
    setMovesUsed(0);
    setLastMovePoints(0);
    setFinalScore(null);
    setStatusMessage(
      puzzle.puzzleType === "one_turn_high_score"
        ? "High Score — 1 move."
        : `Score Attack — Reach ${puzzle.targetScore} in ${puzzle.maxMoves} moves.`
    );

    const progress = readProgress(puzzle.puzzleDate);
    const nextAttempts = progress.attempts + 1;
    writeProgress(puzzle.puzzleDate, { ...progress, attempts: nextAttempts });
    setAttempts(nextAttempts);
  };

  const finalizeResult = (nextStatus: PlayStatus, solvedMoves: number | null) => {
    if (!puzzle) return;
    const progress = readProgress(puzzle.puzzleDate);

    if (nextStatus === "SOLVED" && solvedMoves !== null) {
      const nextBest = progress.bestMoves === null ? solvedMoves : Math.min(progress.bestMoves, solvedMoves);
      writeProgress(puzzle.puzzleDate, { ...progress, bestMoves: nextBest, lastResult: nextStatus });
      setBestMoves(nextBest);
    } else {
      writeProgress(puzzle.puzzleDate, { ...progress, lastResult: nextStatus });
    }
  };

  const onPositionClick = (position: Move["position"]) => {
    if (!runtimeState || !puzzle || !selectedTile || status !== "IN_PROGRESS") return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.tile && candidate.position === position && tileEquals(candidate.tile, selectedTile)
    );
    if (!move) return;

    const beforeEnds = getDisplayOpenEnds(runtimeState);
    const result = applyPlayMove(runtimeState, "you", move);
    const nextState = result.state;
    const pointsAwarded = result.scored?.points ?? 0;
    const nextMoves = movesUsed + 1;
    const totalScore = nextState.players.you.score;

    setRuntimeState(nextState);
    setSelectedTile(null);
    setMovesUsed(nextMoves);
    setLastMovePoints(pointsAwarded);

    const afterEnds = getDisplayOpenEnds(nextState);
    // eslint-disable-next-line no-console
    console.log("[DailyPuzzle]", { beforeEnds, afterEnds, pointsAwarded, totalScore });

    if (puzzle.puzzleType === "one_turn_high_score") {
      setFinalScore(pointsAwarded);
      setStatus("SOLVED");
      setStatusMessage(`Final score: ${pointsAwarded}`);
      return;
    }

    if (totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves) {
      setStatus("SOLVED");
      setStatusMessage(`Solved: ${totalScore}/${puzzle.targetScore} in ${nextMoves} moves.`);
      finalizeResult("SOLVED", nextMoves);
      return;
    }

    if (nextMoves >= puzzle.maxMoves && totalScore < puzzle.targetScore) {
      setStatus("FAILED");
      setStatusMessage(`Failed: ${totalScore}/${puzzle.targetScore} after ${nextMoves} moves.`);
      finalizeResult("FAILED", null);
      return;
    }

    if (nextState.currentPlayer !== "you") {
      setStatus("FAILED");
      setStatusMessage("Failed: Turn ended before reaching target score.");
      finalizeResult("FAILED", null);
      return;
    }

    const upcoming = getLegalMoves(nextState, "you").filter((candidate) => candidate.type === "play");
    if (upcoming.length === 0) {
      setStatus("FAILED");
      setStatusMessage("Failed: No legal moves remaining.");
      finalizeResult("FAILED", null);
      return;
    }

    setStatusMessage(`+${pointsAwarded} this move · total ${totalScore}/${puzzle.targetScore}`);
  };

  useEffect(() => {
    if (!puzzle || status !== "IN_PROGRESS" || puzzle.puzzleType !== "one_turn_high_score") return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus("FAILED");
    setStatusMessage("Final score: 0");
  }, [puzzle, status, legalMoves.length]);

  if (loading) {
    return (
      <div className="app">
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card"><h2>Daily Puzzle</h2><p>Loading today’s curated puzzle...</p></div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app">
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card">
            <h2>Daily Puzzle</h2>
            <p className="auth-inline-error">{loadError}</p>
            <p className="lobby-server">Local date key: {localDateKey}</p>
            <p className="lobby-server">Timezone: {timezone}</p>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (matchError) {
    return (
      <div className="app">
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card">
            <h2>Daily Puzzle</h2>
            <p className="auth-inline-error">{matchError}</p>
            <p className="lobby-server">Local date key: {localDateKey}</p>
            <p className="lobby-server">Timezone: {timezone}</p>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (!puzzle || !runtimeState) {
    return (
      <div className="app">
        <div className="screen lobby-screen mode-home-screen">
          <div className="mode-home-glow" aria-hidden="true" />
          <div className="card lobby-card mode-card">
            <h2>Daily Puzzle</h2>
            <p>Today’s puzzle is not posted yet.</p>
            <p className="lobby-server">Local date key: {localDateKey}</p>
            <p className="lobby-server">Timezone: {timezone}</p>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  const solvableWarning = Boolean(validation && !validation.solvable);
  const isOneTurnHighScore = puzzle.puzzleType === "one_turn_high_score";

  return (
    <div className="screen game-screen walnut-live theme-green daily-puzzle-screen">
      <div className="wl-top-rail" data-ui="hud">
        <div className="wl-player-pill is-active">
          <div className="wl-pill-top"><span className="wl-player-label">Daily Puzzle</span></div>
          <span className="wl-player-score">{runtimeState.players.you.score}</span>
        </div>
        <div className="wl-center-status">
          <span className="wl-turn-label your-turn">{puzzle.title}</span>
          <span className="wl-room-code">
            {isOneTurnHighScore
              ? `${puzzle.puzzleDate} · High Score — 1 move · Deal ${puzzle.dealSize}`
              : `${puzzle.puzzleDate} · Type ${puzzle.puzzleType} · Deal ${puzzle.dealSize} · Moves ${movesUsed}/${puzzle.maxMoves} · Target ${puzzle.targetScore}`}
          </span>
        </div>
        <div className="wl-player-pill is-you">
          <span className="wl-player-label">Status</span>
          <span className="wl-player-score" style={{ fontSize: "0.92rem" }}>{status.replace("_", " ")}</span>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          <Board
            board={runtimeState.board}
            legalMoves={legalMoves}
            selectedTile={selectedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
          <div className="daily-puzzle-hud-note">
            {isOneTurnHighScore
              ? `${statusMessage} · Type ${puzzle.puzzleType} · Deal ${puzzle.dealSize} · Last +${lastMovePoints} · Open ends ${openEnds.join(", ")} · Local date key: ${localDateKey} · Timezone: ${timezone}`
              : `${statusMessage} · Type ${puzzle.puzzleType} · Deal ${puzzle.dealSize} · Last +${lastMovePoints} · Open ends ${openEnds.join(", ")} · Attempts ${attempts} · Best moves ${bestMoves ?? "--"} · Local date key: ${localDateKey} · Timezone: ${timezone}`}
          </div>
          {solvableWarning && (
            <>
              <div className="daily-puzzle-warning-banner">
                Puzzle warning: {validation?.reason} (best score {validation?.bestScore}). You can still play this puzzle.
              </div>
              <div className="daily-puzzle-dev-warning">
                Dev: puzzle invalid · solvable={String(validation?.solvable)} · bestScore={validation?.bestScore} · hasScoringMove={String(validation?.hasScoringMove)} · explored={validation?.exploredStates}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div className="hand-container">
              {runtimeState.players.you.hand.map((tile, idx) => {
                const playable = legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile));
                const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                return (
                  <DominoTile
                    key={`daily-curated-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={92}
                    selected={isSelected}
                    highlight={playable && status === "IN_PROGRESS"}
                    disabled={status !== "IN_PROGRESS" || !playable}
                    onClick={() => {
                      if (status !== "IN_PROGRESS" || !playable) return;
                      setSelectedTile(tile);
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="tray-right" data-ui="actions">
            <div className="tray-controls">
              <button className="btn text compact" onClick={resetAttempt}>Play Again</button>
              <button className="btn text compact" onClick={onBack}>Back to Home</button>
            </div>
          </div>
        </div>
      </div>

      {status !== "IN_PROGRESS" && (
        <div className="daily-puzzle-overlay" role="dialog" aria-modal="true">
          <div className="daily-puzzle-modal">
            {isOneTurnHighScore ? (
              <>
                <h3>Final score: {finalScore ?? 0}</h3>
                <p>High Score — 1 move · Deal {puzzle.dealSize}</p>
              </>
            ) : (
              <>
                <h3>{status === "SOLVED" ? `Solved in ${movesUsed} moves` : "No legal moves remaining"}</h3>
                <p>
                  Score {runtimeState.players.you.score}/{puzzle.targetScore} · Max moves {puzzle.maxMoves}
                </p>
              </>
            )}
            <div className="daily-puzzle-modal-actions">
              <button className="mode-inline-btn" onClick={resetAttempt}>Play Again</button>
              <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
