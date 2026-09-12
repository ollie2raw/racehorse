import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
import { buildJourneyTrailLayout } from './journeyTrailLayout';
import './racehorseJourney.css';
import './racehorseJourneyTrail.css';

interface RacehorseJourneyScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartBotTrial?: (challenge: JourneyActiveChallenge) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

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

/** A checkmark polyline matching the handoff's inline SVG exactly. */
function DoneCheckmark() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
      <polyline
        points="1,7 6,12 17,1"
        fill="none"
        stroke="var(--rh-jt-green)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function JourneyTrailNode({
  node,
  index,
  chapterShortTitle,
  position,
  onSelect,
  nodeRef,
}: {
  node: JourneyNodeWithStatus;
  index: number;
  chapterShortTitle: string;
  position: { x: number; y: number };
  onSelect: (nodeId: string) => void;
  nodeRef: (el: HTMLDivElement | null) => void;
}) {
  const isBoss = node.nodeType === 'boss';
  const ariaLabel = `${node.title}, ${statusLabel(node.status)}`;

  let inner: ReactNode;
  if (isBoss) {
    const bossModifier =
      node.status === 'completed' ? 'boss-done' : node.status === 'current' || node.status === 'unlocked' ? 'boss-current' : null;
    inner = (
      <div className="rh-jt-node__inner rh-jt-node__inner--boss">
        <button
          type="button"
          className={`rh-jt-node__mark rh-jt-node__mark--boss${bossModifier ? ` rh-jt-node__mark--${bossModifier}` : ''}`}
          aria-label={ariaLabel}
          onClick={() => onSelect(node.id)}
        >
          {node.status === 'completed' ? <DoneCheckmark /> : null}
        </button>
        {node.status === 'locked' ? (
          <span className="rh-jt-node__caption rh-jt-node__caption--boss-locked">CHAPTER FINALE · LOCKED</span>
        ) : (
          <span
            className={`rh-jt-node__name${node.status === 'current' || node.status === 'unlocked' ? ' rh-jt-node__name--current' : ''}`}
          >
            {node.title}
          </span>
        )}
      </div>
    );
  } else if (node.status === 'completed') {
    inner = (
      <div className="rh-jt-node__inner">
        <button type="button" className="rh-jt-node__mark rh-jt-node__mark--done" aria-label={ariaLabel} onClick={() => onSelect(node.id)}>
          <DoneCheckmark />
        </button>
        <span className="rh-jt-node__name">{node.title}</span>
      </div>
    );
  } else if (node.status === 'current' || node.status === 'unlocked') {
    inner = (
      <div className="rh-jt-node__inner rh-jt-node__inner--current">
        <span className="rh-jt-node__caption">
          {chapterShortTitle.toUpperCase()} · {index + 1}
        </span>
        <button
          type="button"
          className="rh-jt-node__mark rh-jt-node__mark--current"
          aria-current="step"
          aria-label={ariaLabel}
          onClick={() => onSelect(node.id)}
        />
        <span className="rh-jt-node__name rh-jt-node__name--current">{node.title}</span>
      </div>
    );
  } else {
    inner = (
      <div className="rh-jt-node__inner rh-jt-node__inner--locked">
        <button type="button" className="rh-jt-node__mark rh-jt-node__mark--locked" aria-label={ariaLabel} onClick={() => onSelect(node.id)} />
        <span className="rh-jt-node__caption rh-jt-node__caption--locked">LOCKED</span>
      </div>
    );
  }

  return (
    <div
      ref={nodeRef}
      className="rh-jt-node"
      style={{ left: `${position.x}%`, top: `${position.y}px` } as CSSProperties}
    >
      {inner}
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

  const [sheetOpen, setSheetOpen] = useState(false);
  const trailLayout = useMemo(
    () => buildJourneyTrailLayout(nodesWithStatus.length),
    [nodesWithStatus.length],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nodeElRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeRailIndex, setActiveRailIndex] = useState(0);

  // Right-edge scroll rail: highlight whichever node sits nearest the
  // vertical center of the scroll container's own viewport.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateActive = () => {
      const containerRect = container.getBoundingClientRect();
      const centerY = containerRect.top + containerRect.height / 2;
      let closestIndex = 0;
      let closestDist = Infinity;
      nodeElRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - centerY);
        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });
      setActiveRailIndex((current) => (current === closestIndex ? current : closestIndex));
    };

    updateActive();
    container.addEventListener('scroll', updateActive, { passive: true });
    return () => container.removeEventListener('scroll', updateActive);
  }, [nodesWithStatus.length]);

  // Center the current node in view on first load / chapter switch.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const currentIndex = nodesWithStatus.findIndex((node) => node.status === 'current');
    const focalIndex = currentIndex >= 0 ? currentIndex : 0;
    const focalPosition = trailLayout.positions[focalIndex];
    if (!focalPosition) return;
    container.scrollTop = Math.max(0, focalPosition.y - container.clientHeight / 2);
  }, [activeChapter.chapterId, trailLayout, nodesWithStatus]);

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
    setSheetOpen(true);
  };

  const handleSelectChapter = (chapter: JourneyChapterWithStatus) => {
    if (!canSelectJourneyChapter(chapter)) return;
    if (chapter.chapterId === activeChapter.chapterId) return;
    selectChapter(chapter.chapterId);
    setSelectedNodeId(null);
    setSheetOpen(false);
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
        setSheetOpen(false);
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

  const currentNode = nodesWithStatus.find((node) => node.status === 'current' || node.status === 'unlocked');
  const activeChapterIndex = chaptersWithStatus.findIndex((chapter) => chapter.chapterId === activeChapter.chapterId);
  const nextChapter = activeChapterIndex >= 0 ? chaptersWithStatus[activeChapterIndex + 1] : undefined;
  const showNextChapterTeaser = !!nextChapter && nextChapter.runtimeStatus === 'locked';

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
      className="relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] home-page-root rh-journey-root"
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

      <div className="home-shell relative mx-auto flex min-h-0 w-full flex-1 flex-col rh-journey-trail-page">
        <GlobalNav
          currentMode="journey"
          activeColor="#C9A84C"
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onSignOut={onSignOut}
        />

        <div className="rh-journey-trail-scroll relative z-10" ref={scrollRef}>
          <div className="rh-jt-header">
            <div className="rh-jt-header__left">
              <Button variant="ghost" className="rh-jt-back" onClick={onBack} type="button">
                ← Single Player
              </Button>
              <div className="rh-jt-title-block">
                <div className="rh-jt-title-row">
                  <span className="rh-jt-title-num">{String(activeChapter.chapterNumber).padStart(2, '0')}</span>
                  <h1 className="rh-jt-title">{chapterModuleShortTitle(activeChapter.title)}</h1>
                </div>
                <div className="rh-jt-subtitle">{activeChapter.subtitle}</div>
              </div>
            </div>

            <div className="rh-jt-stat-card">
              <span className="rh-jt-stat-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <div className="rh-jt-stat-value">
                  {summary.completed} / {summary.total}
                </div>
                <div className="rh-jt-stat-caption">NODES CLEARED</div>
              </div>
              <span className="rh-jt-stat-divider" aria-hidden="true" />
              <span className="rh-jt-stat-icon" aria-hidden="true">
                ▸
              </span>
              <div>
                <div className="rh-jt-stat-value rh-jt-stat-value--name">{currentNode?.title ?? '—'}</div>
                <div className="rh-jt-stat-caption">CURRENT NODE</div>
              </div>
            </div>
          </div>

          <div className="rh-jt-tabs" role="tablist" aria-label="Journey chapters">
            {chaptersWithStatus.map((chapter) => {
              const isActive = chapter.chapterId === activeChapter.chapterId;
              const selectable = canSelectJourneyChapter(chapter);
              const pct = chapter.totalNodes > 0 ? Math.round((chapter.completedNodes / chapter.totalNodes) * 100) : 0;
              return (
                <button
                  key={chapter.chapterId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-disabled={!selectable}
                  disabled={!selectable}
                  title={selectable ? chapter.title : `${chapter.title} — complete the previous chapter to unlock`}
                  className={`rh-jt-tab${isActive ? ' rh-jt-tab--active' : ''}`}
                  onClick={() => handleSelectChapter(chapter)}
                >
                  <span className="rh-jt-tab__label">
                    {String(chapter.chapterNumber).padStart(2, '0')} {chapterModuleShortTitle(chapter.title).toUpperCase()}
                  </span>
                  <span className="rh-jt-tab__track" aria-hidden="true">
                    <span className="rh-jt-tab__fill" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>

          {activeChapterComplete ? (
            <div className="rh-journey-chapter-complete-banner relative z-10" role="status">
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

          <div className="rh-jt-map-wrap">
            <div className="rh-jt-map" style={{ height: `${trailLayout.containerHeight}px` }} aria-label={`${activeChapter.title} map`}>
              {trailLayout.pathD ? (
                <svg
                  className="rh-jt-map-svg"
                  width="100%"
                  height={trailLayout.containerHeight}
                  viewBox={`0 0 ${trailLayout.viewBoxWidth} ${trailLayout.containerHeight}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path className="rh-jt-path-glow" d={trailLayout.pathD} />
                  <path className="rh-jt-path-trail" d={trailLayout.pathD} />
                </svg>
              ) : null}
              {nodesWithStatus.map((node, index) => {
                const position = trailLayout.positions[index] ?? { x: 50, y: 0 };
                return (
                  <JourneyTrailNode
                    key={node.id}
                    node={node}
                    index={index}
                    chapterShortTitle={chapterModuleShortTitle(activeChapter.title)}
                    position={position}
                    onSelect={handleSelectNode}
                    nodeRef={(el) => {
                      nodeElRefs.current[index] = el;
                    }}
                  />
                );
              })}
            </div>

            {showNextChapterTeaser && nextChapter ? (
              <div className="rh-jt-teaser">
                <div>
                  <div className="rh-jt-teaser__eyebrow">
                    {String(nextChapter.chapterNumber).padStart(2, '0')} {chapterModuleShortTitle(nextChapter.title).toUpperCase()} · LOCKED
                  </div>
                  <div className="rh-jt-teaser__title">Chapter {nextChapter.chapterNumber}</div>
                </div>
                <span className="rh-jt-teaser__icon" aria-hidden="true" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="rh-jt-rail" aria-hidden="true">
          {nodesWithStatus.map((node, index) => {
            const isActive = index === activeRailIndex;
            const dotModifier = node.status === 'completed' ? ' rh-jt-rail__dot--done' : node.status === 'current' || node.status === 'unlocked' ? ' rh-jt-rail__dot--current' : '';
            return <span key={node.id} className={`rh-jt-rail__dot${isActive ? ' rh-jt-rail__dot--active' : ''}${dotModifier}`} />;
          })}
        </div>

        <div className={`rh-journey-w-sheet${sheetOpen && selectedNode ? ' rh-journey-w-sheet--open' : ''}`}>
          {selectedNode ? (
            <div className="rh-journey-w-sheet__inner">
              <button
                type="button"
                className="rh-journey-w-sheet__close"
                aria-label="Close"
                onClick={() => setSheetOpen(false)}
              >
                ×
              </button>
              <div className="rh-journey-w-sheet__top">
                <div>
                  <span className={`rh-journey-chip rh-journey-chip--type-${selectedNode.nodeType}`}>
                    {nodeTypeLabel(selectedNode.nodeType)}
                  </span>
                  {selectedTrialRuntime ? (
                    <span
                      className={`rh-journey-chip rh-journey-tier--${selectedTrialRuntime.fritzTier}`}
                      style={{ marginLeft: 6 }}
                    >
                      {selectedTrialRuntime.fritzTier.toUpperCase()}
                    </span>
                  ) : null}
                  <h3 className="rh-journey-w-sheet__title">{selectedNode.title}</h3>
                  <p className="rh-journey-w-sheet__sub">{selectedNode.subtitle}</p>
                </div>
                <div className="rh-journey-w-sheet__reward">
                  <span>Reward</span>
                  <strong>{selectedNode.rewardText}</strong>
                </div>
              </div>
              <div className="rh-journey-w-sheet__bottom">
                <span className="rh-journey-w-sheet__win">{getJourneyWinConditionLabel(selectedNode)}</span>
                <Button variant="tier-elite" type="button" disabled={detailCtaDisabled} onClick={handleBegin}>
                  {detailCtaLabel}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
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
