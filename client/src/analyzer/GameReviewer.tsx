import { useEffect, useMemo, useState } from 'react';
import { Board, DominoTile } from '../components';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import {
  LEGACY_ANALYSIS_DISCLOSURE,
  type AnalyzedMove,
  type GameAnalysis,
  type MoveRating,
} from './moveAnalyzer';
import { sameTileTuple } from '../game/moveLogger';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import type { ReviewCoachingFactsStore } from '../modules/review/reviewCoachingFactsStore';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { selectMoveHeuristicClassification } from './useMoveHeuristicClassification';
import { heuristicClassificationToDisplay } from './heuristicClassificationToDisplay';
import { selectMoveSearchTier } from './useMoveSearchTier';
import {
  calibratedRatingCoachingCopy,
  forcedDecisionCoachingCopy,
  moveRatingCoachingCopy,
  unavailableDecisionCoachingCopy,
} from './moveRatingCoachingCopy';
import type { ReviewCoachingFacts, ReviewCoachingProse } from './reviewCoachingFacts';
import { createReviewCoachingFactsResolver } from './reviewCoachingFactsResolver';
import { buildReviewCoachingProse } from './reviewCoachingProse';
import { buildReviewPresentationRecord } from './reviewPresentationRecord';
import { describePrincipalVariationStep, stepPrincipalVariationBoards } from './reviewPrincipalVariationBoard';
import { buildReviewDecisionHandContext } from './reviewDecisionHandContext';
import { GameReviewerHandContext } from './GameReviewerHandContext';
import '../styles/dossierRecord.css';
import './GameReviewer.css';

interface GameReviewerProps {
  open: boolean;
  onClose: () => void;
  analysis: GameAnalysis | null;
  reviewWorkerBatch?: ReviewBatchState;
  decisionIdByMoveNumber?: ReadonlyMap<number, string>;
  /**
   * Review-instance store for canonical coaching facts. Owned by the post-game
   * / multiplayer runtime so close→reopen reuses published facts. When omitted
   * (unit tests), a local store scoped to this mount is used.
   */
  coachingFactsStore?: ReviewCoachingFactsStore<ReviewCoachingFacts> | null;
  /** Snapshots keyed by decision id — required for Fritz-derived facts. */
  snapshotsByDecisionId?: ReadonlyMap<string, ReviewPositionSnapshotV2>;
  /**
   * F1e-5 historical mode: pre-persisted facts+prose keyed by decision id.
   * When set, coaching is taken from this map and the live resolver/Fritz
   * path is not used (and snapshots need not be supplied).
   */
  historicalCoachingByDecisionId?: ReadonlyMap<
    string,
    { readonly facts: ReviewCoachingFacts; readonly prose: ReviewCoachingProse }
  >;
  /**
   * Live positional coaching prose (Gate 4). Defaults false (fail closed) so
   * local/non-cohort GameReviewer surfaces never inherit the product ship
   * constant alone. Cohort call sites pass
   * `isPositionalCoachingProseEnabled(serverCohort)`. Historical mode ignores
   * this and renders persisted prose as written.
   */
  enablePositionalExplanations?: boolean;
  /** Optional banner for legacy rows without a replay artifact. */
  historicalLegacyNotice?: string | null;
  title?: string;
  scopeHandNumber?: number | null;
  /** 1-based move index within the starting hand (default 1). */
  initialMoveIndex?: number;
  opponentLabel?: string;
}

const COACHING_RATINGS: MoveRating[] = ['Blunder', 'Mistake', 'Inaccuracy'];

const BADGE_TEXT: Record<'heuristic' | 'unclear' | 'search', string> = {
  heuristic: 'Est.',
  unclear: 'Unclear',
  search: 'Search',
};

function ratingClass(rating: MoveRating): string {
  return rating.toLowerCase();
}

function tileText(tile?: [number, number]): string {
  if (!tile) return '—';
  return `${tile[0]}-${tile[1]}`;
}

function formatPlayedLabel(move: AnalyzedMove): string {
  if (move.action === 'pass') return 'Pass';
  if (move.action === 'draw') return 'Draw';
  return tileText(move.playedTile);
}

