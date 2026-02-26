import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function NoBrainerLabScreen({ onBack }: NoBrainerLabScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dataset, setDataset] = useState<NoBrainerHandRecord[] | null>(null);
  const [record, setRecord] = useState<NoBrainerHandRecord | null>(null);
  const [practiceState, setPracticeState] = useState<NoBrainerPracticeState | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [error, setError] = useState<string>('');
  const [reloadTick, setReloadTick] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiTheme, setUiTheme] = useState<'green' | 'brown'>('green');

  const showDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('PRACTICE_DEBUG') === '1';
  const handTileCount = Math.max(1, practiceState?.remainingHand.length ?? 0);
  const handTileSize = handTileCount >= 15 ? 48 : 56;

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('racehorse_ui_theme');
    setUiTheme(stored === 'brown' ? 'brown' : 'green');
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
  };

  const onHint = () => {
    if (!practiceState || !record) return;
    const hint = hintForState(practiceState, record.example);
    if (!hint) return;
    setSelectedTile(hint.tile);
  };

  const retryHand = () => {
    if (!record) return;
    setPracticeState(createPracticeState(record.hand));
    setSelectedTile(null);
    setShowSolution(false);
    setError('');
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
    <div ref={rootRef} className={`app walnut-live practice-lab theme-${uiTheme}`}>
      <section
        className="wl-top-rail practice-top-rail"
        data-ui="hud"
        style={{ position: 'relative', minHeight: 72, display: 'flex', alignItems: 'center' }}
      >
        <div
          className="wl-player-pill is-active practice-mode-pill"
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: 0.9,
            scale: '0.98',
          }}
        >
          <div className="wl-pill-top">
            <span className="wl-player-label" style={{ fontSize: '0.7rem' }}>
              No-Brainer Lab
            </span>
          </div>
          <span className="wl-player-score" style={{ fontSize: '0.88rem' }}>
            7-Tile Run
          </span>
        </div>
        <div
          className="wl-center-status practice-center-status"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translateX(-50%) translateY(-50%)',
            display: 'grid',
            justifyItems: 'center',
            textAlign: 'center',
            width: 'min(92vw, 640px)',
          }}
        >
          <span className="wl-turn-label your-turn">Clear all 7 tiles in one turn.</span>
        </div>
      </section>

      <div className="wl-stage-shell practice-stage-shell">
        <div className="board-area wl-board-area practice-board-area">
          <Board
            board={practiceState.board}
            legalMoves={practiceState.legalMoves}
            selectedTile={selectedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              zIndex: 20,
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 999,
              padding: '4px 6px',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            }}
          >
            <button className="btn text compact bot-chip-control" onClick={retryHand}>
              Retry
            </button>
            <button className="btn text compact bot-chip-control" onClick={startHand}>
              New Hand
            </button>
            <button className="btn text compact bot-chip-control" onClick={onHint}>
              Hint
            </button>
            <button
              className="btn text compact bot-chip-control"
              onClick={() => setShowSolution((prev) => !prev)}
            >
              {showSolution ? 'Hide Solution' : 'Show Solution'}
            </button>
            <button className="btn text leave-btn compact bot-chip-control" onClick={onBack}>
              Home
            </button>
            <button
              onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))}
              title="Toggle table color"
              style={{
                padding: '4px 6px',
                color: 'rgba(200,220,215,0.55)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 1 0 20" />
              </svg>
            </button>
            <button
              className="btn text icon-btn fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                padding: '4px 6px',
                color: 'rgba(200,220,215,0.7)',
                background: 'none',
                border: 'none',
              }}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
          </div>
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
                size={handTileSize}
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
        <section
          className="practice-solution"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <h4 style={{ textAlign: 'center', width: '100%' }}>Solution sequence</h4>
          <div
            className="practice-solution-tiles"
            style={{ width: '100%', justifyContent: 'center' }}
          >
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
