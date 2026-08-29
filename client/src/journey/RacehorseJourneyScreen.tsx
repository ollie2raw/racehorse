import { useMemo, useState, type CSSProperties } from 'react';
import { BookOpen, Check, Crown, Grid3x3, Lock, Puzzle } from 'lucide-react';
import type { FritzTier } from '../bot/fritzConfig';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';
import { useJourneyProgress } from './useJourneyProgress';
import { getChapterProgressRecord, isPlayableChapterId } from './journeyChapters';
import {
  buildJourneyBotTrial,
  getJourneyTrialRuntime,
  isJourneyBotTrialNode,
  isJourneyCheckpointBriefingNode,
  isJourneyPuzzleNode,
} from './journeyLaunch';
import { getJourneyBriefing } from './journeyBriefings';
import { getJourneyContentDescriptor } from './journeyContentResolver';
import { getJourneyLessonDefinition } from './journeyContentResolver';
import { getJourneyPremiumHostKind } from './journeyPremiumRuntimeRegistry';
import { JourneyLessonHost } from './lessonHost/JourneyLessonHost';
import { assertNever } from './journeyContentContract';
import { JourneyBriefingModal } from './JourneyBriefingModal';
import { getJourneyPuzzle } from './journeyPuzzles';
import { JourneyPuzzleModal } from './JourneyPuzzleModal';
import { InteractivePuzzleModal } from './InteractivePuzzleModal';
import { JourneyChapterCompleteModal } from './JourneyChapterCompleteModal';
import type { JourneyActiveChallenge } from './journeyRuntime';
import type {
  JourneyChapterWithStatus,
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
  onSignOut?: () => void;
}

const themeVars = {
  '--rh-bg': '#050911',
  '--rh-panel': '#09101A',
  '--rh-brass': '#C9A84C',
  '--rh-text': '#f0e6cc',
} as CSSProperties;

