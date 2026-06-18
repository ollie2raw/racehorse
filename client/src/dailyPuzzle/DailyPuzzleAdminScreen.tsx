import { useEffect, useMemo, useState } from 'react';
import type { BoardState, PlacedTile, Tile, TileOrientation } from '../types';
import type { Move, PlacementPosition } from '../types';
import { Board, DominoTile } from '../components';
import { getPlacementTargetsForTile, placeTileOnBoard } from '../bot/botEngine';
import {
  getDailyPuzzleByDateSeed,
  getLocalDateKey,
  normalizeDateInputToLocalKey,
  upsertDailyPuzzle,
} from './api';
import { validatePuzzle } from './validator';
import type { CuratedDailyPuzzle, DailyPuzzleType, PuzzleValidationResult } from './types';
import './dailyPuzzle.css';

interface DailyPuzzleAdminScreenProps {
  onBack: () => void;
}

function tileKey(tile: Tile): string {
  return `${tile.low}-${tile.high}`;
}

function generateDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

export default function DailyPuzzleAdminScreen({ onBack }: DailyPuzzleAdminScreenProps) {
  const [dateValue, setDateValue] = useState(getLocalDateKey());
  const [title, setTitle] = useState('Daily Puzzle');
  const maxMoves = 1;
  const targetScore = 999;
  const puzzleType: DailyPuzzleType = 'one_turn_high_score';
  const dealSize = 7;
  const [boardJson, setBoardJson] = useState<string>(
    '{\n  "mainLine": [],\n  "leftEnd": 0,\n  "rightEnd": 0,\n  "leftEndIsDouble": false,\n  "rightEndIsDouble": false,\n  "hubDoubles": []\n}',
  );
  const [handJson, setHandJson] = useState<string>('[]');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [pasteJson, setPasteJson] = useState('');
  const [builderBoard, setBuilderBoard] = useState<BoardState | null>(null);
  const [builderHand, setBuilderHand] = useState<Tile[]>([]);
  const [selectedBuilderTile, setSelectedBuilderTile] = useState<Tile | null>(null);
  const [tileMode, setTileMode] = useState<'board' | 'hand'>('board');

  useEffect(() => {
    const fallbackBoard = {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
    setBoardJson(JSON.stringify(builderBoard ?? fallbackBoard, null, 2));
    setHandJson(JSON.stringify(builderHand, null, 2));
  }, [builderBoard, builderHand]);

  const canSave = useMemo(
    () => dateValue.trim().length === 10,
    [dateValue],
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
    if (value && typeof value === 'object') {
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
    if (value && typeof value === 'object' && 'tile' in (value as Record<string, unknown>)) {
      const rec = value as Record<string, unknown>;
      const tile = normalizeTile(rec.tile, `${fieldName}.tile`);
      const orientation =
        typeof rec.orientation === 'string'
          ? (rec.orientation as TileOrientation)
          : 'horizontal-normal';
      return { tile, orientation };
    }

    // bare tile form gets wrapped automatically
    return {
      tile: normalizeTile(value, fieldName),
      orientation: 'horizontal-normal',
    };
  };

  const endpointFromPlacement = (placement: PlacedTile, side: 'left' | 'right'): number => {
    const { tile, orientation } = placement;
    if (tile.low === tile.high) return tile.high;
    if (orientation === 'horizontal-flipped' || orientation === 'vertical-flipped') {
      return side === 'left' ? tile.high : tile.low;
    }
    return side === 'left' ? tile.low : tile.high;
  };

  const normalizeHubDoubles = (rawHubDoubles: unknown): BoardState['hubDoubles'] => {
    if (!Array.isArray(rawHubDoubles)) return [];
    return rawHubDoubles.map((hub, hubIdx) => {
      if (!hub || typeof hub !== 'object') {
        throw new Error(`starting_board.hubDoubles[${hubIdx}] must be an object.`);
      }
      const rec = hub as Record<string, unknown>;
      const rawBranches = Array.isArray(rec.branches) ? rec.branches : [];
      const branches = rawBranches.map((branch, branchIdx) => {
        if (branch == null) {
          return null as unknown as BoardState['hubDoubles'][number]['branches'][number];
        }
        if (!branch || typeof branch !== 'object') {
          throw new Error(
            `starting_board.hubDoubles[${hubIdx}].branches[${branchIdx}] must be an object.`,
          );
        }
        const branchRec = branch as Record<string, unknown>;
        const rawTiles = Array.isArray(branchRec.tiles) ? branchRec.tiles : [];
        const tiles = rawTiles.map((tileValue, tileIdx) =>
          normalizePlacement(
            tileValue,
            `starting_board.hubDoubles[${hubIdx}].branches[${branchIdx}].tiles[${tileIdx}]`,
          ),
        );
        return {
          ...branchRec,
          tiles,
        };
      });
      return {
        ...rec,
        branches,
      } as BoardState['hubDoubles'][number];
    });
  };

  const parseDraft = (requireMainLine = true): { board: BoardState | null; hand: Tile[] } => {
    let parsedBoard: unknown;
    let parsedHand: unknown;
    try {
      parsedBoard = JSON.parse(boardJson);
    } catch {
      throw new Error('starting_board JSON is not valid JSON.');
    }
    try {
      parsedHand = JSON.parse(handJson);
    } catch {
      throw new Error('starting_hand JSON is not valid JSON.');
    }

    if (!parsedBoard || typeof parsedBoard !== 'object') {
      throw new Error('starting_board JSON must be an object.');
    }
    if (!Array.isArray(parsedHand)) {
      throw new Error('starting_hand JSON must be an array.');
    }

    const hand = parsedHand.map((entry, idx) => normalizeTile(entry, `starting_hand[${idx}]`));

    const boardRec = parsedBoard as Record<string, unknown>;
    if (!Array.isArray(boardRec.mainLine)) {
      throw new Error(
        'mainLine must be placements with { tile:{low,high}, orientation } (bare tiles are accepted and will be wrapped).',
      );
    }

    const mainLine = boardRec.mainLine.map((entry, idx) =>
      normalizePlacement(entry, `starting_board.mainLine[${idx}]`),
    );

    if (mainLine.length === 0 && requireMainLine) {
      throw new Error(
        'mainLine must be placements with { tile:{low,high}, orientation } (bare tiles are accepted and will be wrapped).',
      );
    }
    if (mainLine.length === 0) {
      return { board: null, hand };
    }

    const leftEnd = Number.isFinite(boardRec.leftEnd)
      ? Number(boardRec.leftEnd)
      : endpointFromPlacement(mainLine[0], 'left');
    const rightEnd = Number.isFinite(boardRec.rightEnd)
      ? Number(boardRec.rightEnd)
      : endpointFromPlacement(mainLine[mainLine.length - 1], 'right');
    const leftEndIsDouble =
      typeof boardRec.leftEndIsDouble === 'boolean'
        ? boardRec.leftEndIsDouble
        : mainLine[0].tile.low === mainLine[0].tile.high;
    const rightEndIsDouble =
      typeof boardRec.rightEndIsDouble === 'boolean'
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
      setMessage(
        `Valid puzzle. bestScore=${result.bestScore}, hasScoringMove=${result.hasScoringMove}`,
      );
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
      if (raw.starting_board) setBoardJson(JSON.stringify(raw.starting_board, null, 2));
      if (raw.starting_hand) setHandJson(JSON.stringify(raw.starting_hand, null, 2));
      setMessage('Captured JSON loaded. Review and Save.');
    } catch {
      setError('Invalid JSON. Paste the full output from Copy Puzzle JSON.');
    }
  };

  const handleLoad = async () => {
    setError(null);
    setMessage(null);
    try {
      const canonicalDate = normalizeDateInputToLocalKey(dateValue);
      setDateValue(canonicalDate);
       
      console.log('[DailyPuzzleAdmin] load', { canonicalDate });
      const existing = await getDailyPuzzleByDateSeed(canonicalDate);
      if (!existing) {
        setMessage('No puzzle exists for that date yet.');
        setValidation(null);
        return;
      }

      setTitle(existing.title);
      setBoardJson(JSON.stringify(existing.startingBoard, null, 2));
      setHandJson(JSON.stringify(existing.startingHand, null, 2));
      setBuilderBoard(existing.startingBoard);
      setBuilderHand(existing.startingHand);
      runValidation(existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load puzzle.');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const canonicalDate = normalizeDateInputToLocalKey(dateValue);
      setDateValue(canonicalDate);
      const parsed = parseDraft(true);
      if (!parsed.board) {
        throw new Error('starting_board cannot be empty. Place at least one tile.');
      }
      const draftPuzzle: CuratedDailyPuzzle = {
        id: 'draft',
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
          `Cannot save puzzle: ${draftValidation.reason}. bestScore=${draftValidation.bestScore}, hasScoringMove=${draftValidation.hasScoringMove}, explored=${draftValidation.exploredStates}`,
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

       
      console.log('[DailyPuzzleAdmin] save', { canonicalDate });
      const saved = await getDailyPuzzleByDateSeed(canonicalDate);
      if (!saved) throw new Error('Saved puzzle but failed to reload.');
      runValidation(saved);
      setMessage('Puzzle saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save puzzle.');
    } finally {
      setSaving(false);
    }
  };

  const copyPuzzleJsonFromBuilder = async () => {
    const payload = {
      puzzle_date: normalizeDateInputToLocalKey(dateValue),
      title,
      puzzle_type: puzzleType,
      max_moves: maxMoves,
      target_score: targetScore,
      deal_size: dealSize,
      starting_board:
        builderBoard ?? {
          mainLine: [],
          leftEnd: 0,
          rightEnd: 0,
          leftEndIsDouble: false,
          rightEndIsDouble: false,
          hubDoubles: [],
        },
      starting_hand: builderHand,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setMessage('Puzzle JSON copied.');
      setError(null);
    } catch {
      setError('Unable to copy to clipboard.');
    }
  };

  const builderPalette = useMemo(() => generateDoubleSixSet(), []);
  const builderPlacementTargets = useMemo(
    () =>
      selectedBuilderTile
        ? getPlacementTargetsForTile(builderBoard, selectedBuilderTile)
        : ([] as PlacementPosition[]),
    [builderBoard, selectedBuilderTile],
  );
  const builderLegalMoves = useMemo(
    () =>
      selectedBuilderTile
        ? builderPlacementTargets.map(
            (position) =>
              ({
                type: 'play',
                tile: selectedBuilderTile,
                position,
              }) as Move,
          )
        : ([] as Move[]),
    [selectedBuilderTile, builderPlacementTargets],
  );

  const onBuilderPositionClick = (position: PlacementPosition) => {
    if (!selectedBuilderTile) return;
    if (!builderPlacementTargets.includes(position)) return;
    setBuilderBoard((prev) => placeTileOnBoard(prev, selectedBuilderTile, position));
    setSelectedBuilderTile(null);
  };

  return (
    <div className="app">
      <div className="screen lobby-screen mode-home-screen">
        <div className="mode-home-glow" aria-hidden="true" />
        <div
          className="card lobby-card mode-card daily-admin-card"
          style={{ padding: '12px 14px', display: 'grid', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p className="lobby-kicker" style={{ margin: 0 }}>Racehorse Dominoes</p>
              <h2 style={{ margin: 0 }}>Puzzle Editor</h2>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {validation && (
                <div className={`daily-admin-validation ${validation.solvable ? 'ok' : 'bad'}`}
                  style={{ margin: 0, padding: '4px 10px', fontSize: '0.82rem' }}>
                  {validation.solvable
                    ? `✓ Valid · best score ${validation.bestScore}`
                    : `✗ Invalid · ${validation.reason}`}
                </div>
              )}
              <button className="mode-inline-btn rh-back-button" onClick={onBack}>← Back to Daily Puzzle</button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '200px minmax(0,1fr)',
            gap: 8,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <label style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: 'rgba(200,220,230,0.7)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Date
              <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)}
                style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(11,18,30,0.7)', color: 'rgba(238,248,243,0.96)', padding: '6px 8px', fontSize: '0.88rem' }} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: '0.78rem', color: 'rgba(200,220,230,0.7)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(11,18,30,0.7)', color: 'rgba(238,248,243,0.96)', padding: '6px 8px', fontSize: '0.88rem' }} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 10, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
                background: 'rgba(5,10,18,0.7)',
                minHeight: 480,
                height: 'calc(100vh - 300px)',
                overflow: 'hidden',
              }}>
                <Board
                  board={builderBoard}
                  legalMoves={builderLegalMoves}
                  selectedTile={selectedBuilderTile}
                  onPositionClick={onBuilderPositionClick}
                  tileSize={54}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="mode-inline-btn" onClick={handlePasteCaptured} style={{ flex: 1 }}>
                  Load from Capture
                </button>
                <button className="mode-inline-btn" onClick={copyPuzzleJsonFromBuilder} style={{ flex: 1 }}>
                  Copy JSON
                </button>
                <button
                  className="mode-inline-btn"
                  onClick={handleSave}
                  disabled={!canSave || saving}
                  style={{
                    flex: 1,
                    background: canSave && !saving ? 'rgba(52,211,153,0.18)' : undefined,
                    borderColor: canSave && !saving ? 'rgba(52,211,153,0.45)' : undefined,
                    color: canSave && !saving ? 'rgba(100,240,180,0.95)' : undefined,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Puzzle'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.14)',
              }}>
                <button
                  type="button"
                  onClick={() => setTileMode('board')}
                  style={{
                    padding: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: tileMode === 'board'
                      ? 'rgba(56,189,248,0.2)'
                      : 'rgba(255,255,255,0.04)',
                    color: tileMode === 'board'
                      ? 'rgba(125,220,255,0.95)'
                      : 'rgba(200,220,230,0.6)',
                    borderRight: '1px solid rgba(255,255,255,0.1)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  Place on Board
                </button>
                <button
                  type="button"
                  onClick={() => setTileMode('hand')}
                  style={{
                    padding: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: tileMode === 'hand'
                      ? 'rgba(52,211,153,0.2)'
                      : 'rgba(255,255,255,0.04)',
                    color: tileMode === 'hand'
                      ? 'rgba(100,240,180,0.95)'
                      : 'rgba(200,220,230,0.6)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  Add to Hand
                </button>
              </div>

              <div>
                <p style={{ margin: '0 0 6px', fontSize: '0.72rem', color: 'rgba(180,200,215,0.6)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {tileMode === 'board' ? 'Select tile -> click board zone' : 'Click tile to add to hand'}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6 }}>
                  {builderPalette.map((tile) => {
                    const isSelected =
                      selectedBuilderTile &&
                      selectedBuilderTile.low === tile.low &&
                      selectedBuilderTile.high === tile.high;
                    return (
                      <button
                        key={`palette-${tileKey(tile)}`}
                        type="button"
                        className={`daily-admin-tile-btn ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          if (tileMode === 'hand') {
                            setBuilderHand((prev) => [...prev, tile]);
                          } else {
                            setSelectedBuilderTile((prev) =>
                              prev?.low === tile.low && prev?.high === tile.high ? null : tile
                            );
                          }
                        }}
                        title={tileMode === 'hand' ? `Add [${tile.low}|${tile.high}] to hand` : `Place [${tile.low}|${tile.high}] on board`}
                        style={{ width: '100%', minWidth: 0, padding: 2 }}
                      >
                        <DominoTile tile={tile} size={24} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'rgba(180,200,215,0.6)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Starting Hand ({builderHand.length})
                  </p>
                  {builderHand.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBuilderHand([])}
                      style={{ fontSize: '0.7rem', color: 'rgba(255,120,120,0.7)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6, minHeight: 44 }}>
                  {builderHand.length === 0 ? (
                    <span style={{ gridColumn: '1/-1', color: 'rgba(180,200,215,0.4)', fontSize: '0.8rem', padding: '8px 0' }}>
                      Empty - add tiles above
                    </span>
                  ) : (
                    builderHand.map((tile, idx) => (
                      <button
                        key={`hand-${idx}-${tileKey(tile)}`}
                        type="button"
                        className="daily-admin-tile-btn"
                        onClick={() => setBuilderHand((prev) => prev.filter((_, i) => i !== idx))}
                        title="Click to remove from hand"
                        style={{ position: 'relative', width: '100%', minWidth: 0, padding: 2 }}
                      >
                        <DominoTile tile={tile} size={24} />
                        <span style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: 'rgba(255,80,80,0.7)',
                          fontSize: '0.55rem',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'white',
                          lineHeight: 1,
                        }}>x</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <button
                className="mode-inline-btn"
                onClick={() => { setBuilderBoard(null); setSelectedBuilderTile(null); }}
                style={{ fontSize: '0.78rem' }}
              >
                Clear Board
              </button>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, display: 'grid', gap: 6 }}>
                <p style={{ margin: 0, fontSize: '0.72rem', color: 'rgba(180,200,215,0.5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Load existing</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" placeholder="paste date..." value={dateValue} onChange={(e) => setDateValue(e.target.value)}
                    style={{ flex: 1, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(11,18,30,0.7)', color: 'rgba(238,248,243,0.96)', padding: '6px 8px', fontSize: '0.84rem' }} />
                  <button className="mode-inline-btn" onClick={handleLoad} style={{ whiteSpace: 'nowrap' }}>Load</button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <p style={{ margin: 0, fontSize: '0.72rem', color: 'rgba(180,200,215,0.5)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Paste Captured JSON
                </p>
                <textarea
                  rows={4}
                  value={pasteJson}
                  onChange={(e) => setPasteJson(e.target.value)}
                  placeholder='Paste output from "Copy Puzzle JSON" here...'
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(11,18,30,0.7)',
                    color: 'rgba(238,248,243,0.96)',
                    padding: '8px 10px',
                    fontSize: '0.8rem',
                    minHeight: 84,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                {error && <p style={{ margin: 0, color: 'rgba(255,160,160,0.9)', fontSize: '0.84rem' }}>{error}</p>}
                {message && !error && <p style={{ margin: 0, color: 'rgba(160,240,200,0.9)', fontSize: '0.84rem' }}>{message}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
