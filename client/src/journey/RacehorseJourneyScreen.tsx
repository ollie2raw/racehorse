import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FritzTier } from '../bot/fritzConfig';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { Button, Modal } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';
import { useJourneyProgress } from './useJourneyProgress';
import { getChapterProgressRecord, isPlayableChapterId } from './journeyChapters';
import {
  buildJourneyBotTrial,
  getJourneyTrialRuntime,
  isJourneyBotTrialNode,
  isJourneyCheckpointBriefingNode,
  isJourneyPuzzleNode,
  isJourneyPuzzleSprintNode,
} from './journeyLaunch';
import { getJourneyBriefing } from './journeyBriefings';
import { getJourneyContentDescriptor } from './journeyContentResolver';
import { getJourneyLessonDefinition } from './journeyContentResolver';
import { getJourneyPremiumHostKind } from './journeyPremiumRuntimeRegistry';
import { JourneyLessonHost } from './lessonHost/JourneyLessonHost';
import { assertNever } from './journeyContentContract';
import { JourneyBriefingModal } from './JourneyBriefingModal';
import { getJourneyPuzzle } from './journeyPuzzles';
import { getJourneyPuzzleSprint } from './journeyPuzzleSprints';
import { classifyJourneyLessonCompletion } from './journeyLessonCompletionStatus';
import type { JourneyMatchOutcomeResult } from './journeyCompletionCore';
import {
  journeyStageAttemptDetail,
  recordJourneyLessonCompletion,
  recordJourneySprintResult,
} from './journeyStageCompletion';
import { JourneyPuzzleModal } from './JourneyPuzzleModal';
import { InteractivePuzzleModal } from './InteractivePuzzleModal';
import { PuzzleSprintModal } from './PuzzleSprintModal';
import { useJourneyAttemptTracker } from './useJourneyAttemptTracker';
import { abandonStaleJourneyMatchAttempts } from './journeyMatchOutcome';
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

