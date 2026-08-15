import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Board } from '../components';
import { Button } from '../components/primitives';
import { DailyPuzzleSoloHandDock } from '../dailyPuzzle/DailyPuzzleSoloHandDock';
import { listLegalCircuitPlays } from '@racehorse/game-core';
import { tileEquals } from '../game/tileUtils';
import type { PlacementPosition, Tile } from '../types';
import { gameStateToBotMatch, moveFromTileAndPosition } from './run/circuitEvaluate';
import {
  clearCircuitInteractionNotice,
  continueAfterCircuitFeedback,
  createIdleCircuitRun,
  dismissCircuitPressureEntrance,
  startCircuitRun,
  submitCircuitDecision,
  circuitAccuracy,
  deepestGateReached,
  type CircuitRunState,
} from './run/circuitRunEngine';
import { loadCircuitProgress, saveCircuitRunResult } from './run/circuitProgressStorage';
import { CircuitHud } from './ui/CircuitHud';
import { CircuitFeedbackBanner } from './ui/CircuitFeedbackBanner';
import { CircuitResultsView } from './ui/CircuitResultsView';
import { CircuitReviewView } from './ui/CircuitReviewView';
import { CircuitEndTargets } from './ui/CircuitEndTargets';
import './ui/circuit.css';

export type CircuitScreenProps = {
  userId?: string | null;
  onBack: () => void;
};

type ViewMode = 'lobby' | 'run' | 'review';

