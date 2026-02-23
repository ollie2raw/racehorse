import { useMemo, useState } from "react";
import type { BoardState, PlacedTile, Tile, TileOrientation } from "../types";
import { getDailyPuzzleByDateSeed, getLocalDateKey, normalizeDateInputToLocalKey, upsertDailyPuzzle } from "./api";
import { validatePuzzle } from "./validator";
import type { CuratedDailyPuzzle, DailyPuzzleType, PuzzleValidationResult } from "./types";
import "./dailyPuzzle.css";

interface DailyPuzzleAdminScreenProps {
  onBack: () => void;
}

export default function DailyPuzzleAdminScreen({ onBack }: DailyPuzzleAdminScreenProps) {
  const [dateValue, setDateValue] = useState(getLocalDateKey());
  const [title, setTitle] = useState("Daily Puzzle");
  const [maxMoves, setMaxMoves] = useState(4);
  const [targetScore, setTargetScore] = useState(3);
  const [puzzleType, setPuzzleType] = useState<DailyPuzzleType>("one_turn_high_score");
  const [dealSize, setDealSize] = useState(7);
  const [boardJson, setBoardJson] = useState<string>("{\n  \"mainLine\": [],\n  \"leftEnd\": 0,\n  \"rightEnd\": 0,\n  \"leftEndIsDouble\": false,\n  \"rightEndIsDouble\": false,\n  \"hubDoubles\": []\n}");
  const [handJson, setHandJson] = useState<string>("[]");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [pasteJson, setPasteJson] = useState("");

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;

  const canSave = useMemo(
    () =>
      dateValue.trim().length === 10 &&
      Number.isFinite(maxMoves) &&
      Number.isFinite(targetScore) &&
      Number.isFinite(dealSize) &&
      dealSize > 0 &&
      (puzzleType === "one_turn_high_score" || puzzleType === "reach_target"),
    [dateValue, maxMoves, targetScore, dealSize, puzzleType]
  );

  const normalizeTile = (value: unknown, fieldName: string): Tile => {
    // Accept [a,b]
    if (Array.isArray(value)) {
      if (value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
        throw new Error(`${fieldName} must be a tile tuple [a,b] or object {low,high}.`);
      }
      const a = Number(value[0]);
      const b = Number(value[1]);
      return { low: Math.min(a, b), high: Math.max(a, b) };
    }

    // Accept {low,high} and also legacy {left,right}
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      const lowRaw = rec.low ?? rec.left;
      const highRaw = rec.high ?? rec.right;
      if (!Number.isFinite(lowRaw) || !Number.isFinite(highRaw)) {
        throw new Error(`${fieldName} must be a tile tuple [a,b] or object {low,high}.`);
      }
      const low = Number(lowRaw);
      const high = Number(highRaw);
      return { low: Math.min(low, high), high: Math.max(low, high) };
    }

    throw new Error(`${fieldName} must be a tile tuple [a,b] or object {low,high}.`);
  };

  const normalizePlacement = (value: unknown, fieldName: string): PlacedTile => {
    // placement form: { tile: ..., orientation: ... }
    if (value && typeof value === "object" && "tile" in (value as Record<string, unknown>)) {
      const rec = value as Record<string, unknown>;
      const tile = normalizeTile(rec.tile, `${fieldName}.tile`);
      const orientation = typeof rec.orientation === "string"
        ? (rec.orientation as TileOrientation)
        : "horizontal-normal";
      return { tile, orientation };
    }

    // bare tile form gets wrapped automatically
    return {
      tile: normalizeTile(value, fieldName),
      orientation: "horizontal-normal",
    };
  };

  const endpointFromPlacement = (placement: PlacedTile, side: "left" | "right"): number => {
    const { tile, orientation } = placement;
    if (tile.low === tile.high) return tile.high;
    if (orientation === "horizontal-flipped" || orientation === "vertical-flipped") {
      return side === "left" ? tile.high : tile.low;
    }
    return side === "left" ? tile.low : tile.high;
  };

  const normalizeHubDoubles = (rawHubDoubles: unknown): BoardState["hubDoubles"] => {
    if (!Array.isArray(rawHubDoubles)) return [];
    return rawHubDoubles.map((hub, hubIdx) => {
      if (!hub || typeof hub !== "object") {
        throw new Error(`starting_board.hubDoubles[${hubIdx}] must be an object.`);
      }
      const rec = hub as Record<string, unknown>;
      const rawBranches = Array.isArray(rec.branches) ? rec.branches : [];
      const branches = rawBranches.map((branch, branchIdx) => {
        if (!branch || typeof branch !== "object") {
          throw new Error(`starting_board.hubDoubles[${hubIdx}].branches[${branchIdx}] must be an object.`);
        }
        const branchRec = branch as Record<string, unknown>;
        const rawTiles = Array.isArray(branchRec.tiles) ? branchRec.tiles : [];
        const tiles = rawTiles.map((tileValue, tileIdx) =>
          normalizePlacement(tileValue, `starting_board.hubDoubles[${hubIdx}].branches[${branchIdx}].tiles[${tileIdx}]`)
        );
        return {
          ...branchRec,
          tiles,
        };
      });
      return {
        ...rec,
        branches,
      } as BoardState["hubDoubles"][number];
    });
  };

  const parseDraft = (): { board: BoardState; hand: Tile[] } => {
    let parsedBoard: unknown;
    let parsedHand: unknown;
    try {
      parsedBoard = JSON.parse(boardJson);
    } catch {
      throw new Error("starting_board JSON is not valid JSON.");
    }
    try {
      parsedHand = JSON.parse(handJson);
    } catch {
      throw new Error("starting_hand JSON is not valid JSON.");
    }

    if (!parsedBoard || typeof parsedBoard !== "object") {
      throw new Error("starting_board JSON must be an object.");
    }
    if (!Array.isArray(parsedHand)) {
      throw new Error("starting_hand JSON must be an array.");
    }

    const hand = parsedHand.map((entry, idx) => normalizeTile(entry, `starting_hand[${idx}]`));

    const boardRec = parsedBoard as Record<string, unknown>;
    if (!Array.isArray(boardRec.mainLine)) {
      throw new Error("mainLine must be placements with { tile:{low,high}, orientation } (bare tiles are accepted and will be wrapped).");
    }

    const mainLine = boardRec.mainLine.map((entry, idx) =>
      normalizePlacement(
        entry,
        `starting_board.mainLine[${idx}]`
      )
    );

    if (mainLine.length === 0) {
      throw new Error("mainLine must be placements with { tile:{low,high}, orientation } (bare tiles are accepted and will be wrapped).");
    }

    const leftEnd = Number.isFinite(boardRec.leftEnd)
      ? Number(boardRec.leftEnd)
      : endpointFromPlacement(mainLine[0], "left");
    const rightEnd = Number.isFinite(boardRec.rightEnd)
      ? Number(boardRec.rightEnd)
      : endpointFromPlacement(mainLine[mainLine.length - 1], "right");
    const leftEndIsDouble = typeof boardRec.leftEndIsDouble === "boolean"
      ? boardRec.leftEndIsDouble
      : mainLine[0].tile.low === mainLine[0].tile.high;
    const rightEndIsDouble = typeof boardRec.rightEndIsDouble === "boolean"
      ? boardRec.rightEndIsDouble
      : mainLine[mainLine.length - 1].tile.low === mainLine[mainLine.length - 1].tile.high;

    const board: BoardState = {
      mainLine,
      leftEnd,
      rightEnd,
      leftEndIsDouble,
      rightEndIsDouble,
      hubDoubles: normalizeHubDoubles(boardRec.hubDoubles),
    };

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

  const handlePasteCaptured = () => {
    setError(null);
    setMessage(null);
    try {
      const raw = JSON.parse(pasteJson);
      if (raw.puzzle_date) setDateValue(raw.puzzle_date);
      if (raw.title) setTitle(raw.title);
      if (raw.puzzle_type) setPuzzleType(raw.puzzle_type as DailyPuzzleType);
      if (Number.isFinite(raw.max_moves)) setMaxMoves(raw.max_moves);
      if (Number.isFinite(raw.target_score)) setTargetScore(raw.target_score);
      if (Number.isFinite(raw.deal_size)) setDealSize(raw.deal_size);
      if (raw.starting_board) setBoardJson(JSON.stringify(raw.starting_board, null, 2));
      if (raw.starting_hand) setHandJson(JSON.stringify(raw.starting_hand, null, 2));
      setMessage("Captured JSON loaded. Review and Save.");
    } catch {
      setError("Invalid JSON. Paste the full output from Copy Puzzle JSON.");
    }
  };

  const handleLoad = async () => {
    setError(null);
    setMessage(null);
    try {
      const canonicalDate = normalizeDateInputToLocalKey(dateValue);
      setDateValue(canonicalDate);
      // eslint-disable-next-line no-console
      console.log("[DailyPuzzleAdmin] load", { canonicalDate });
      const existing = await getDailyPuzzleByDateSeed(canonicalDate);
      if (!existing) {
        setMessage("No puzzle exists for that date yet.");
        setValidation(null);
        return;
      }

      setTitle(existing.title);
      setMaxMoves(existing.maxMoves);
      setTargetScore(existing.targetScore);
      setPuzzleType(existing.puzzleType ?? "one_turn_high_score");
      setDealSize(existing.dealSize ?? 7);
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
      const canonicalDate = normalizeDateInputToLocalKey(dateValue);
      setDateValue(canonicalDate);
      const parsed = parseDraft();
      const draftPuzzle: CuratedDailyPuzzle = {
        id: "draft",
        puzzleDate: canonicalDate,
        title,
        maxMoves,
        targetScore,
        puzzleType,
        dealSize,
        startingBoard: parsed.board,
        startingHand: parsed.hand,
      };
      const draftValidation = validatePuzzle(draftPuzzle);
      setValidation(draftValidation);
      if (!draftValidation.solvable) {
        setError(
          `Cannot save puzzle: ${draftValidation.reason}. bestScore=${draftValidation.bestScore}, hasScoringMove=${draftValidation.hasScoringMove}, explored=${draftValidation.exploredStates}`
        );
        return;
      }

      await upsertDailyPuzzle({
        puzzleDate: canonicalDate,
        title,
        maxMoves,
        targetScore,
        puzzleType,
        dealSize,
        startingBoard: parsed.board,
        startingHand: parsed.hand,
      });

      // eslint-disable-next-line no-console
      console.log("[DailyPuzzleAdmin] save", { canonicalDate });
      const saved = await getDailyPuzzleByDateSeed(canonicalDate);
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
            <label>
              Puzzle Type
              <select value={puzzleType} onChange={(e) => setPuzzleType(e.target.value as DailyPuzzleType)}>
                <option value="one_turn_high_score">High Score (1 move)</option>
                <option value="reach_target">Reach Target (legacy)</option>
              </select>
            </label>
            <label>
              Deal Size
              <input type="number" min={1} value={dealSize} onChange={(e) => setDealSize(Number(e.target.value))} />
            </label>
          </div>

          <label className="daily-admin-textarea">
            Paste Captured Puzzle JSON
            <textarea
              rows={5}
              value={pasteJson}
              onChange={(e) => setPasteJson(e.target.value)}
              placeholder='Paste output from "Copy Puzzle JSON" button here...'
            />
          </label>
          <button className="mode-inline-btn" onClick={handlePasteCaptured}>Load from Capture</button>

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
