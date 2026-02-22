import { useMemo, useState } from "react";
import type { BoardState, Tile } from "../types";
import { getDailyPuzzleByDateSeed, upsertDailyPuzzle } from "./api";
import { validatePuzzle } from "./validator";
import type { CuratedDailyPuzzle, PuzzleValidationResult } from "./types";
import "./dailyPuzzle.css";

interface DailyPuzzleAdminScreenProps {
  onBack: () => void;
}

function todaySeed(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DailyPuzzleAdminScreen({ onBack }: DailyPuzzleAdminScreenProps) {
  const [dateValue, setDateValue] = useState(todaySeed);
  const [title, setTitle] = useState("Daily Puzzle");
  const [maxMoves, setMaxMoves] = useState(4);
  const [targetScore, setTargetScore] = useState(3);
  const [boardJson, setBoardJson] = useState<string>("{\n  \"mainLine\": [],\n  \"leftEnd\": 0,\n  \"rightEnd\": 0,\n  \"leftEndIsDouble\": false,\n  \"rightEndIsDouble\": false,\n  \"hubDoubles\": []\n}");
  const [handJson, setHandJson] = useState<string>("[]");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;

  const canSave = useMemo(
    () => dateValue.trim().length === 10 && Number.isFinite(maxMoves) && Number.isFinite(targetScore),
    [dateValue, maxMoves, targetScore]
  );

  const parseDraft = (): { board: BoardState; hand: Tile[] } => {
    const board = JSON.parse(boardJson) as BoardState;
    const hand = JSON.parse(handJson) as Tile[];
    if (!Array.isArray(hand)) throw new Error("starting_hand JSON must be an array.");
    return { board, hand };
  };

  const runValidation = (puzzle: CuratedDailyPuzzle) => {
    const result = validatePuzzle(puzzle);
    setValidation(result);
    if (result.solvable) {
      setMessage(`Valid puzzle. bestScore=${result.bestScore}, hasScoringMove=${result.hasScoringMove}`);
      setError(null);
    } else {
      setError(`Invalid puzzle: ${result.reason}. bestScore=${result.bestScore}`);
    }
  };

  const handleLoad = async () => {
    setError(null);
    setMessage(null);
    try {
      const existing = await getDailyPuzzleByDateSeed(dateValue);
      if (!existing) {
        setMessage("No puzzle exists for that date yet.");
        setValidation(null);
        return;
      }

      setTitle(existing.title);
      setMaxMoves(existing.maxMoves);
      setTargetScore(existing.targetScore);
      setBoardJson(JSON.stringify(existing.startingBoard, null, 2));
      setHandJson(JSON.stringify(existing.startingHand, null, 2));
      runValidation(existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load puzzle.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const parsed = parseDraft();
      await upsertDailyPuzzle({
        puzzleDate: dateValue,
        title,
        maxMoves,
        targetScore,
        startingBoard: parsed.board,
        startingHand: parsed.hand,
      });

      const saved = await getDailyPuzzleByDateSeed(dateValue);
      if (!saved) throw new Error("Saved puzzle but failed to reload.");
      runValidation(saved);
      setMessage("Puzzle saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save puzzle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <div className="screen lobby-screen mode-home-screen">
        <div className="mode-home-glow" aria-hidden="true" />
        <div className="card lobby-card mode-card daily-admin-card">
          <p className="lobby-kicker">Racehorse Dominoes</p>
          <h2>Admin: Daily Puzzles</h2>
          <p className="lobby-server">Admin email: {adminEmail || "(VITE_ADMIN_EMAIL not set)"}</p>

          <div className="daily-admin-grid">
            <label>
              Date
              <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
            </label>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Max Moves
              <input type="number" min={1} value={maxMoves} onChange={(e) => setMaxMoves(Number(e.target.value))} />
            </label>
            <label>
              Target Score
              <input type="number" min={1} value={targetScore} onChange={(e) => setTargetScore(Number(e.target.value))} />
            </label>
          </div>

          <label className="daily-admin-textarea">
            starting_board JSON
            <textarea rows={10} value={boardJson} onChange={(e) => setBoardJson(e.target.value)} />
          </label>

          <label className="daily-admin-textarea">
            starting_hand JSON
            <textarea rows={6} value={handJson} onChange={(e) => setHandJson(e.target.value)} />
          </label>

          {validation && (
            <div className={`daily-admin-validation ${validation.solvable ? "ok" : "bad"}`}>
              solvable={String(validation.solvable)} · bestScore={validation.bestScore} · hasScoringMove={String(validation.hasScoringMove)} · explored={validation.exploredStates}
            </div>
          )}

          {error && <p className="auth-inline-error">{error}</p>}
          {message && !error && <p className="lobby-server">{message}</p>}

          <div className="daily-admin-actions">
            <button className="mode-inline-btn" onClick={handleLoad}>Load Date</button>
            <button className="mode-inline-btn" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
    </div>
  );
}