export default function CircuitScreen({ userId = null, onBack }: CircuitScreenProps) {
  const [progress, setProgress] = useState(() => loadCircuitProgress(userId));
  const [run, setRun] = useState<CircuitRunState>(() => createIdleCircuitRun(progress.personalBest));
  const [view, setView] = useState<ViewMode>('lobby');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handRegionId = useId();
  const noticeId = useId();

  useEffect(() => {
    setProgress(loadCircuitProgress(userId));
  }, [userId]);

  useEffect(() => {
    if (run.phase === 'feedback') {
      const btn = document.querySelector<HTMLButtonElement>('.rh-circuit-feedback button');
      btn?.focus();
    }
  }, [run.phase, run.lastOutcome?.gateNumber, run.lastOutcome?.stepId]);

  useEffect(() => {
    if (!run.pressureEntrancePending) return;
    const timer = window.setTimeout(() => {
      setRun((prev) => dismissCircuitPressureEntrance(prev));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [run.pressureEntrancePending, run.gateIndex, run.active?.stepId]);

  const decidingState = run.active?.gameState ?? null;
  const revealBoard = run.phase === 'feedback' ? run.lastOutcome?.resultingBoard : null;
  const revealHand = run.phase === 'feedback' ? run.lastOutcome?.remainingHand : null;

  const matchState = useMemo(() => {
    if (!decidingState) return null;
    const base = gameStateToBotMatch(decidingState);
    if (revealBoard) {
      return {
        ...base,
        board: {
          mainLine: revealBoard.mainLine.map((p) => ({
            tile: { ...p.tile },
            orientation: p.orientation,
          })),
          leftEnd: revealBoard.leftEnd,
          rightEnd: revealBoard.rightEnd,
          leftEndIsDouble: revealBoard.leftEndIsDouble,
          rightEndIsDouble: revealBoard.rightEndIsDouble,
          hubDoubles: revealBoard.hubDoubles.map((hub) => ({
            ...hub,
            branches: hub.branches.map((arm) =>
              arm
                ? {
                    openEnd: arm.openEnd,
                    openEndIsDouble: arm.openEndIsDouble,
                    tiles: arm.tiles.map((p) => ({
                      tile: { ...p.tile },
                      orientation: p.orientation,
                    })),
                  }
                : null,
            ),
          })),
        },
        players: {
          ...base.players,
          you: {
            ...base.players.you,
            hand: (revealHand ?? base.players.you.hand).map((t) => ({ ...t })),
          },
        },
      };
    }
    return base;
  }, [decidingState, revealBoard, revealHand]);

  const legalMoves = useMemo(() => {
    if (!run.active || run.phase !== 'deciding') return [];
    return listLegalCircuitPlays(run.active.gameState);
  }, [run.active, run.phase]);

  const boardLegalMoves = useMemo(() => {
    if (run.phase !== 'deciding' || !selectedTile) return [];
    return legalMoves.filter((m) => tileEquals(m.tile, selectedTile));
  }, [legalMoves, run.phase, selectedTile]);

  const legalPositions = useMemo(
    () => boardLegalMoves.map((m) => m.position as PlacementPosition),
    [boardLegalMoves],
  );

  const beginRun = useCallback(() => {
    try {
      setError(null);
      setSelectedTile(null);
      setRun(startCircuitRun({ personalBest: progress.personalBest }));
      setView('run');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Circuit run');
    }
  }, [progress.personalBest]);

  const onSelectTile = useCallback(
    (tile: Tile) => {
      if (run.phase !== 'deciding') return;
      setRun((prev) => clearCircuitInteractionNotice(prev));
      setSelectedTile((prev) => (prev && tileEquals(prev, tile) ? null : tile));
    },
    [run.phase],
  );

  const commitPosition = useCallback(
    (position: PlacementPosition) => {
      if (run.phase !== 'deciding' || !selectedTile) return;
      const legal = legalMoves.find((m) => tileEquals(m.tile, selectedTile) && m.position === position);
      if (!legal) {
        setRun((prev) =>
          submitCircuitDecision(prev, moveFromTileAndPosition(selectedTile, position)),
        );
        return;
      }
      setSelectedTile(null);
      setRun((prev) => submitCircuitDecision(prev, moveFromTileAndPosition(legal.tile, legal.position)));
    },
    [legalMoves, run.phase, selectedTile],
  );

  const onIllegalEnd = useCallback(
    (position: PlacementPosition) => {
      if (!selectedTile) return;
      setRun((prev) =>
        submitCircuitDecision(prev, moveFromTileAndPosition(selectedTile, position)),
      );
    },
    [selectedTile],
  );

  const onContinueFeedback = useCallback(() => {
    setSelectedTile(null);
    setRun((prev) => {
      const next = continueAfterCircuitFeedback(prev);
      if (next.phase === 'results') {
        const saved = saveCircuitRunResult(
          {
            score: next.score,
            deepestGate: deepestGateReached(next),
            accuracy: circuitAccuracy(next),
          },
          userId,
        );
        setProgress(saved);
      }
      return next;
    });
  }, [userId]);

  const mistakes = useMemo(
    () => run.decisionHistory.filter((d) => d.grade === 'inaccurate' || d.grade === 'blunder'),
    [run.decisionHistory],
  );

  const isTilePlayable = useCallback(
    (tile: Tile) => legalMoves.some((m) => tileEquals(m.tile, tile)),
    [legalMoves],
  );

  const locked = run.phase === 'feedback';
  const isPressure =
    run.active?.gateKind === 'pressure_gate' || run.active?.gateKind === 'checkpoint_hand';
  const pressureComplete =
    Boolean(isPressure && run.active && run.lastOutcome) &&
    (run.active?.stepIndex ?? 0) + 1 >= (run.active?.stepCount ?? 1) &&
    !run.lastOutcome?.strike;

  return (
    <div className="rh-circuit-page">
      <div className="rh-circuit-page__bg" aria-hidden="true" />
      <div className="rh-circuit-shell">
        <div className="rh-circuit-topbar">
          <Button variant="ghost" className="rh-back-button" onClick={onBack} type="button">
            ← Single Player
          </Button>
        </div>

        {error ? (
          <div className="rh-circuit-error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" onClick={beginRun} type="button">
              Retry
            </Button>
          </div>
        ) : null}

        {view === 'lobby' && !error ? (
          <section className="rh-circuit-lobby" aria-label="The Circuit lobby">
            <p className="rh-circuit-lobby__eyebrow">Flagship strategic runs</p>
            <h1 className="rh-circuit-lobby__title">The Circuit</h1>
            <p className="rh-circuit-lobby__copy">
              Twelve escalating gates. Choose the strongest legal play each time. Three strikes end
              the run. Pressure Gates are high-stakes sequences — keep the objective in view and chase
              your personal best.
            </p>
            <ul className="rh-circuit-lobby__howto">
              <li>Select a playable tile from your hand.</li>
              <li>Commit on a labeled board end — left or right shows the pip it needs.</li>
              <li>Optimal and strong build combo. Mistakes cost a strike.</li>
            </ul>
            <dl className="rh-circuit-lobby__stats">
              <div>
                <dt>Personal best</dt>
                <dd>{progress.personalBest}</dd>
              </div>
              <div>
                <dt>Deepest gate</dt>
                <dd>{progress.deepestGate || '—'}</dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>{progress.runsCompleted}</dd>
              </div>
            </dl>
            <Button variant="tier-elite" size="lg" onClick={beginRun} type="button">
              Start Run
            </Button>
          </section>
        ) : null}

        {view === 'run' && run.phase === 'results' ? (
          <CircuitResultsView
            run={run}
            onRunAgain={beginRun}
            onReviewMistakes={() => setView('review')}
            onBackToSolo={onBack}
          />
        ) : null}

        {view === 'review' ? (
          <CircuitReviewView
            mistakes={mistakes}
            onBack={() => setView('run')}
            onRunAgain={beginRun}
          />
        ) : null}

        {view === 'run' && run.active && (run.phase === 'deciding' || run.phase === 'feedback') ? (
          <div className="rh-circuit-play" aria-busy={locked}>
            {run.pressureEntrancePending && run.active.entranceLine ? (
              <div className="rh-circuit-pressure-enter" role="status" aria-live="polite">
                <p className="rh-circuit-pressure-enter__eyebrow">Pressure Gate</p>
                <p className="rh-circuit-pressure-enter__title">
                  {run.active.pressureTitle || run.active.title}
                </p>
                <p className="rh-circuit-pressure-enter__line">{run.active.entranceLine}</p>
                {run.active.stakesLine ? (
                  <p className="rh-circuit-pressure-enter__stakes">{run.active.stakesLine}</p>
                ) : null}
              </div>
            ) : null}

            <CircuitHud
              gateNumber={run.gateIndex + 1}
              totalGates={run.manifest.length}
              score={run.score}
              personalBest={Math.max(run.personalBest, progress.personalBest)}
              strikes={run.strikes}
              maxStrikes={run.maxStrikes}
              combo={run.combo}
              title={run.active.title}
              prompt={run.active.prompt}
              objective={run.active.objective}
              gateKind={run.active.gateKind}
              stepIndex={run.active.stepIndex}
              stepCount={run.active.stepCount}
              pressureTitle={run.active.pressureTitle}
              stakesLine={run.active.stakesLine}
              transitionIn={run.active.transitionIn}
            />

            <div
              id={noticeId}
              className="rh-circuit-live"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {run.interactionNotice ? (
                <p className="rh-circuit-notice">{run.interactionNotice}</p>
              ) : locked && run.lastOutcome ? (
                <p className="rh-circuit-hint">
                  Resulting board after {formatShort(run.lastOutcome.chosenMove)}. Compare with the
                  recommended line below.
                </p>
              ) : selectedTile ? (
                <p className="rh-circuit-hint">
                  Selected [{selectedTile.low}|{selectedTile.high}]. Choose a labeled end to commit.
                </p>
              ) : (
                <p className="rh-circuit-hint">Select a highlighted tile, then a legal board end.</p>
              )}
            </div>

            <div
              className={`rh-circuit-board-wrap${locked ? ' rh-circuit-board-wrap--reveal' : ''}`}
              aria-label="Circuit board"
            >
              {matchState?.board ? (
                <Board
                  board={matchState.board}
                  selectedTile={!locked ? selectedTile : null}
                  legalMoves={[]}
                  onPositionClick={() => undefined}
                  showOpenEndGlow={Boolean(selectedTile) && !locked}
                  fitMode="guided"
                  showZoomTray={false}
                  tileSize={72}
                />
              ) : (
                <p className="rh-circuit-empty">Unable to load board position.</p>
              )}
            </div>

            {!locked && matchState?.board ? (
              <CircuitEndTargets
                leftEnd={matchState.board.leftEnd}
                rightEnd={matchState.board.rightEnd}
                selectedTile={selectedTile}
                legalPositions={legalPositions}
                disabled={locked}
                onCommit={commitPosition}
                onIllegalAttempt={onIllegalEnd}
              />
            ) : null}

            {matchState ? (
              <div
                aria-labelledby={handRegionId}
                className={selectedTile && !locked ? 'rh-circuit-hand rh-circuit-hand--selecting' : 'rh-circuit-hand'}
              >
                <p id={handRegionId} className="rh-circuit-hand-label">
                  Your hand
                </p>
                <DailyPuzzleSoloHandDock
                  hand={matchState.players.you.hand}
                  handTileSize={56}
                  handCompactStacked={matchState.players.you.hand.length > 8}
                  selectedTile={selectedTile}
                  inProgress={!locked}
                  isTilePlayable={isTilePlayable}
                  onSelectTile={onSelectTile}
                  handRowKeyPrefix="circuit-hand"
                  tileKeyPrefix="circuit-tile"
                />
              </div>
            ) : null}

            {run.phase === 'feedback' && run.lastOutcome ? (
              <CircuitFeedbackBanner
                outcome={run.lastOutcome}
                onContinue={onContinueFeedback}
                pressureCompletionLine={
                  pressureComplete ? run.active.completionLine : run.lastOutcome.strike ? run.active.failureLine : null
                }
                isPressureStepComplete={Boolean(isPressure)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatShort(move: { tile: Tile; position: PlacementPosition }): string {
  return `[${move.tile.low}|${move.tile.high}] → ${move.position}`;
}
