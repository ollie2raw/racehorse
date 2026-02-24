import { useCallback, useEffect, useState } from 'react';
import { Board, DominoTile } from '../components';
import type { PlacementPosition, Tile } from '../types';
import {
  loadNoBrainerDataset,
  pickNoBrainerHand,
  type NoBrainerHandRecord,
} from './noBrainerDataset';
import {
  createPracticeState,
  hintForState,
  playPracticeMove,
  type NoBrainerPracticeState,
} from './noBrainerLogic';
import './noBrainerLab.css';

interface NoBrainerLabScreenProps {
  onBack: () => void;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function tileLabel(tile: Tile): string {
  return `[${tile.low}|${tile.high}]`;
}

export default function NoBrainerLabScreen({ onBack }: NoBrainerLabScreenProps) {
  const [dataset, setDataset] = useState<NoBrainerHandRecord[] | null>(null);
  const [record, setRecord] = useState<NoBrainerHandRecord | null>(null);
  const [practiceState, setPracticeState] = useState<NoBrainerPracticeState | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [hintText, setHintText] = useState<string>('');
  const [showSolution, setShowSolution] = useState(false);
  const [error, setError] = useState<string>('');
  const [reloadTick, setReloadTick] = useState(0);

  const showDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('PRACTICE_DEBUG') === '1';

  useEffect(() => {
    let active = true;
    setError('');
    loadNoBrainerDataset()
      .then((rows) => {
        if (!active) return;
        setDataset(rows);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load dataset.');
      });
    return () => {
      active = false;
    };
  }, [reloadTick]);

  const canStart = Boolean(dataset && dataset.length > 0);

  const startHand = useCallback(() => {
    if (!dataset || dataset.length === 0) return;
    const nextRecord = pickNoBrainerHand(dataset, 'random');
    setRecord(nextRecord);
    setPracticeState(createPracticeState(nextRecord.hand));
    setSelectedTile(null);
    setHintText('');
    setShowSolution(false);
    setError('');
  }, [dataset]);

  useEffect(() => {
    if (canStart && !record) {
      startHand();
    }
  }, [canStart, record, startHand]);

  const onPositionClick = (position: PlacementPosition) => {
    if (!practiceState || !selectedTile || practiceState.status !== 'playing') return;
    const next = playPracticeMove(practiceState, selectedTile, position);
    setPracticeState(next);
    setSelectedTile(null);
    setHintText('');
  };

  const onHint = () => {
    if (!practiceState || !record) return;
    const hint = hintForState(practiceState, record.example);
    if (!hint) {
      setHintText('No hint available from solution sequence right now.');
      return;
    }
    setSelectedTile(hint.tile);
    setHintText(`Try ${tileLabel(hint.tile)} on ${hint.position}.`);
  };

  if (!dataset && !error) {
    return (
      <div className="app">
        <div className="screen practice-loading">Loading No-Brainer Lab…</div>
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="app">
        <div className="screen practice-loading">
          <div style={{ display: 'grid', gap: 10, justifyItems: 'center', textAlign: 'center', padding: 20 }}>
            <div>{error}</div>
            <div style={{ opacity: 0.85, fontSize: '0.92rem' }}>
              To regenerate validated hands: `npm --prefix ../server run nobrainer:validate`
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn text" onClick={() => setReloadTick((n) => n + 1)}>
                Retry
              </button>
              <button className="btn text" onClick={onBack}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!record || !practiceState) {
    return (
      <div className="app">
        <div className="screen practice-loading">No hand available.</div>
      </div>
    );
  }

  return (
    <div className="app walnut-live practice-lab">
      <section className="practice-toolbar">
        <div className="practice-title-wrap">
          <h2>No-Brainer Lab</h2>
          <p>
            Play all 7 tiles in one turn. Continue only after a double or scoring play. Final tile
            must be non-double and non-scoring.
          </p>
        </div>
        <div className="practice-controls">
          <button className="btn text" onClick={startHand}>
            New Hand
          </button>
          <button className="btn text" onClick={onHint}>
            Hint
          </button>
          <button className="btn text" onClick={() => setShowSolution((prev) => !prev)}>
            {showSolution ? 'Hide Solution' : 'Show Solution'}
          </button>
          <button className="btn text" onClick={onBack}>
            Back to Home
          </button>
        </div>
      </section>

      <section className="practice-status-row">
        <div className={`practice-status ${practiceState.status}`}>
          {practiceState.status === 'playing' && (practiceState.board?.mainLine.length ?? 0) === 0
            ? 'Select a legal opening tile.'
            : practiceState.message}
        </div>
        {hintText && <div className="practice-hint">{hintText}</div>}
      </section>

      <div className="wl-stage-shell practice-stage-shell">
        <div className="wl-board-area practice-board-area">
          <Board
            board={practiceState.board}
            legalMoves={practiceState.legalMoves}
            selectedTile={selectedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
        </div>
      </div>

      <div className="wl-hand-area practice-hand-area">
        <div className="practice-hand-row">
          {practiceState.remainingHand.map((tile, idx) => {
            const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
            return (
              <DominoTile
                key={`hand-${idx}-${tile.low}-${tile.high}`}
                tile={tile}
                size={78}
                selected={selected}
                highlight={false}
                disabled={practiceState.status !== 'playing'}
                onClick={() => {
                  if (practiceState.status !== 'playing') return;
                  const isPlayable = practiceState.legalMoves.some(
                    (m) => m.type === 'play' && m.tile && tileEquals(m.tile, tile),
                  );
                  if (!isPlayable) return;
                  setSelectedTile(tile);
                }}
              />
            );
          })}
        </div>
      </div>

      {showSolution && (
        <section className="practice-solution">
          <h4>Solution sequence</h4>
          <div className="practice-solution-tiles">
            {record.example.map((tile, idx) => (
              <DominoTile
                key={`sol-${idx}-${tile.low}-${tile.high}`}
                tile={tile}
                size={48}
                disabled
              />
            ))}
          </div>
        </section>
      )}

      {showDebug && (
        <aside className="practice-debug">
          <div>
            <strong>open ends:</strong> {practiceState.openEnds.join(', ') || '(none)'}
          </div>
          <div>
            <strong>open sum:</strong> {practiceState.openSum}
          </div>
          <div>
            <strong>scored:</strong> {practiceState.scored ? 'yes' : 'no'}
          </div>
          <div>
            <strong>must continue:</strong> {practiceState.mustContinue ? 'yes' : 'no'}
          </div>
        </aside>
      )}
    </div>
  );
}
