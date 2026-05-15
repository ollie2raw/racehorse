import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Board, DominoTile } from '../components';
import { Button } from '../components/primitives';
import '../components/primitives/Button.css';
import type { PlacementPosition, Tile } from '../types';
import '../screens/RacehorseHomeArt.css';
import {
  loadNoBrainerDataset,
  NO_BRAINER_COMBO_COUNT,
  pickNoBrainerHand,
  type NoBrainerHandRecord,
} from './noBrainerDataset';
import {
  createPracticeState,
  hintForState,
  playPracticeMove,
  type NoBrainerPracticeState,
} from './noBrainerLogic';
import { getNoBrainerSolvedCount, markNoBrainerHandSolved } from './noBrainerLabProgress';
import './noBrainerLab.css';

interface NoBrainerLabScreenProps {
  userId?: string | null;
  onBack: () => void;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
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

export default function NoBrainerLabScreen({
  userId = null,
  onBack,
}: NoBrainerLabScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dataset, setDataset] = useState<NoBrainerHandRecord[] | null>(null);
  const [record, setRecord] = useState<NoBrainerHandRecord | null>(null);
  const [practiceState, setPracticeState] = useState<NoBrainerPracticeState | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [usedHint, setUsedHint] = useState(false);
  const [usedShowSolution, setUsedShowSolution] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [handSession, setHandSession] = useState(1);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiFiredRef = useRef(false);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const solvedCount = getNoBrainerSolvedCount(userId);
  const comboTotalLabel = NO_BRAINER_COMBO_COUNT.toLocaleString();

  function flashLastPlayed(tile: Tile | null) {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }

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
    return () => {
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
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
    setUsedHint(false);
    setUsedShowSolution(false);
    confettiFiredRef.current = false;
    setError('');
    setHandSession((n) => (record ? n + 1 : 1));
  }, [dataset, record]);

  useEffect(() => {
    if (canStart && !record) {
      startHand();
    }
  }, [canStart, record, startHand]);

  const onPositionClick = (position: PlacementPosition) => {
    if (!practiceState || !selectedTile || practiceState.status !== 'playing') return;
    const move = practiceState.legalMoves.find(
      (candidate) =>
        candidate.type === 'play' &&
        candidate.tile &&
        candidate.position === position &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move?.tile) return;
    const next = playPracticeMove(practiceState, selectedTile, position);
    setPracticeState(next);
    setSelectedTile(null);
    flashLastPlayed(move.tile);
  };

  const onHint = () => {
    if (!practiceState || !record) return;
    const hint = hintForState(practiceState, record.example);
    if (!hint) return;
    setUsedHint(true);
    setSelectedTile(hint.tile);
  };

  const retryHand = () => {
    if (!record) return;
    setPracticeState(createPracticeState(record.hand));
    setSelectedTile(null);
    setShowSolution(false);
    setUsedHint(false);
    setUsedShowSolution(false);
    confettiFiredRef.current = false;
    setError('');
  };

  useEffect(() => {
    if (!practiceState) return;
    if (practiceState.status !== 'won') {
      confettiFiredRef.current = false;
      return;
    }
    if (usedHint || usedShowSolution) return;
    if (confettiFiredRef.current) return;
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    confettiFiredRef.current = true;
    const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
    myConfetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.55 },
      colors: ['#c77dff', '#e9d5ff', '#d8b56f', '#ffffff'],
    });
  }, [practiceState, usedHint, usedShowSolution]);

  useEffect(() => {
    if (!record || !practiceState || practiceState.status !== 'won') return;
    if (usedHint || usedShowSolution) return;
    markNoBrainerHandSolved(userId, record.key);
  }, [practiceState?.status, record?.key, usedHint, usedShowSolution, userId]);

  if (!dataset && !error) {
    return (
      <div className="nbl-loading-screen">
        <div className="nbl-loading-card">Loading The Lab…</div>
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="nbl-loading-screen">
        <div className="nbl-loading-card">
          <p>{error}</p>
          <p className="nbl-loading-card__hint">
            To regenerate validated hands: npm --prefix ../server run nobrainer:validate
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="secondary" size="sm" onClick={() => setReloadTick((n) => n + 1)}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" className="rh-back-button" onClick={onBack}>
              ← Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!record || !practiceState) {
    return (
      <div className="nbl-loading-screen">
        <div className="nbl-loading-card">No hand available.</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="practice-lab home-page-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <canvas
        ref={confettiCanvasRef}
        className="nbl-confetti"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2100,
          display: practiceState.status === 'won' ? 'block' : 'none',
        }}
      />

      <div className="nbl-shell">
        <header className="nbl-header">
          <div className="nbl-header__back">
            <Button variant="ghost" size="sm" className="rh-back-button" onClick={onBack} type="button">
              ← Single Player
            </Button>
          </div>

          <div className="nbl-header__mission">
            <p className="nbl-mission-eyebrow">The Lab · No Brainer Drill</p>
            <h1 className="nbl-mission-pill">Clear all 7 tiles in one turn</h1>
          </div>

          <div className="nbl-header__meta">
            <span className="nbl-meta-hand">
              Hand {handSession.toLocaleString()} · {comboTotalLabel} combos
            </span>
            {solvedCount != null ? (
              <span className="nbl-meta-solved">{solvedCount.toLocaleString()} solved</span>
            ) : null}
          </div>
        </header>

        <main className="nbl-stage">
          <div className="nbl-board-frame">
            <div className="nbl-board-canvas">
              <div className="nbl-board-watermark" aria-hidden="true">
                <svg viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M28 72 L28 32 L50 52 L72 32 L72 72"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </div>
              {practiceState.status === 'won' ? (
                <div className="nbl-win-banner" role="status">
                  Cleared — no brainer
                </div>
              ) : null}
              <Board
                board={practiceState.board}
                legalMoves={practiceState.legalMoves}
                selectedTile={selectedTile}
                lastPlayedTile={lastPlayedTile}
                onPositionClick={onPositionClick}
                tileSize={72}
              />
              <div className="nbl-board-toolbar">
                <button
                  type="button"
                  className="nbl-icon-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                >
                  <FullscreenIcon isFullscreen={isFullscreen} />
                </button>
              </div>
            </div>
          </div>

          {showSolution ? (
            <section className="nbl-solution" aria-label="Solution sequence">
              <h2 className="nbl-solution__title">Solution sequence</h2>
              <div className="nbl-solution__tiles">
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
          ) : null}
        </main>

        <footer className="nbl-dock">
          <div className="nbl-tray">
            <p className="nbl-tray__label">Your hand · play every tile</p>
            <div className="nbl-hand-row">
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

          <div className="nbl-controls">
            <div className="nbl-controls__group" aria-label="Hand navigation">
              <Button variant="secondary" size="sm" onClick={retryHand} type="button">
                Retry
              </Button>
              <Button variant="secondary" size="sm" onClick={startHand} type="button">
                New Hand
              </Button>
            </div>

            <div className="nbl-controls__divider" aria-hidden="true" />

            <div className="nbl-controls__group" aria-label="Training assistance">
              <Button variant="outline" size="sm" onClick={onHint} type="button">
                Hint
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setShowSolution((prev) => {
                    const next = !prev;
                    if (next) setUsedShowSolution(true);
                    return next;
                  })
                }
                type="button"
              >
                {showSolution ? 'Hide Solution' : 'Show Solution'}
              </Button>
            </div>
          </div>
        </footer>
      </div>

      {showDebug ? (
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
      ) : null}
    </div>
  );
}
