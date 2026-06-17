import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';
import { useJourneyProgress } from './useJourneyProgress';
import { getChapterProgressRecord } from './journeyChapters';
import {
  buildJourneyBotTrial,
  isJourneyBotTrialNode,
  isJourneyCheckpointBriefingNode,
  isJourneyPuzzleNode,
} from './journeyLaunch';
import { getJourneyBriefing } from './journeyBriefings';
import { JourneyBriefingModal } from './JourneyBriefingModal';
import { getJourneyPuzzle } from './journeyPuzzles';
import { JourneyPuzzleModal } from './JourneyPuzzleModal';
import { getChapterRuntimeStatusLabel, isPlayableChapterId } from './journeyChapters';
import { JourneyChapterCompleteModal } from './JourneyChapterCompleteModal';
import type { JourneyActiveChallenge } from './journeyRuntime';
import type {
  JourneyChapterRuntimeStatus,
  JourneyChapterWithStatus,
  JourneyNodeAction,
  JourneyNodeType,
  JourneyNodeWithStatus,
} from './journeyTypes';
import {
  buildJourneyTrailLayout,
  getJourneyTrailVisualProgress,
} from './journeyTrailPath';
import { getChapter1GridPlacement } from './journeyChapter1Layout';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import './racehorseJourney.css';

interface RacehorseJourneyScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartBotTrial?: (challenge: JourneyActiveChallenge) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

const themeVars = {
  '--rh-bg': '#050911',
  '--rh-panel': '#09101A',
  '--rh-brass': '#D7A64A',
  '--rh-text': '#F2EEE8',
} as CSSProperties;