/** What the player is being asked to do — lessons and sprints are not "puzzles" or "checkpoints". */
function stageKindLabel(node: JourneyNodeWithStatus): string {
  if (node.action.kind === 'lesson') return 'Lesson';
  if (node.action.kind === 'puzzleSprint') return 'Sprint';
  return nodeTypeLabel(node.nodeType);
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

/** A small padlock glyph for the locked chapter boss — gives the hexagon an
    identity instead of reading as an empty placeholder shape. */
function LockGlyph() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
      <rect x="2" y="9" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <path d="M5.5 9V6a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
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
          {node.status === 'locked' ? <LockGlyph /> : null}
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
    syncProgressFromStorage,
    celebrateChapterCompletion,
  } = useJourneyProgress();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [briefingModalOpen, setBriefingModalOpen] = useState(false);
  const [puzzleModalOpen, setPuzzleModalOpen] = useState(false);
  const [interactivePuzzleOpen, setInteractivePuzzleOpen] = useState(false);
  const [puzzleSprintOpen, setPuzzleSprintOpen] = useState(false);
  const [activePremiumLessonContentId, setActivePremiumLessonContentId] = useState<string | null>(null);
  const [premiumLessonInstance, setPremiumLessonInstance] = useState(0);
  const [chapterCompleteDismissed, setChapterCompleteDismissed] = useState(false);
  const lessonAttempt = useJourneyAttemptTracker('lesson');
  const sprintAttempt = useJourneyAttemptTracker('sprint');
  /** The run whose completion the lesson screen last recorded, so a user-initiated re-check can read its status. */
  const lessonCompletionRun = useRef<{ attemptId: string | null; nodeId: string; result: JourneyMatchOutcomeResult | null } | null>(null);

  // Returning to the trail settles match attempts that can no longer finish: left by browser back or a
  // swipe (no exit handler ran) or orphaned by a refresh (the attempt log reconciles those on read).
  useEffect(() => {
    abandonStaleJourneyMatchAttempts();
  }, []);

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
  const isPuzzleSprintNode = selectedNode != null && isJourneyPuzzleSprintNode(selectedNode);
  const briefingReviewMode = selectedNode?.status === 'completed' && isCheckpointBriefingNode;
  const puzzleReviewMode = selectedNode?.status === 'completed' && isPuzzleNode;
  const puzzleSprintReviewMode = selectedNode?.status === 'completed' && isPuzzleSprintNode;
  const activeBriefing =
    selectedNode && isCheckpointBriefingNode ? getJourneyBriefing(selectedNode.id) : null;
  const activePuzzle = selectedNode && isPuzzleNode ? getJourneyPuzzle(selectedNode.id) : null;
  const activePuzzleSprint =
    selectedNode && isPuzzleSprintNode ? getJourneyPuzzleSprint(selectedNode.id) : null;
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

  const canOpenPuzzleSprint =
    isPuzzleSprintNode &&
    (selectedNode?.status === 'current' ||
      selectedNode?.status === 'unlocked' ||
      selectedNode?.status === 'completed');

  const canOpenPremiumLesson =
    selectedPremiumHost === 'authored_board_lesson' &&
    selectedDescriptor?.runtimeAvailability === 'available' &&
    (selectedNode?.status === 'current' || selectedNode?.status === 'unlocked' || selectedNode?.status === 'completed');

  // A stage whose runtime does not exist yet (e.g. a lesson still to be authored) must say so, not
  // offer a Play button that does nothing.
  const contentUnavailable =
    selectedDescriptor?.runtimeAvailability === 'unavailable' && selectedNode?.status !== 'locked';

  const detailCtaLabel = (() => {
    if (!selectedNode) return 'Play';
    if (selectedNode.status === 'locked') return 'Locked';
    if (contentUnavailable) return 'In development';
    if (selectedNode.status === 'completed') return selectedPremiumHost ? 'Replay Lesson' : 'Completed ✓';
    return 'Play';
  })();

  const detailCtaDisabled =
    !selectedNode ||
    selectedNode.status === 'locked' ||
    contentUnavailable ||
    (selectedNode.status === 'completed' && !selectedPremiumHost) ||
    !(canBegin || canOpenBriefing || canOpenPuzzle || canOpenPuzzleSprint || canOpenPremiumLesson);

  // Distinguishes "done, nothing left to do" from "locked, can't do it yet" —
  // both disable the CTA, but they should not look the same (a completed
  // node is a positive record, not a dead control).
  const detailCtaCompleted = selectedNode?.status === 'completed' && !selectedPremiumHost;

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    selectNode(nodeId);
    setSheetOpen(true);
  };

  // The "Current Node" header stat looked like a button but did nothing —
  // scroll that node into view on the map, then open its mission modal same
  // as clicking it directly.
  const handleJumpToCurrentNode = (nodeId: string) => {
    const index = nodesWithStatus.findIndex((node) => node.id === nodeId);
    nodeElRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    handleSelectNode(nodeId);
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
    setPuzzleSprintOpen(false);
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
        lessonAttempt.start(selectedNode.id, journeyStageAttemptDetail(selectedNode.id, {
          contentId: String(descriptor.contentId),
          replay: selectedNode.status === 'completed',
        }));
        setActivePremiumLessonContentId(String(descriptor.contentId));
        return;
      case 'unsupported':
        return;
      case 'puzzle_sprint':
        if (isPuzzleSprintNode && canOpenPuzzleSprint) {
          // Completed sprints reopen as a review, not a new scored attempt.
          if (selectedNode.status !== 'completed') sprintAttempt.start(selectedNode.id, journeyStageAttemptDetail(selectedNode.id));
          setPuzzleSprintOpen(true);
        }
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

  const handleCompletePuzzleSprint = (result: { correct: number; total: number }) => {
    setPuzzleSprintOpen(false);
    if (!selectedNode || puzzleSprintReviewMode) return;
    if (selectedNode.status === 'locked' || selectedNode.status === 'completed') return;
    // One durable sequence (pending obligation → settle → apply and verify → clear). A pass is credited only
    // if the result satisfies the sprint predicate; a fail is recorded as lost and can never be recovered as a win.
    recordJourneySprintResult({
      attemptId: sprintAttempt.getAttemptId(),
      nodeId: selectedNode.id,
      correct: result.correct,
      total: result.total,
    });
    syncProgressFromStorage();
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
          onExit={() => {
            // A no-op if the lesson already completed (a terminal attempt is never rewritten).
            lessonAttempt.settle('abandoned');
            // Leaving never clears a pending completion; it gives the existing recovery another chance to finish it, so
            // the trail the player returns to reflects whatever the stored obligations now allow.
            syncProgressFromStorage();
            setActivePremiumLessonContentId(null);
          }}
          onReplay={() => {
            lessonAttempt.start(String(lessonDefinition.nodeId), journeyStageAttemptDetail(String(lessonDefinition.nodeId), {
              contentId: String(lessonDefinition.id),
              replay: true,
            }));
            setPremiumLessonInstance((current) => current + 1);
          }}
          onLessonCompleted={(session) => {
            // Credit comes from the controller's completed session, validated and recorded through the shared
            // durable sequence — not from the fact that the host called back. An incomplete or invalid session
            // writes nothing; a duplicate callback finds a terminal attempt and changes nothing.
            const attemptId = lessonAttempt.getAttemptId();
            const nodeId = String(lessonDefinition.nodeId);
            // Remember the run BEFORE recording, so a user-initiated re-check can still read real storage if the
            // record call itself throws (the host then shows "unverified", never success).
            lessonCompletionRun.current = { attemptId, nodeId, result: null };
            const result = recordJourneyLessonCompletion({ attemptId, nodeId, session });
            lessonCompletionRun.current = { attemptId, nodeId, result };
            syncProgressFromStorage();
            // Tell the player what was actually saved, read back from storage — never just that the lesson was passed.
            return classifyJourneyLessonCompletion({ attemptId, nodeId, result });
          }}
          onRecheckCompletion={() => {
            // User-initiated only. Re-runs the existing recovery and re-reads storage; it never records a second
            // completion, so it cannot disturb attempt ownership or bypass proof validation.
            const run = lessonCompletionRun.current;
            if (!run) return { kind: 'unverified' };
            syncProgressFromStorage();
            return classifyJourneyLessonCompletion({ attemptId: run.attemptId, nodeId: run.nodeId, result: null });
          }}
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
              <Button variant="ghost" className="rh-jt-back" data-rh-parent-back onClick={onBack} type="button">
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
              {currentNode ? (
                <>
                  <span className="rh-jt-stat-divider" aria-hidden="true" />
                  <button
                    type="button"
                    className="rh-jt-stat-card__jump"
                    onClick={() => handleJumpToCurrentNode(currentNode.id)}
                    aria-label={`Jump to current node: ${currentNode.title}`}
                  >
                    <span className="rh-jt-stat-icon" aria-hidden="true">
                      ▸
                    </span>
                    <div>
                      <div className="rh-jt-stat-value rh-jt-stat-value--name">{currentNode.title}</div>
                      <div className="rh-jt-stat-caption">CURRENT NODE</div>
                    </div>
                  </button>
                </>
              ) : null}
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

        <Modal
          open={sheetOpen && !!selectedNode}
          onClose={() => setSheetOpen(false)}
          title={selectedNode?.title}
          maxWidth={420}
          panelClassName="rh-jt-mission-panel"
        >
          {selectedNode ? (
            <div className="rh-jt-mission">
              <p className="rh-jt-mission__eyebrow">
                {stageKindLabel(selectedNode)}
                {selectedTrialRuntime ? ` · ${selectedTrialRuntime.fritzTier.toUpperCase()}` : ''}
              </p>
              <p className="rh-jt-mission__subtitle">{selectedNode.subtitle}</p>
              <p className="rh-jt-mission__win">{getJourneyWinConditionLabel(selectedNode)}</p>
              <div className="rh-jt-mission__divider" />
              <div className="rh-jt-mission__reward">
                <span>Reward</span>
                <strong>{selectedNode.rewardText}</strong>
              </div>
              <button
                type="button"
                className={`rh-jt-mission__cta${detailCtaCompleted ? ' rh-jt-mission__cta--done' : ''}`}
                disabled={detailCtaDisabled}
                onClick={handleBegin}
              >
                {detailCtaLabel}
              </button>
            </div>
          ) : null}
        </Modal>
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

      <PuzzleSprintModal
        open={puzzleSprintOpen}
        puzzles={activePuzzleSprint ?? []}
        timeLimitSec={
          selectedDescriptor?.runtime.kind === 'puzzle_sprint' ? selectedDescriptor.runtime.timeLimitSec : 60
        }
        title={selectedNode?.title}
        onComplete={puzzleSprintReviewMode ? () => setPuzzleSprintOpen(false) : handleCompletePuzzleSprint}
        onExit={() => {
          sprintAttempt.settle('abandoned');
          setPuzzleSprintOpen(false);
        }}
      />

      <JourneyChapterCompleteModal
        open={chapterCompleteModalOpen}
        chapter={activeChapterComplete ? activeChapter : null}
        onClose={handleDismissChapterComplete}
      />
    </div>
  );
}