function nodeTypeLabel(type: JourneyNodeType): string {
  if (type === 'checkpoint') return 'Checkpoint';
  if (type === 'boss') return 'Boss Trial';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatFritzTierLabel(tier: FritzTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function getJourneyWinConditionLabel(node: JourneyNodeWithStatus): string {
  const trialRuntime = getJourneyTrialRuntime(node);
  if (trialRuntime) {
    return `Win vs ${formatFritzTierLabel(trialRuntime.fritzTier)} Fritz · Race to ${trialRuntime.winningScore}`;
  }
  return node.completionCriteria;
}

function statusLabel(status: JourneyNodeWithStatus['status']): string {
  if (status === 'current') return 'Current';
  if (status === 'completed') return 'Completed';
  if (status === 'unlocked') return 'Unlocked';
  return 'Locked';
}

function canSelectJourneyChapter(chapter: JourneyChapterWithStatus): boolean {
  if (!isPlayableChapterId(chapter.chapterId)) return false;
  return (
    chapter.runtimeStatus === 'in_progress' ||
    chapter.runtimeStatus === 'available' ||
    chapter.runtimeStatus === 'completed'
  );
}

function chapterModuleShortTitle(title: string): string {
  return title.replace(/^The /, '');
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
  const disabled = node.status === 'locked';
  const Icon =
    node.nodeType === 'checkpoint'
      ? BookOpen
      : node.nodeType === 'puzzle'
        ? Puzzle
        : node.nodeType === 'boss'
          ? Crown
          : Grid3x3;

  return (
    <div className="rh-journey-node-wrap">
      <button
        type="button"
        className={`rh-journey-node rh-journey-node--${node.nodeType} rh-journey-node--${node.status}${
          selected ? ' rh-journey-node--selected' : ''
        }`}
        disabled={disabled}
        aria-current={node.status === 'current' ? 'step' : undefined}
        aria-label={`${node.title}, ${statusLabel(node.status)}`}
        onClick={() => onSelect(node.id)}
      >
        <span className="rh-journey-node__icon" aria-hidden="true">
          <Icon size={node.nodeType === 'boss' ? 26 : 20} strokeWidth={2.2} />
        </span>
        {node.status === 'locked' && (
          <span className="rh-journey-node__lock" aria-hidden="true">
            <Lock size={10} strokeWidth={2.5} />
          </span>
        )}
        {node.status === 'completed' ? (
          <span className="rh-journey-node__check" aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
      </button>
      <span
        className={`rh-journey-node__label${
          node.status === 'locked' ? ' rh-journey-node__label--dim' : ''
        }`}
      >
        {node.title}
      </span>
      {node.status === 'completed' && node.badgeText ? (
        <span className="rh-journey-node__reward">{node.badgeText}</span>
      ) : null}
    </div>
  );
}

export default function RacehorseJourneyScreen({
  onBack,
  onNavigate,
  onStartBotTrial,
  onOpenAuth,
  onSignOut,
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
  const [interactivePuzzleOpen, setInteractivePuzzleOpen] = useState(false);
  const [activePremiumLessonContentId, setActivePremiumLessonContentId] = useState<string | null>(null);
  const [premiumLessonInstance, setPremiumLessonInstance] = useState(0);
  const [chapterCompleteDismissed, setChapterCompleteDismissed] = useState(false);

  if (!shouldShowChapterCompleteCelebration && chapterCompleteDismissed) {
    setChapterCompleteDismissed(false);
  }
  const chapterCompleteModalOpen = shouldShowChapterCompleteCelebration && !chapterCompleteDismissed;

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

  const activeNodeId = selectedNodeId ?? initialSelection;

  const selectedNode = useMemo(
    () => nodesWithStatus.find((node) => node.id === activeNodeId) ?? null,
    [nodesWithStatus, activeNodeId],
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
  const selectedTrialRuntime = getJourneyTrialRuntime(selectedNode);
  const selectedDescriptor = selectedNode ? getJourneyContentDescriptor(selectedNode.id) : null;
  const selectedPremiumHost = selectedDescriptor?.migrationClass === 'premium'
    ? getJourneyPremiumHostKind(String(selectedDescriptor.contentId))
    : null;

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

  const canOpenPremiumLesson =
    selectedPremiumHost === 'authored_board_lesson' &&
    selectedDescriptor?.runtimeAvailability === 'available' &&
    (selectedNode?.status === 'current' || selectedNode?.status === 'unlocked' || selectedNode?.status === 'completed');

  const detailCtaLabel = (() => {
    if (!selectedNode) return 'Play';
    if (selectedNode.status === 'locked') return 'Locked';
    if (selectedNode.status === 'completed') return selectedPremiumHost ? 'Replay Lesson' : 'Completed ✓';
    return 'Play';
  })();

  const detailCtaDisabled =
    !selectedNode ||
    selectedNode.status === 'locked' ||
    (selectedNode.status === 'completed' && !selectedPremiumHost) ||
    !(canBegin || canOpenBriefing || canOpenPuzzle || canOpenPremiumLesson);

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
    setInteractivePuzzleOpen(false);
  };

  const handleBegin = () => {
    if (!selectedNode) return;
    const descriptor = getJourneyContentDescriptor(selectedNode.id);
    if (!descriptor) return;

    switch (descriptor.runtime.kind) {
      case 'briefing_acknowledgement':
        if (isCheckpointBriefingNode && canOpenBriefing) setBriefingModalOpen(true);
        return;
      case 'static_decision':
        if (isPuzzleNode && canOpenPuzzle) setPuzzleModalOpen(true);
        return;
      case 'interactive_board_decision':
        if (isPuzzleNode && canOpenPuzzle) setInteractivePuzzleOpen(true);
        return;
      case 'bot_match':
      case 'boss_match': {
        if (!canBegin || !isBotTrialNode || !onStartBotTrial) return;
        const trial = buildJourneyBotTrial(selectedNode);
        if (trial) onStartBotTrial(trial);
        return;
      }
      case 'external_navigation':
        onNavigate?.(descriptor.runtime.mode);
        return;
      case 'lesson_sequence':
        if (descriptor.runtimeAvailability !== 'available') return;
        if (getJourneyPremiumHostKind(String(descriptor.contentId)) !== 'authored_board_lesson') return;
        setActivePremiumLessonContentId(String(descriptor.contentId));
        return;
      case 'unsupported':
        return;
      default:
        return assertNever(descriptor.runtime);
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
      setInteractivePuzzleOpen(false);
      return;
    }
    if (selectedNode.status === 'locked' || selectedNode.status === 'completed') return;
    completeNode(selectedNode.id);
    setPuzzleModalOpen(false);
    setInteractivePuzzleOpen(false);
  };

  const handleDismissChapterComplete = () => {
    setChapterCompleteDismissed(true);
    celebrateChapterCompletion(activeChapter.chapterId);
  };

  if (activePremiumLessonContentId) {
    const lessonDefinition = getJourneyLessonDefinition(activePremiumLessonContentId);
    if (lessonDefinition) {
      return (
        <JourneyLessonHost
          key={`${activePremiumLessonContentId}-${premiumLessonInstance}`}
          definition={lessonDefinition}
          onExit={() => setActivePremiumLessonContentId(null)}
          onReplay={() => setPremiumLessonInstance((current) => current + 1)}
          onLessonCompleted={() => completeNode(lessonDefinition.nodeId)}
        />
      );
    }
  }

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
          activeColor="#C9A84C"
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onSignOut={onSignOut}
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
              <div className="rh-journey-module-strip" role="tablist" aria-label="Journey chapters">
                {chaptersWithStatus.map((chapter) => {
                  const isActive = chapter.chapterId === activeChapter.chapterId;
                  const selectable = canSelectJourneyChapter(chapter);
                  return (
                    <button
                      key={chapter.chapterId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-disabled={!selectable}
                      disabled={!selectable}
                      title={
                        selectable
                          ? chapter.title
                          : `${chapter.title} — complete the previous chapter to unlock`
                      }
                      className={`rh-journey-module-pill rh-journey-module-pill--${chapter.runtimeStatus}${
                        isActive ? ' rh-journey-module-pill--active' : ''
                      }${selectable ? ' rh-journey-module-pill--selectable' : ''}`}
                      onClick={() => handleSelectChapter(chapter)}
                    >
                      <span className="rh-journey-module-pill__num" aria-hidden="true">
                        {chapter.chapterNumber}
                      </span>
                      <span className="rh-journey-module-pill__title">
                        {chapterModuleShortTitle(chapter.title)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rh-journey-command-strip__progress" aria-label="Chapter progress">
              <span className="rh-journey-command-strip__progress-value">
                {summary.completed} / {summary.total} nodes
              </span>
              <div className="rh-journey-progress-rail" aria-hidden="true">
                <div className="rh-journey-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
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
                    <JourneyNodeButton
                      node={node}
                      selected={activeNodeId === node.id}
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
                <div
                  className={`rh-journey-detail__main${
                    selectedNode.nodeType === 'boss' ? ' rh-journey-detail__main--boss' : ''
                  }`}
                >
                  {selectedNode.nodeType === 'boss' ? (
                    <p className="rh-journey-detail__boss-label">Chapter Boss</p>
                  ) : null}

                  <div className="rh-journey-detail__meta">
                    <span className={`rh-journey-chip rh-journey-chip--type-${selectedNode.nodeType}`}>
                      {nodeTypeLabel(selectedNode.nodeType)}
                    </span>
                    {selectedTrialRuntime ? (
                      <span
                        className={`rh-journey-chip rh-journey-tier--${selectedTrialRuntime.fritzTier}`}
                      >
                        {selectedTrialRuntime.fritzTier.toUpperCase()}
                      </span>
                    ) : null}
                  </div>

                  <h2 className="rh-journey-detail__title">{selectedNode.title}</h2>
                  <p className="rh-journey-detail__subtitle">{selectedNode.subtitle}</p>

                  <p className="rh-journey-detail__win-condition">
                    {getJourneyWinConditionLabel(selectedNode)}
                  </p>

                  <div
                    className={`rh-journey-detail__reward-card${
                      selectedNode.status !== 'completed' ? ' rh-journey-detail__reward-card--locked' : ''
                    }`}
                  >
                    <span className="rh-journey-detail__reward-label">Reward</span>
                    <strong className="rh-journey-detail__reward-value">{selectedNode.rewardText}</strong>
                  </div>
                </div>

                <div className="rh-journey-detail__actions">
                  <Button
                    variant="tier-elite"
                    className={selectedNode.nodeType === 'boss' ? 'rh-journey-detail__cta--boss' : undefined}
                    type="button"
                    disabled={detailCtaDisabled}
                    onClick={handleBegin}
                  >
                    {detailCtaLabel}
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

      {activePuzzle?.boardState ? (
        <InteractivePuzzleModal
          open={interactivePuzzleOpen}
          puzzle={activePuzzle}
          reviewMode={puzzleReviewMode}
          onClose={() => setInteractivePuzzleOpen(false)}
          onComplete={
            puzzleReviewMode
              ? undefined
              : () => {
                  setInteractivePuzzleOpen(false);
                  handleCompletePuzzle();
                }
          }
        />
      ) : null}

      <JourneyChapterCompleteModal
        open={chapterCompleteModalOpen}
        chapter={activeChapterComplete ? activeChapter : null}
        onClose={handleDismissChapterComplete}
      />
    </div>
  );
}