export default function GameReviewer({
  open,
  onClose,
  analysis,
  reviewWorkerBatch,
  decisionIdByMoveNumber,
  coachingFactsStore = null,
  snapshotsByDecisionId,
  historicalCoachingByDecisionId,
  enablePositionalExplanations = false,
  historicalLegacyNotice = null,
  title = 'Game Review',
  scopeHandNumber = null,
  initialMoveIndex = 1,
  opponentLabel = 'Fritz',
}: GameReviewerProps) {
  const isHistoricalReplay = Boolean(historicalCoachingByDecisionId);
  const hands = useMemo(() => analysis?.hands ?? [], [analysis?.hands]);
  const [selectedHandNumber, setSelectedHandNumber] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);

  const reviewSessionKey = open
    ? `${analysis?.analyzedAt ?? ''}:${scopeHandNumber ?? 'all'}:${initialMoveIndex}`
    : 'closed';

  const [trackedReviewSessionKey, setTrackedReviewSessionKey] = useState(reviewSessionKey);
  if (reviewSessionKey !== trackedReviewSessionKey) {
    setTrackedReviewSessionKey(reviewSessionKey);
  }

  // Fallback store for tests / callers that have not threaded the runtime store.
  // Still review-session scoped — never a module-global cache.
  const localIdentity = `local:${reviewSessionKey}`;
  const [localFactsStore, setLocalFactsStore] = useState(() => ({
    reviewIdentity: localIdentity,
    byDecisionId: new Map<string, ReviewCoachingFacts>(),
  }));
  if (!coachingFactsStore && localFactsStore.reviewIdentity !== localIdentity) {
    setLocalFactsStore({
      reviewIdentity: localIdentity,
      byDecisionId: new Map(),
    });
  }
  const factsStore = coachingFactsStore ?? localFactsStore;

  // Resolver may be recreated when batch/snapshots identities change; the
  // published Map on `factsStore` is the cache, so constructions are not lost.
  // Historical replay skips the live resolver entirely (no Fritz / no rebuild).
  const coachingFactsResolver = useMemo(
    () =>
      isHistoricalReplay
        ? null
        : createReviewCoachingFactsResolver({
            store: factsStore,
            getEvaluation: (decisionId) => reviewWorkerBatch?.resultsByDecisionId.get(decisionId),
            getSnapshot: (decisionId) => snapshotsByDecisionId?.get(decisionId),
            eligibleDecisionIds: snapshotsByDecisionId
              ? [...snapshotsByDecisionId.keys()]
              : [...(reviewWorkerBatch?.resultsByDecisionId.keys() ?? [])],
            enablePositionalExplanations,
          }),
    [factsStore, reviewWorkerBatch, snapshotsByDecisionId, isHistoricalReplay, enablePositionalExplanations],
  );

  useEffect(() => {
    if (!open || !analysis) return;
    const defaultHand = scopeHandNumber ?? hands[0]?.handNumber ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derives the initial hand + move cursor from props when the reviewer opens
    setSelectedHandNumber(defaultHand);
    const hand = hands.find((entry) => entry.handNumber === defaultHand);
    const moveCount = hand?.analyzedMoves.length ?? analysis.analyzedMoves.length;
    const startIdx =
      moveCount > 0
        ? Math.max(0, Math.min(moveCount - 1, initialMoveIndex - 1))
        : 0;
    setCursor(startIdx);
  }, [analysis, hands, initialMoveIndex, open, reviewSessionKey, scopeHandNumber]);

  const selectedHand = useMemo(
    () => hands.find((hand) => hand.handNumber === selectedHandNumber) ?? null,
    [hands, selectedHandNumber],
  );

  const moves = selectedHand?.analyzedMoves ?? analysis?.analyzedMoves ?? [];
  const current = moves[cursor] ?? null;

  // D2 (game-review-oracle-upgrade-2026-09-13.md): the one structured
  // coaching path, replacing sidebarCopy/praiseCopy below. Sourced from
  // the same reviewWorkerBatch/decisionIdByMoveNumber props
  // ratingCoachingCopy already reads just below -- the only place in this
  // component a resolved ReviewEvaluationV1 is available.
  // Facts come from the review-instance resolver so cursor / re-render
  // never re-runs Fritz-derived construction for the same decision.
  const currentDecisionId = current ? decisionIdByMoveNumber?.get(current.moveNumber) : undefined;

  const coaching = useMemo(() => {
    if (!currentDecisionId || !reviewWorkerBatch) return null;
    if (!reviewWorkerBatch.resultsByDecisionId.has(currentDecisionId)) return null;
    if (historicalCoachingByDecisionId) {
      const persisted = historicalCoachingByDecisionId.get(currentDecisionId);
      return persisted ? { facts: persisted.facts, prose: persisted.prose } : null;
    }
    if (!coachingFactsResolver) return null;
    const facts = coachingFactsResolver.getFacts(currentDecisionId);
    if (!facts) return null;
    return { facts, prose: buildReviewCoachingProse(facts, enablePositionalExplanations) };
  }, [
    currentDecisionId,
    reviewWorkerBatch,
    coachingFactsResolver,
    historicalCoachingByDecisionId,
    enablePositionalExplanations,
  ]);

  // Explicit, honest states for every case that isn't a resolved result --
  // never a fabricated placeholder claiming an answer exists.
  const coachingStatus: 'resolved' | 'pending' | 'error' | 'unavailable' = coaching
    ? 'resolved'
    : !currentDecisionId || !reviewWorkerBatch
      ? 'unavailable'
      : reviewWorkerBatch.errorsByDecisionId.has(currentDecisionId)
        ? 'error'
        : reviewWorkerBatch.pendingDecisionIds.has(currentDecisionId)
          ? 'pending'
          : 'unavailable';

  // D3 (game-review-oracle-upgrade-2026-09-13.md): PV-on-board. Deliberately
  // its own memo, independent of `coaching` above (D2) -- it needs both
  // `played` and `best` principal variations from the raw evaluation, not
  // just the single `principalVariation` field D0's ReviewCoachingFacts
  // exposes (that field is best's only). Re-reading the same
  // decisionId/reviewWorkerBatch lookup a third time here (matching the
  // pattern `ratingCoachingCopy` and `coaching` already each do
  // independently) keeps this addition from touching D0/D2's existing
  // memos at all.
  const pvLines = useMemo(() => {
    if (!currentDecisionId || !reviewWorkerBatch || !current) return null;
    const resolvedEvaluation = reviewWorkerBatch.resultsByDecisionId.get(currentDecisionId);
    if (!resolvedEvaluation) return null;
    return {
      preMoveBoard: current.boardRenderState,
      played: resolvedEvaluation.played.principalVariation,
      best: resolvedEvaluation.best.principalVariation,
    };
  }, [current, currentDecisionId, reviewWorkerBatch]);

  const pvResetKey = current?.moveNumber ?? null;
  const [trackedPvResetKey, setTrackedPvResetKey] = useState(pvResetKey);
  const [pvMode, setPvMode] = useState<'played' | 'best'>('best');
  const [pvStepIndex, setPvStepIndex] = useState(0);
  if (pvResetKey !== trackedPvResetKey) {
    setTrackedPvResetKey(pvResetKey);
    setPvMode('best');
    setPvStepIndex(0);
  }

  const pvSteps = useMemo(
    () => (pvLines ? (pvMode === 'played' ? pvLines.played : pvLines.best) : []),
    [pvLines, pvMode],
  );
  const pvBoards = useMemo(
    () => stepPrincipalVariationBoards(pvLines?.preMoveBoard ?? null, pvSteps),
    [pvLines, pvSteps],
  );
  const pvSafeStepIndex = Math.min(pvStepIndex, pvBoards.length - 1);
  const pvHasSteps = pvSteps.length > 0;

  const ratingCoachingCopy = useMemo(() => {
    if (!current) return null;
    const decisionId = decisionIdByMoveNumber?.get(current.moveNumber);
    const resolvedEvaluation = decisionId ? reviewWorkerBatch?.resultsByDecisionId.get(decisionId) : undefined;
    const factsForMove =
      decisionId && historicalCoachingByDecisionId?.has(decisionId)
        ? historicalCoachingByDecisionId.get(decisionId)!.facts
        : decisionId && coachingFactsResolver
          ? coachingFactsResolver.getFacts(decisionId)
          : null;
    const presentation = buildReviewPresentationRecord(resolvedEvaluation, factsForMove ?? null);
    const classification = presentation.classification;

    if (classification?.kind === 'forced') return forcedDecisionCoachingCopy();
    if (classification?.kind === 'unclear') return null;

    if (
      reviewWorkerBatch?.done
      && decisionId
      && !resolvedEvaluation
      && (reviewWorkerBatch.errorsByDecisionId.has(decisionId)
        || !reviewWorkerBatch.pendingDecisionIds.has(decisionId))
    ) {
      return unavailableDecisionCoachingCopy();
    }

    if (classification?.kind === 'bucket') {
      return moveRatingCoachingCopy(classification.bucket, 'heuristic');
    }
    if (classification?.kind === 'calibrated') {
      const scoreGap = Math.abs(resolvedEvaluation?.loss.expectedPointDifferential ?? 0);
      return calibratedRatingCoachingCopy(classification.label, scoreGap);
    }

    // Legacy fallback only when no modern evaluation path is wired.
    if (!reviewWorkerBatch || !decisionId) {
      return moveRatingCoachingCopy(current.rating, 'precise');
    }
    return null;
  }, [
    current,
    decisionIdByMoveNumber,
    reviewWorkerBatch,
    coachingFactsResolver,
    historicalCoachingByDecisionId,
  ]);

  const currentOracleEvaluation = current && decisionIdByMoveNumber && reviewWorkerBatch
    ? reviewWorkerBatch.resultsByDecisionId.get(decisionIdByMoveNumber.get(current.moveNumber) ?? '')
    : undefined;
  // Board "Best move" must use the same primary reference as coaching (D2:
  // Fritz for heuristic), not a separate oracle-only ghost.
  const presentationBestAction = coaching?.facts.best.action ?? currentOracleEvaluation?.best.action;
  const oracleBestTile = presentationBestAction?.kind === 'play'
    ? [presentationBestAction.tile.low, presentationBestAction.tile.high] as [number, number]
    : undefined;

  const evidence = analysis?.evidence ?? LEGACY_ANALYSIS_DISCLOSURE;

  const handContext = useMemo(
    () => (current ? buildReviewDecisionHandContext(current) : null),
    [current],
  );

  const showGhostTile = Boolean(
    current &&
      current.action === 'place' &&
      (oracleBestTile ?? current.engineBestMove?.tile) &&
      (currentOracleEvaluation || COACHING_RATINGS.includes(current.rating)) &&
      (oracleBestTile
        ? !sameTileTuple(current.playedTile, oracleBestTile)
        : !sameTileTuple(current.playedTile, current.engineBestMove?.tile) ||
          current.bestPosition !== current.engineBestMove?.position),
  );

  if (!open) return null;

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay gr-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Game reviewer"
        onClick={onClose}
      >
        <div className="gr-shell dfd dfd--wide" onClick={(event) => event.stopPropagation()}>
          <div className="gr-main">
            <div className="gr-header">
              <div className="gr-heading">
                <span className="dfd__eyebrow">Analysis record</span>
                <h3 className="dfd__headline gr-title">{title}</h3>
                <span className="gr-evidence-label">
                  {evidence.displayLabel} · {evidence.confidence} confidence
                </span>
                {historicalLegacyNotice ? (
                  <p className="gr-legacy-notice" role="status">
                    {historicalLegacyNotice}
                  </p>
                ) : null}
              </div>
              <button type="button" className="dfd__btn gr-close-btn" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="gr-board-cell">
            <div className="gr-board-frame">
              <div className="gr-board-layer">
                <Board
                  key={`gr-board-${selectedHandNumber ?? 'all'}-${cursor}`}
                  board={current?.boardRenderStateAfterMove ?? null}
                  legalMoves={[]}
                  selectedTile={null}
                  onPositionClick={() => {}}
                  fitMode="guided"
                  containFullBoard
                  tileSize={42}
                  showZoomTray
                />
              </div>
              {showGhostTile && (oracleBestTile ?? current?.engineBestMove?.tile) ? (
                <div className="gr-ghost-tile">
                  <DominoTile
                    tile={{
                      low: (oracleBestTile ?? current.engineBestMove!.tile)[0],
                      high: (oracleBestTile ?? current.engineBestMove!.tile)[1],
                    }}
                    size={48}
                    disabled
                  />
                  <span className="gr-ghost-label">Best move</span>
                </div>
              ) : null}
            </div>
            </div>

            {handContext ? <GameReviewerHandContext handContext={handContext} /> : null}

            <div className="gr-move-nav">
              <button
                type="button"
                className="dfd__btn gr-nav-btn"
                onClick={() => setCursor((prev) => Math.max(0, prev - 1))}
                disabled={cursor <= 0}
                aria-label="Previous move"
              >
                {'<'}
              </button>
              <span className="gr-move-nav-label">
                {moves.length
                  ? `Move ${cursor + 1} / ${moves.length}${selectedHand ? ` · Hand ${selectedHand.handNumber}` : ''}`
                  : 'No moves'}
              </span>
              <button
                type="button"
                className="dfd__btn gr-nav-btn"
                onClick={() => setCursor((prev) => Math.min(moves.length - 1, prev + 1))}
                disabled={!moves.length || cursor >= moves.length - 1}
                aria-label="Next move"
              >
                {'>'}
              </button>
            </div>

            {current ? (
              <div className="gr-pv-panel">
                <div className="gr-pv-header">
                  <span className="gr-pv-title">Principal variation</span>
                  <div className="gr-pv-toggle" role="tablist" aria-label="Principal variation line">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={pvMode === 'best'}
                      className={`gr-pv-toggle-btn${pvMode === 'best' ? ' is-active' : ''}`}
                      disabled={!pvHasSteps}
                      onClick={() => {
                        setPvMode('best');
                        setPvStepIndex(0);
                      }}
                    >
                      Best
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={pvMode === 'played'}
                      className={`gr-pv-toggle-btn${pvMode === 'played' ? ' is-active' : ''}`}
                      disabled={!pvHasSteps}
                      onClick={() => {
                        setPvMode('played');
                        setPvStepIndex(0);
                      }}
                    >
                      Played
                    </button>
                  </div>
                </div>
                {pvHasSteps ? (
                  <>
                    <div className="gr-pv-board">
                      <Board
                        key={`gr-pv-board-${current.moveNumber}-${pvMode}-${pvSafeStepIndex}`}
                        board={pvBoards[pvSafeStepIndex] ?? null}
                        legalMoves={[]}
                        selectedTile={null}
                        onPositionClick={() => {}}
                        fitMode="guided"
                        containFullBoard
                        tileSize={28}
                      />
                    </div>
                    <div className="gr-pv-steps">
                      <button
                        type="button"
                        className="dfd__btn gr-nav-btn"
                        onClick={() => setPvStepIndex((prev) => Math.max(0, prev - 1))}
                        disabled={pvSafeStepIndex <= 0}
                        aria-label="Previous principal variation step"
                      >
                        {'<'}
                      </button>
                      <span className="gr-pv-step-label">
                        {pvSafeStepIndex === 0
                          ? 'Pre-move position'
                          : describePrincipalVariationStep(pvSteps[pvSafeStepIndex - 1], opponentLabel)}
                        {' · '}
                        {`Step ${pvSafeStepIndex} / ${pvSteps.length}`}
                      </span>
                      <button
                        type="button"
                        className="dfd__btn gr-nav-btn"
                        onClick={() => setPvStepIndex((prev) => Math.min(pvBoards.length - 1, prev + 1))}
                        disabled={pvSafeStepIndex >= pvBoards.length - 1}
                        aria-label="Next principal variation step"
                      >
                        {'>'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="gr-pv-empty">No continuation recorded for this move.</p>
                )}
              </div>
            ) : null}
          </div>

          <aside className="gr-sidebar">
            {hands.length > 0 ? (
              <div className="gr-hand-strip" role="tablist" aria-label="Hands">
                {hands.map((hand) => {
                  const isActive = hand.handNumber === selectedHandNumber;
                  return (
                    <button
                      key={hand.handNumber}
                      type="button"
                      className={`gr-hand-pill${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedHandNumber(hand.handNumber);
                        setCursor(0);
                      }}
                    >
                      Hand {hand.handNumber} · {hand.handAccuracy.toFixed(0)}%
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="gr-move-list" role="listbox" aria-label="Moves in selected hand">
              {moves.length === 0 ? (
                <p className="gr-empty">No moves available to review in this hand.</p>
              ) : null}
              {moves.map((move, idx) => {
                const decisionId = decisionIdByMoveNumber?.get(move.moveNumber);
                const evaluation = decisionId && reviewWorkerBatch
                  ? reviewWorkerBatch.resultsByDecisionId.get(decisionId)
                  : undefined;
                const factsForMove =
                  decisionId && historicalCoachingByDecisionId?.has(decisionId)
                    ? historicalCoachingByDecisionId.get(decisionId)!.facts
                    : decisionId
                      // Read published facts only — never call getFacts here.
                      // Sidebar enumeration must not construct Fritz for every
                      // row on each render (breaks once-per-decision caching).
                      ? factsStore.byDecisionId.get(decisionId) ?? null
                      : null;
                const presentation = buildReviewPresentationRecord(evaluation, factsForMove ?? null);
                const classification = presentation.classification
                  ?? (reviewWorkerBatch
                    ? selectMoveHeuristicClassification(decisionId, reviewWorkerBatch, {
                        primaryReferenceAction: factsForMove?.best.action,
                      })
                    : null);

                const unavailable =
                  Boolean(reviewWorkerBatch?.done)
                  && Boolean(decisionId || reviewWorkerBatch)
                  && !evaluation
                  && classification == null
                  && !(decisionId && reviewWorkerBatch?.pendingDecisionIds.has(decisionId));

                const display = classification ? heuristicClassificationToDisplay(classification) : null;
                const searchTier = reviewWorkerBatch ? selectMoveSearchTier(decisionId, reviewWorkerBatch) : null;
                const label = unavailable
                  ? 'Unavailable'
                  : (display?.label ?? move.rating);
                const rowRatingClass = unavailable
                  ? 'unavailable'
                  : (display?.ratingClass ?? ratingClass(move.rating));
                const badge = unavailable ? null : (display?.badge ?? searchTier);
                const decisionIndex = idx + 1;
                return (
                  <button
                    key={`${move.moveNumber}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={idx === cursor}
                    className={`gr-move-row is-${rowRatingClass}${idx === cursor ? ' is-active' : ''}`}
                    onClick={() => setCursor(idx)}
                  >
                    <span className="gr-move-row-num">#{decisionIndex}</span>
                    <span className="gr-move-row-played">{formatPlayedLabel(move)}</span>
                    <span className="gr-move-row-rating-cell">
                      <span className={`gr-move-row-rating is-${rowRatingClass}`}>{label}</span>
                      {badge ? (
                        <span className={`gr-move-row-badge is-${badge}`}>{BADGE_TEXT[badge]}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={`gr-coaching${coaching ? ' is-prominent' : ''}`}>
              <div className="gr-coaching-body">
              {ratingCoachingCopy ? (
                <div className="gr-advice-section">
                  <span className="gr-advice-kicker">Why this rating</span>
                  <p className="gr-advice-copy">{ratingCoachingCopy}</p>
                </div>
              ) : null}
              {!current ? (
                <p className="gr-coaching-muted">Select a move to review.</p>
              ) : coaching ? (
                <>
                  <div className="gr-advice-section">
                    <span className="gr-advice-kicker">What happened</span>
                    <p className="gr-advice-copy gr-advice-headline">{coaching.prose.headline}</p>
                    {coaching.prose.detail ? (
                      <p className="gr-advice-copy">{coaching.prose.detail}</p>
                    ) : null}
                  </div>
                  {coaching.prose.takeaway ? (
                    <div className="gr-advice-section">
                      <span className="gr-advice-kicker">What to remember</span>
                      <p className="gr-advice-copy gr-advice-takeaway">{coaching.prose.takeaway}</p>
                    </div>
                  ) : null}
                </>
              ) : coachingStatus === 'pending' ? (
                <p className="gr-coaching-muted">Analyzing this move…</p>
              ) : coachingStatus === 'error' ? (
                <p className="gr-coaching-muted">{"This move couldn't be analyzed."}</p>
              ) : (
                <p className="gr-coaching-muted">Review data not available for this move.</p>
              )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