function nodeTypeLabel(type: JourneyNodeType): string {
  if (type === 'checkpoint') return 'Checkpoint';
  if (type === 'boss') return 'Boss Trial';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function nodeTypeGlyph(type: JourneyNodeType): string {
  if (type === 'checkpoint') return '◆';
  if (type === 'puzzle') return '?';
  if (type === 'boss') return '★';
  return '×';
}

function statusLabel(status: JourneyNodeWithStatus['status']): string {
  if (status === 'current') return 'Current';
  if (status === 'completed') return 'Completed';
  if (status === 'unlocked') return 'Unlocked';
  return 'Locked';
}

function getJourneyTrialAction(node: JourneyNodeWithStatus | null): Extract<JourneyNodeAction, { kind: 'botMatch' }> | null {
  if (!node || node.action.kind !== 'botMatch' || (node.nodeType !== 'match' && node.nodeType !== 'boss')) {
    return null;
  }
  return node.action;
}

function getJourneyTrialFormatLabel(node: JourneyNodeWithStatus, action: Extract<JourneyNodeAction, { kind: 'botMatch' }>): string {
  const winningScore = action.winningScore ?? 60;
  if (node.nodeType === 'boss') return `Boss trial · Race to ${winningScore}`;
  const trialFormat = action.trialFormat ?? (winningScore < 60 ? 'shortRace' : 'fullMatch');
  return trialFormat === 'shortRace' ? `Race to ${winningScore}` : `Full match to ${winningScore}`;
}

function getJourneyTrialCtaLabel(node: JourneyNodeWithStatus, action: Extract<JourneyNodeAction, { kind: 'botMatch' }>): string {
  return `Begin Trial · ${getJourneyTrialFormatLabel(node, action)}`;
}

function chapterStatusClass(status: JourneyChapterRuntimeStatus): string {
  return `rh-journey-chapter-card--${status.replace('_', '-')}`;
}

function canSelectJourneyChapter(chapter: JourneyChapterWithStatus): boolean {
  if (!isPlayableChapterId(chapter.chapterId)) return false;
  return (
    chapter.runtimeStatus === 'in_progress' ||
    chapter.runtimeStatus === 'available' ||
    chapter.runtimeStatus === 'completed'
  );
}

function JourneyNodeButton({
  node,
  selected,
  onSelect,
}: {
  node: JourneyNodeWithStatus;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const isBoss = node.nodeType === 'boss';
  const statusClass = `rh-journey-node--${node.status}${isBoss ? ' rh-journey-node--boss' : ''}`;
  const disabled = node.status === 'locked';

  return (
    <div className="rh-journey-node-wrap">
      <button
        type="button"
        className={`rh-journey-node ${statusClass}${selected ? ' rh-journey-node--selected' : ''}`}
        disabled={disabled}
        aria-current={node.status === 'current' ? 'step' : undefined}
        aria-label={`${node.title}, ${statusLabel(node.status)}`}
        onClick={() => onSelect(node.id)}
      >
        <span className="rh-journey-node__face" aria-hidden="true">
          <span className="rh-journey-node__glyph">{nodeTypeGlyph(node.nodeType)}</span>
          <span className="rh-journey-node__divider" />
          <span className="rh-journey-node__num">{node.order}</span>
        </span>
        {node.status === 'completed' ? (
          <span className="rh-journey-node__seal" aria-hidden="true">
            ✓
          </span>
        ) : node.badgeText ? (
          <span className="rh-journey-node__badge">{node.badgeText}</span>
        ) : null}
      </button>
    </div>
  );
}

export default function RacehorseJourneyScreen({
  onBack,
  onNavigate,
  onStartBotTrial,
  onOpenAuth,
  onOpenAccount,
}: RacehorseJourneyScreenProps) {
  const {
    activeChapter,
    chaptersWithStatus,
    nodesWithStatus,
    summary,
    progress,
    activeChapterComplete,
    shouldShowChapterCompleteCelebration,
    selectNode,
    selectChapter,
    completeNode,
    celebrateChapterCompletion,
  } = useJourneyProgress();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [briefingModalOpen, setBriefingModalOpen] = useState(false);
  const [puzzleModalOpen, setPuzzleModalOpen] = useState(false);
  const [chapterCompleteModalOpen, setChapterCompleteModalOpen] = useState(false);
  const chapterRailRef = useRef<HTMLDivElement>(null);

  const activeChapterProgress = useMemo(
    () => getChapterProgressRecord(progress, activeChapter.chapterId),
    [progress, activeChapter.chapterId],
  );

  const initialSelection = useMemo(() => {
    const current = nodesWithStatus.find((node) => node.status === 'current');
    if (current) return current.id;
    const lastVisited = activeChapterProgress.lastVisitedNodeId;
    if (lastVisited) {
      const lastNode = nodesWithStatus.find((node) => node.id === lastVisited);
      if (lastNode && lastNode.status !== 'locked') return lastVisited;
    }
    return nodesWithStatus[0]?.id ?? null;
  }, [nodesWithStatus, activeChapterProgress.lastVisitedNodeId]);

  useEffect(() => {
    setSelectedNodeId((current) => current ?? initialSelection);
  }, [initialSelection]);

  useEffect(() => {
    if (shouldShowChapterCompleteCelebration) {
      setChapterCompleteModalOpen(true);
    }
  }, [shouldShowChapterCompleteCelebration]);

  useEffect(() => {
    const rail = chapterRailRef.current;
    if (!rail) return;
    const activeCard = rail.querySelector<HTMLElement>('[data-chapter-id][aria-current="true"]');
    activeCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeChapter.chapterId]);

  const selectedNode = useMemo(
    () => nodesWithStatus.find((node) => node.id === selectedNodeId) ?? null,
    [nodesWithStatus, selectedNodeId],
  );

  const progressPct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;
  const trailLayout = useMemo(
    () => buildJourneyTrailLayout(nodesWithStatus.length, activeChapter.chapterId),
    [nodesWithStatus.length, activeChapter.chapterId],
  );
  const trailProgressPct = useMemo(
    () => getJourneyTrailVisualProgress(nodesWithStatus),
    [nodesWithStatus],
  );
  const isChapter1Ladder = activeChapter.chapterId === JOURNEY_CHAPTER_1_ID;
  const activeChapterWithStatus =
    chaptersWithStatus.find((chapter) => chapter.chapterId === activeChapter.chapterId) ?? null;
  const canBegin =
    selectedNode != null && (selectedNode.status === 'current' || selectedNode.status === 'unlocked');
  const isBotTrialNode = selectedNode != null && isJourneyBotTrialNode(selectedNode);
  const isCheckpointBriefingNode =
    selectedNode != null && isJourneyCheckpointBriefingNode(selectedNode);
  const isPuzzleNode = selectedNode != null && isJourneyPuzzleNode(selectedNode);
  const briefingReviewMode = selectedNode?.status === 'completed' && isCheckpointBriefingNode;
  const puzzleReviewMode = selectedNode?.status === 'completed' && isPuzzleNode;
  const activeBriefing =
    selectedNode && isCheckpointBriefingNode ? getJourneyBriefing(selectedNode.id) : null;
  const activePuzzle = selectedNode && isPuzzleNode ? getJourneyPuzzle(selectedNode.id) : null;
  const selectedTrialAction = getJourneyTrialAction(selectedNode);

  const beginButtonLabel = (() => {
    if (!selectedNode) return 'Begin';
    if (isBotTrialNode && selectedTrialAction) {
      return getJourneyTrialCtaLabel(selectedNode, selectedTrialAction);
    }
    if (isCheckpointBriefingNode) {
      return briefingReviewMode ? 'Review Briefing' : 'Open Briefing';
    }
    if (isPuzzleNode) {
      return puzzleReviewMode ? 'Review Challenge' : 'Open Challenge';
    }
    return 'Begin';
  })();

  const canOpenBriefing =
    isCheckpointBriefingNode &&
    (selectedNode?.status === 'current' ||
      selectedNode?.status === 'unlocked' ||
      selectedNode?.status === 'completed');

  const canOpenPuzzle =
    isPuzzleNode &&
    (selectedNode?.status === 'current' ||
      selectedNode?.status === 'unlocked' ||
      selectedNode?.status === 'completed');

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    selectNode(nodeId);
  };

  const handleSelectChapter = (chapter: JourneyChapterWithStatus) => {
    if (!canSelectJourneyChapter(chapter)) return;
    if (chapter.chapterId === activeChapter.chapterId) return;
    selectChapter(chapter.chapterId);
    setSelectedNodeId(null);
    setBriefingModalOpen(false);
    setPuzzleModalOpen(false);
  };

  const handleBegin = () => {
    if (!selectedNode) return;
    if (isCheckpointBriefingNode && canOpenBriefing) {
      setBriefingModalOpen(true);
      return;
    }
    if (isPuzzleNode && canOpenPuzzle) {
      setPuzzleModalOpen(true);
      return;
    }
    if (!canBegin) return;
    if (isBotTrialNode && onStartBotTrial) {
      const trial = buildJourneyBotTrial(selectedNode);
      if (trial) {
        onStartBotTrial(trial);
        return;
      }
    }
  };

  const handleCompleteBriefing = () => {
    if (!selectedNode || briefingReviewMode) {
      setBriefingModalOpen(false);
      return;
    }
    if (selectedNode.status === 'locked' || selectedNode.status === 'completed') return;
    completeNode(selectedNode.id);
    setBriefingModalOpen(false);
  };

  const handleCompletePuzzle = () => {
    if (!selectedNode || puzzleReviewMode) {
      setPuzzleModalOpen(false);
      return;
    }
    if (selectedNode.status === 'locked' || selectedNode.status === 'completed') return;
    completeNode(selectedNode.id);
    setPuzzleModalOpen(false);
  };

  const handleDismissChapterComplete = () => {
    setChapterCompleteModalOpen(false);
    celebrateChapterCompletion(activeChapter.chapterId);
  };

  return (
    <div
      className="relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] text-[var(--rh-text)] home-page-root rh-journey-root"
      style={themeVars}
    >
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <div className="home-shell relative mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col">
        <GlobalNav
          currentMode="journey"
          activeColor="#E7B64A"
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onOpenAccount={onOpenAccount}
        />

        <header className="rh-journey-header relative z-10">
          <div className="rh-journey-command-strip">
            <Button
              variant="ghost"
              className="rh-back-button rh-journey-command-strip__back"
              onClick={onBack}
              type="button"
            >
              ← Single Player
            </Button>
            <div className="rh-journey-command-strip__chapter">
              <div className="rh-journey-hero__crest" aria-hidden="true">
                <span className="rh-journey-hero__crest-label">Ch</span>
                <span className="rh-journey-hero__crest-number">{activeChapter.chapterNumber}</span>
              </div>
              <div className="rh-journey-hero__headlines">
                <h1 className="rh-journey-title">{activeChapter.title}</h1>
                <p className="rh-journey-subtitle">{activeChapter.subtitle}</p>
              </div>
            </div>
            <div className="rh-journey-command-strip__progress" aria-label="Chapter progress">
              <span className="rh-journey-command-strip__progress-value">{progressPct}%</span>
              <div className="rh-journey-progress-rail" aria-hidden="true">
                <div className="rh-journey-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="rh-journey-command-strip__progress-meta">
                {summary.completed}/{summary.total}
              </span>
            </div>
          </div>

          {activeChapterComplete ? (
            <div className="rh-journey-chapter-complete-banner" role="status">
              <p className="rh-journey-chapter-complete-banner__title">
                Chapter {activeChapter.chapterNumber} Complete
              </p>
              <p className="rh-journey-chapter-complete-banner__body">
                {activeChapter.chapterNumber === 1
                  ? `${activeChapter.title} cleared. More chapters of Racehorse Journey are coming—this is only the first march.`
                  : activeChapter.chapterNumber === 6
                    ? `${activeChapter.title} cleared. You reached the current Master Table—more Journey chapters are still ahead.`
                    : `${activeChapter.title} cleared. ${activeChapter.nextChapterCopy}`}
              </p>
            </div>
          ) : null}

          <section className="rh-journey-chapters" aria-label="Journey chapters">
            <div className="rh-journey-chapters__head">
              <div>
                <p className="rh-journey-chapters__label">Campaign Ledger</p>
                <p className="rh-journey-chapters__active">
                  Chapter {activeChapter.chapterNumber} ·{' '}
                  {getChapterRuntimeStatusLabel(activeChapterWithStatus?.runtimeStatus ?? 'in_progress')}
                </p>
              </div>
              <p className="rh-journey-chapters__scroll-hint">Scroll chapters</p>
            </div>
            <div className="rh-journey-chapters__rail">
              <div
                ref={chapterRailRef}
                className="rh-journey-chapters__row"
                role="list"
                aria-label="Journey chapter list"
              >
              {chaptersWithStatus.map((chapter) => {
                const isActive = chapter.chapterId === activeChapter.chapterId;
                const statusLabel = getChapterRuntimeStatusLabel(chapter.runtimeStatus);
                const selectable = canSelectJourneyChapter(chapter);
                return (
                  <div
                    key={chapter.chapterId}
                    data-chapter-id={chapter.chapterId}
                    className={`rh-journey-chapter-card ${chapterStatusClass(chapter.runtimeStatus)}${
                      isActive ? ' rh-journey-chapter-card--active' : ''
                    }${selectable ? ' rh-journey-chapter-card--selectable' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    role="listitem"
                    aria-disabled={selectable ? undefined : true}
                    tabIndex={selectable ? 0 : -1}
                    onClick={() => handleSelectChapter(chapter)}
                    onKeyDown={(event) => {
                      if (!selectable) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectChapter(chapter);
                      }
                    }}
                  >
                    <span className="rh-journey-chapter-card__plaque">{chapter.chapterNumber}</span>
                    <p className="rh-journey-chapter-card__eyebrow">Chapter {chapter.chapterNumber}</p>
                    <p className="rh-journey-chapter-card__title">{chapter.title}</p>
                    <p className="rh-journey-chapter-card__subtitle">{chapter.subtitle}</p>
                    <p className="rh-journey-chapter-card__status">{statusLabel}</p>
                    {chapter.releaseStatus === 'playable' && chapter.totalNodes > 0 ? (
                      <>
                        <p className="rh-journey-chapter-card__progress">
                          {chapter.completedNodes} / {chapter.totalNodes} nodes
                        </p>
                        <div className="rh-journey-chapter-card__rail" aria-hidden="true">
                          <div
                            className="rh-journey-chapter-card__fill"
                            style={{
                              width: `${
                                chapter.totalNodes > 0
                                  ? Math.round((chapter.completedNodes / chapter.totalNodes) * 100)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="rh-journey-chapter-card__teaser">{chapter.nextChapterCopy}</p>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          </section>
        </header>

        <main className="rh-journey-main relative z-10">
          <section
            className={`rh-journey-map-panel${
              isChapter1Ladder ? ' rh-journey-map-panel--ladder' : ''
            }`}
            aria-label={`${activeChapter.title} map`}
          >
            <div className="rh-journey-map-panel__head">
              <div className="rh-journey-map-panel__head-left">
                <p className="rh-journey-map-label">Campaign Board</p>
                <h2 className="rh-journey-map-panel__title">{activeChapter.title}</h2>
                <p className="rh-journey-map-panel__route-label">{activeChapter.title} Map</p>
              </div>
              <div className="rh-journey-map-panel__head-right">
                <div className="rh-journey-map-panel__record">
                  <span className="rh-journey-map-panel__record-label">Chapter</span>
                  <strong className="rh-journey-map-panel__record-value">
                    {summary.completed}/{summary.total}
                  </strong>
                </div>
                <div className="rh-journey-map-legend" aria-label="Node state legend">
                  <span className="rh-journey-map-legend__item rh-journey-map-legend__item--complete">Cleared</span>
                  <span className="rh-journey-map-legend__item rh-journey-map-legend__item--current">Current</span>
                  <span className="rh-journey-map-legend__item rh-journey-map-legend__item--locked">Ahead</span>
                </div>
              </div>
            </div>
            <div className="rh-journey-map-scroll">
              <div className="rh-journey-table-surface" aria-hidden="true" />
              <div
                className={`rh-journey-trail${
                  isChapter1Ladder ? ' rh-journey-trail--campaign-ladder' : ''
                }`}
                style={
                  {
                    '--journey-trail-progress': trailProgressPct,
                    '--journey-trail-rows': trailLayout.rowCount,
                  } as CSSProperties
                }
              >
                {trailLayout.pathD ? (
                  <svg
                    className="rh-journey-trail-path"
                    viewBox={trailLayout.viewBox}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      className="rh-journey-trail-path__shadow"
                      pathLength={100}
                      d={trailLayout.pathD}
                    />
                    <path
                      className="rh-journey-trail-path__future"
                      pathLength={100}
                      d={trailLayout.pathD}
                    />
                    <path
                      className="rh-journey-trail-path__traveled"
                      pathLength={100}
                      style={{ strokeDasharray: `${trailProgressPct} 100` }}
                      d={trailLayout.pathD}
                    />
                  </svg>
                ) : null}
                {nodesWithStatus.map((node, index) => {
                  const position = trailLayout.positions[index] ?? { x: 50, y: 50 };
                  const gridPlacement = isChapter1Ladder ? getChapter1GridPlacement(index) : null;
                  return (
                  <div
                    key={node.id}
                    className={`rh-journey-trail-step rh-journey-trail-step--${node.status}${
                      node.nodeType === 'boss' ? ' rh-journey-trail-step--boss' : ''
                    }`}
                    style={
                      (gridPlacement
                        ? {
                            gridColumn: gridPlacement.col,
                            gridRow: gridPlacement.row,
                          }
                        : {
                            '--trail-pos-x': `${position.x}%`,
                            '--trail-pos-y': `${position.y}%`,
                            '--trail-tile-anchor': '40px',
                          }) as CSSProperties
                    }
                  >
                    <div className="rh-journey-node-caption">
                      <p
                        className={`rh-journey-node-caption__title${
                          node.status === 'locked' ? ' rh-journey-node-caption__title--dim' : ''
                        }`}
                      >
                        {node.title}
                      </p>
                      {node.status !== 'locked' ? (
                        <p className="rh-journey-node-caption__type">{nodeTypeLabel(node.nodeType)}</p>
                      ) : null}
                    </div>
                    <JourneyNodeButton
                      node={node}
                      selected={selectedNodeId === node.id}
                      onSelect={handleSelectNode}
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section
            className={`rh-journey-detail rh-journey-detail--panel${
              selectedNode ? '' : ' rh-journey-detail--empty'
            }`}
            aria-label="Selected node details"
          >
            {selectedNode ? (
              <>
                <div className="rh-journey-detail__main">
                  <p className="rh-journey-detail__kicker">
                    Chapter {activeChapter.chapterNumber} · Node {selectedNode.order} ·{' '}
                    {nodeTypeLabel(selectedNode.nodeType)}
                  </p>

                  <h2 className="rh-journey-detail__title">{selectedNode.title}</h2>
                  <p className="rh-journey-detail__subtitle">{selectedNode.subtitle}</p>

                  <div className="rh-journey-detail__reward-card">
                    <span className="rh-journey-detail__reward-label">Reward</span>
                    <strong className="rh-journey-detail__reward-value">{selectedNode.rewardText}</strong>
                    {selectedTrialAction ? (
                      <span className="rh-journey-detail__reward-format">
                        {getJourneyTrialFormatLabel(selectedNode, selectedTrialAction)}
                      </span>
                    ) : null}
                  </div>

                  <p className="rh-journey-detail__mission-body">{selectedNode.completionCriteria}</p>
                </div>

                <div className="rh-journey-detail__actions">
                  <Button
                    variant="tier-elite"
                    type="button"
                    disabled={!(canBegin || canOpenBriefing || canOpenPuzzle)}
                    onClick={handleBegin}
                  >
                    {beginButtonLabel}
                  </Button>
                </div>
              </>
            ) : (
              <p>Select a trail node to view details.</p>
            )}
          </section>
        </main>
      </div>

      <JourneyBriefingModal
        open={briefingModalOpen}
        briefing={activeBriefing}
        reviewMode={briefingReviewMode}
        onClose={() => setBriefingModalOpen(false)}
        onComplete={briefingReviewMode ? undefined : handleCompleteBriefing}
      />

      <JourneyPuzzleModal
        open={puzzleModalOpen}
        puzzle={activePuzzle}
        reviewMode={puzzleReviewMode}
        onClose={() => setPuzzleModalOpen(false)}
        onComplete={puzzleReviewMode ? undefined : handleCompletePuzzle}
      />

      <JourneyChapterCompleteModal
        open={chapterCompleteModalOpen}
        chapter={activeChapterComplete ? activeChapter : null}
        onClose={handleDismissChapterComplete}
      />
    </div>
  );
}
