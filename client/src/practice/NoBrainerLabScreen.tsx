import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Board, DominoTile } from '../components';
import { MatchLiveLayout } from '../match/board';
import '../match/match-live.css';
import type { BoardHandle } from '../components';
import { Button } from '../components/primitives';
import '../components/primitives/Button.css';
import type { PlacementPosition, Tile } from '../types';
import { tileEquals } from '../game/tileUtils';
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
import { ZoomInIcon, ZoomOutIcon, FitBoardIcon } from '../components';
import './noBrainerLab.css';

interface NoBrainerLabScreenProps {
  userId?: string | null;
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

function HomeIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" />
      <polyline points="9 21 9 12 15 12 15 21" />
    </svg>
  );
}

export default function NoBrainerLabScreen({
  userId = null,
  onBack,
}: NoBrainerLabScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BoardHandle>(null);
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

  const [solvedCount, setSolvedCount] = useState<number | null>(() => getNoBrainerSolvedCount(userId));
  const comboTotalLabel = NO_BRAINER_COMBO_COUNT.toLocaleString();

  useEffect(() => {
    setSolvedCount(getNoBrainerSolvedCount(userId));
  }, [userId]);

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
    if (markNoBrainerHandSolved(userId, record.key)) {
      setSolvedCount(getNoBrainerSolvedCount(userId));
    }
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
    <div
      ref={rootRef}
      className="practice-lab practice-lab-screen screen game-screen walnut-live rh-match-live rh-match-solo-hud"
    >
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

      <MatchLiveLayout
        hudLeft={
          <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={onBack}>
            ← Single Player
          </button>
        }
        hudCenter={
          <div className="wl-center-status" data-ui="turn-status">
            <span className="wl-turn-label your-turn">Clear all 7 tiles in one turn</span>
          </div>
        }
        hudRight={
          <p className="rh-match-solo-meta">
            {solvedCount != null ? (
              <>
                <strong>{solvedCount.toLocaleString()}</strong> solved ·{' '}
              </>
            ) : null}
            Hand <strong>{handSession.toLocaleString()}</strong> · {comboTotalLabel} combos
          </p>
        }
        boardToolbar={
          <div
            className="nbl-board-controls-pill control-pill board-zoom-tray"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="board-zoom-btn"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                boardRef.current?.zoomOut();
              }}
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className="board-zoom-btn"
              title="Fit board"
              aria-label="Fit board"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                boardRef.current?.resetCamera();
              }}
            >
              <FitBoardIcon />
            </button>
            <button
              type="button"
              className="board-zoom-btn"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                boardRef.current?.zoomIn();
              }}
            >
              <ZoomInIcon />
            </button>
            <span className="nbl-board-controls-divider" aria-hidden="true" />
            <button
              type="button"
              className="nbl-board-control-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
            <button
              type="button"
              className="nbl-board-control-btn"
              onClick={onBack}
              title="Back to Single Player"
              aria-label="Back to Single Player"
            >
              <HomeIcon />
            </button>
          </div>
        }
        boardInner={
          <>
            {practiceState.status === 'won' ? (
              <div className="nbl-win-banner" role="status">
                Cleared — no brainer
              </div>
            ) : null}
            <Board
              ref={boardRef}
              showZoomTray={false}
              board={practiceState.board}
              legalMoves={practiceState.legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={84}
            />
          </>
        }
        handStackClassName="nbl-live-hand-stack"
        handFooterClassName="nbl-live-hand-footer"
        handDock={
          <div className="nbl-tray">
            <div className="wl-hand-area nbl-tray__hand" data-ui="tray">
              <div className="tray-rail">
                <div className="tray-center">
                  <div className="hand-container has-single-row">
                    <div className="hand-row">
                      {practiceState.remainingHand.map((tile, idx) => {
                        const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                        const isPlayable = practiceState.legalMoves.some(
                          (m) => m.type === 'play' && m.tile && tileEquals(m.tile, tile),
                        );
                        return (
                          <DominoTile
                            key={`hand-${idx}-${tile.low}-${tile.high}`}
                            tile={tile}
                            size={handTileSize}
                            selected={selected}
                            highlight={practiceState.status === 'playing' && isPlayable}
                            unplayable={practiceState.status === 'playing' && !isPlayable}
                            disabled={practiceState.status !== 'playing'}
                            onClick={() => {
                              if (practiceState.status !== 'playing') return;
                              if (!isPlayable) return;
                              setSelectedTile(tile);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }
        handFooter={
          <div className="nbl-controls" aria-label="Training controls">
            <div className="nbl-controls__group" aria-label="Hand navigation">
              <Button variant="secondary" size="sm" onClick={retryHand} type="button">
                Retry
              </Button>
              <Button variant="secondary" size="sm" onClick={startHand} type="button">
                New Hand
              </Button>
            </div>
            <span className="nbl-controls__divider" aria-hidden="true" />
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
        }
      />

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
