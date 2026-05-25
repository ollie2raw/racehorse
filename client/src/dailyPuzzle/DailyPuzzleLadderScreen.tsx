import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, DominoTile, GlobalNav, MatchNblBoardFrame, RotateOverlay } from '../components';
import { Button } from '../components/primitives';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { AppMode, Move, Tile } from '../types';
import {
  completeDailyPuzzleLadder,
  startDailyPuzzleLadder,
  submitDailyPuzzleSlot,
} from './api';
import { createPuzzleMatchState } from './validator';
import type {
  CuratedDailyPuzzle,
  DailyPuzzleAttempt,
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
} from './types';
import DailyPuzzleLadderLeaderboardScreen from './DailyPuzzleLadderLeaderboardScreen';
import dailyLadderHeroImg from '../assets/dailyPuzzle/newnewladderfinal.png';
import {
  buildLadderShareData,
  buildLadderShareText,
  invokeLadderShareResult,
} from './ladderShareCard';
import { getDisplayStreak, recordSolvedStreak } from './streakStorage';
import { getDailyPuzzleDisplayTitle, getDailyPuzzleStepPresentation } from './presentation';
import '../dailyFritz/dailyFritz.css';
import './dailyPuzzle.css';

interface DailyPuzzleLadderScreenProps {
  user: User | null;
  profile: UserProfile | null;
  initialToday: DailyPuzzleTodayResponse;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

type PlayStatus = 'IN_PROGRESS' | 'SOLVED' | 'FAILED';
type LadderPlayMode = 'scored' | 'practice';

function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const LadderIconSameBoard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" opacity={0.92} />
  </svg>
);

const LadderIconOrdered = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="5" cy="7" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="5" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

const LadderIconLeaderboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M8 21V11M12 21V7M16 21V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 11h4M10 7h4M14 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.5} />
  </svg>
);

const DplIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);

const DplIconFlame = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);

const DplIconLock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

const DplIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);

const DplIconLayers = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M12 2l8 4.5v7L12 18l-8-4.5v-7L12 2z" />
    <path d="M12 11l8-4.5M12 11v7M12 11L4 6.5" />
  </svg>
);

type LadderPuzzleCardState = 'active' | 'locked' | 'done' | 'idle';

function getLadderPuzzleCardState(row: {
  slotResult?: { awardedPoints: number } | null;
  isLocked: boolean;
  isAvailable: boolean;
}): LadderPuzzleCardState {
  if (row.slotResult) return 'done';
  if (row.isLocked) return 'locked';
  if (row.isAvailable) return 'active';
  return 'idle';
}

function toCuratedPuzzle(slot: DailyPuzzleSlot): CuratedDailyPuzzle | null {
  if (!slot.startingBoard || !slot.startingHand) return null;
  return {
    id: slot.id,
    puzzleDate: slot.puzzleDate,
    title: getDailyPuzzleDisplayTitle(slot.slotIndex, slot.slotTitle),
    startingBoard: slot.startingBoard,
    startingHand: slot.startingHand,
    maxMoves: slot.maxMoves,
    targetScore: slot.targetScore,
    puzzleType: slot.puzzleType,
    dealSize: slot.dealSize,
    slotIndex: slot.slotIndex,
    slotTitle: slot.slotTitle,
    tier: slot.tier,
    slotMaxPoints: slot.slotMaxPoints,
    objectiveType: slot.objectiveType,
    objectivePayload: slot.objectivePayload,
    setVersion: 1,
    published: true,
  };
}

export default function DailyPuzzleLadderScreen({
  user,
  profile,
  initialToday,
  onBack,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
}: DailyPuzzleLadderScreenProps) {
  const [today, setToday] = useState(initialToday);
  const [attempt, setAttempt] = useState<DailyPuzzleAttempt | null>(initialToday.attempt);
  const [activeSlot, setActiveSlot] = useState<DailyPuzzleSlot | null>(null);
  const [playMode, setPlayMode] = useState<LadderPlayMode>('scored');
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [finalizePending, setFinalizePending] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [slotOverlay, setSlotOverlay] = useState<{
    response: DailyPuzzleSubmitSlotResponse;
    rawScore: number;
  } | null>(null);
  const [finalOverlay, setFinalOverlay] = useState<{
    response: DailyPuzzleCompleteResponse;
  } | null>(null);
  const [practiceOverlay, setPracticeOverlay] = useState<{
    slotIndex: number;
    slotTitle: string;
    rawScore: number;
    bestPossible: number | null;
  } | null>(null);
  const [shareDone, setShareDone] = useState(false);
  const startTimeRef = useRef(0);
  const runningScoreRef = useRef(0);
  const moveTraceRef = useRef<Array<Record<string, unknown>>>([]);
  const lastPlayedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completedSlots = attempt?.result.slots ?? [];
  const nextSlotIndex = attempt?.status === 'completed' ? null : (attempt?.currentSlotIndex ?? 1);
  const currentScore = runtimeState?.players.you.score ?? 0;
  const displayScore =
    activeSlot?.puzzleType === 'one_turn_high_score' ? (finalScore ?? runningScoreRef.current) : currentScore;

  useEffect(() => {
    return () => {
      if (lastPlayedTimerRef.current) clearTimeout(lastPlayedTimerRef.current);
    };
  }, []);

  const launchSlot = useCallback((slot: DailyPuzzleSlot, mode: LadderPlayMode) => {
    const puzzle = toCuratedPuzzle(slot);
    if (!puzzle) {
      setHubError(`Slot ${slot.slotIndex} is missing board data.`);
      return;
    }
    setPlayMode(mode);
    setActiveSlot(slot);
    setRuntimeState(createPuzzleMatchState(puzzle));
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
    setMovesUsed(0);
    setFinalScore(null);
    runningScoreRef.current = 0;
    moveTraceRef.current = [];
    startTimeRef.current = Date.now();
    setSlotOverlay(null);
    setFinalOverlay(null);
    setPracticeOverlay(null);
  }, []);

  const handleStartScored = useCallback(async () => {
    if (startPending) return;
    setStartPending(true);
    setHubError(null);
    try {
      const response = await startDailyPuzzleLadder(today.runDate);
      setAttempt(response.attempt);
      setToday((current) => ({ ...current, attemptStatus: response.attempt.status, attempt: response.attempt }));
      launchSlot(response.activeSlot, response.practiceMode === 'none' ? 'scored' : 'practice');
    } catch (error) {
      setHubError(error instanceof Error ? error.message : 'Unable to start today’s ladder.');
    } finally {
      setStartPending(false);
    }
  }, [launchSlot, startPending, today.runDate]);

  const handleStartPractice = useCallback((slotIndex: 1 | 2 | 3) => {
    const slot = today.slots.find((entry) => entry.slotIndex === slotIndex);
    if (!slot) return;
    launchSlot(slot, 'practice');
  }, [launchSlot, today.slots]);

  const legalMoves = useMemo(() => {
    if (!runtimeState || status !== 'IN_PROGRESS') return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((move) => move.type === 'play');
  }, [runtimeState, status]);

  useEffect(() => {
    if (!runtimeState) return;
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, runtimeState.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
      const maxTileSize = 56;
      const containerWidth = window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };
    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [runtimeState?.players.you.hand.length]);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTimerRef.current) clearTimeout(lastPlayedTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTimerRef.current = null;
      }, 2200);
    }
  }, []);

  const completeSlot = useCallback(async (
    nextStatus: PlayStatus,
    rawScoreValue: number,
  ) => {
    if (!activeSlot) return;
    if (playMode === 'practice') {
      setPracticeOverlay({
        slotIndex: activeSlot.slotIndex,
        slotTitle: activeSlot.slotTitle,
        rawScore: rawScoreValue,
        bestPossible: activeSlot.bestPossibleScore,
      });
      return;
    }
    if (!attempt || submitPending) return;
    setSubmitPending(true);
    setHubError(null);
    try {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
      const response = await submitDailyPuzzleSlot({
        attemptId: attempt.id,
        puzzleDate: attempt.puzzleDate,
        slotIndex: activeSlot.slotIndex,
        puzzleId: activeSlot.id,
        rawScore: rawScoreValue,
        movesUsed,
        elapsedSeconds,
        submittedLine: moveTraceRef.current,
        clientResult: {
          status: nextStatus,
          slotTitle: activeSlot.slotTitle,
          rawScore: rawScoreValue,
        },
      });
      setAttempt(response.attempt);
      setToday((current) => ({
        ...current,
        attemptStatus: response.attempt.status,
        attempt: response.attempt,
      }));
      if (response.ladderCompleted) {
        setFinalizePending(true);
        const completeResponse = await completeDailyPuzzleLadder({
          attemptId: response.attempt.id,
          puzzleDate: response.attempt.puzzleDate,
        });
        setAttempt(completeResponse.attempt);
        setToday((current) => ({
          ...current,
          attemptStatus: completeResponse.attempt.status,
          attempt: completeResponse.attempt,
        }));
        setFinalOverlay({ response: completeResponse });
        recordSolvedStreak(completeResponse.attempt.puzzleDate);
      } else {
        setSlotOverlay({ response, rawScore: rawScoreValue });
      }
    } catch (error) {
      setHubError(error instanceof Error ? error.message : 'Unable to submit slot result.');
    } finally {
      setSubmitPending(false);
      setFinalizePending(false);
    }
  }, [activeSlot, attempt, movesUsed, playMode, submitPending]);

  const onPositionClick = useCallback((position: Move['position']) => {
    if (!runtimeState || !activeSlot || !selectedTile || status !== 'IN_PROGRESS') return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.tile &&
        candidate.position === position &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const pointsAwarded = result.scored?.points ?? 0;
    const nextMoves = movesUsed + 1;
    const totalScore = nextState.players.you.score;

    setRuntimeState(nextState);
    setSelectedTile(null);
    setMovesUsed(nextMoves);
    flashLastPlayed(move.tile ?? null);
    moveTraceRef.current = [
      ...moveTraceRef.current,
      {
        tile: move.tile,
        position: move.position,
        pointsAwarded,
        totalScore,
      },
    ];

    if (activeSlot.puzzleType === 'one_turn_high_score') {
      const isDouble = move.tile!.low === move.tile!.high;
      const newRunningScore = runningScoreRef.current + pointsAwarded;
      const upcoming = getLegalMoves(nextState, 'you').filter((c) => c.type === 'play');

      if ((pointsAwarded === 0 && !isDouble) || upcoming.length === 0) {
        runningScoreRef.current = newRunningScore;
        setFinalScore(newRunningScore);
        setStatus('SOLVED');
        void completeSlot('SOLVED', newRunningScore);
      } else {
        runningScoreRef.current = newRunningScore;
      }
      return;
    }

    if (totalScore >= activeSlot.targetScore && nextMoves <= activeSlot.maxMoves) {
      setFinalScore(totalScore);
      setStatus('SOLVED');
      void completeSlot('SOLVED', totalScore);
      return;
    }

    if (nextMoves >= activeSlot.maxMoves && totalScore < activeSlot.targetScore) {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
      return;
    }

    if (nextState.currentPlayer !== 'you') {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
      return;
    }

    const upcoming = getLegalMoves(nextState, 'you').filter((candidate) => candidate.type === 'play');
    if (upcoming.length === 0) {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
    }
  }, [activeSlot, completeSlot, flashLastPlayed, legalMoves, movesUsed, runtimeState, selectedTile, status]);

  useEffect(() => {
    if (!activeSlot || activeSlot.puzzleType !== 'one_turn_high_score' || status !== 'IN_PROGRESS') return;
    if (runtimeState == null) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    void completeSlot('FAILED', 0);
  }, [activeSlot, completeSlot, legalMoves.length, runtimeState, status]);

  const currentSlotBreakdown = useMemo(() => {
    return [1, 2, 3].map((slotIndex) => {
      const result = completedSlots.find((entry) => entry.slotIndex === slotIndex);
      const step = getDailyPuzzleStepPresentation(slotIndex);
      return {
        slotIndex,
        label: step.shortLabel,
        value: result ? `${result.awardedPoints}` : '—',
      };
    });
  }, [completedSlots]);

  const streakDisplay = useMemo(() => getDisplayStreak(today.runDate), [today.runDate]);

  const profileRating = useMemo(() => {
    const raw = profile?.glicko_rating;
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : undefined;
  }, [profile?.glicko_rating]);

  const hubLadderShareText = useMemo(() => {
    if (attempt?.status !== 'completed') return '';
    const previewRank =
      user?.id != null
        ? (today.leaderboardPreview.find((row) => row.userId === user.id)?.rank ?? null)
        : null;
    const data = buildLadderShareData({
      runDate: today.runDate,
      attempt,
      rank: previewRank,
      shareStreak: streakDisplay,
      shareRating: profileRating,
    });
    return buildLadderShareText(data);
  }, [attempt, today.runDate, today.leaderboardPreview, user?.id, streakDisplay, profileRating]);

  const finalLadderShareText = useMemo(() => {
    if (!finalOverlay) return '';
    const data = buildLadderShareData({
      runDate: finalOverlay.response.runDate,
      attempt: finalOverlay.response.attempt,
      rank: finalOverlay.response.leaderboardRank,
      shareStreak: getDisplayStreak(finalOverlay.response.runDate),
      shareRating: profileRating,
    });
    return buildLadderShareText(data);
  }, [finalOverlay, profileRating]);

  const handleShareLadderResult = useCallback(
    (text: string) => {
      invokeLadderShareResult(text, () => {
        setShareDone(true);
        window.setTimeout(() => setShareDone(false), 2000);
      });
    },
    [],
  );

  const ladderSlotRows = useMemo(() => {
    return [1, 2, 3].map((slotIndex) => {
      const slot = today.slots.find((s) => s.slotIndex === slotIndex);
      const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
      const isCompleteRun = attempt?.status === 'completed';
      const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
      const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
      const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';
      const step = getDailyPuzzleStepPresentation(slotIndex);

      let statusSub: string;
      let unlockHint: string | null = null;
      if (slotResult) {
        statusSub = `Completed · ${slotResult.awardedPoints} pts`;
      } else if (isAvailable) {
        statusSub = 'Available now';
      } else if (isLocked) {
        statusSub = 'Locked';
        unlockHint = slotIndex === 2 ? 'Complete puzzle 1 to unlock' : 'Complete puzzle 2 to unlock';
      } else {
        statusSub = 'Up next';
      }

      return {
        slotIndex,
        slot,
        slotResult,
        step,
        rowVariant,
        statusSub,
        unlockHint,
        isLocked,
        isAvailable,
      };
    });
  }, [attempt?.status, completedSlots, nextSlotIndex, today.slots]);
  const ladderTotalPoints = useMemo(
    () => today.slots.reduce((sum, slot) => sum + (slot.slotMaxPoints ?? 0), 0),
    [today.slots],
  );

  const inActivePlay = Boolean(activeSlot && runtimeState);

  const exitPlayToHub = useCallback(() => {
    setSlotOverlay(null);
    setFinalOverlay(null);
    setPracticeOverlay(null);
    setRuntimeState(null);
    setActiveSlot(null);
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
  }, []);

  if (leaderboardOpen) {
    return (
      <DailyPuzzleLadderLeaderboardScreen
        user={user}
        runDate={today.runDate}
        currentUsername={profile?.username ?? null}
        currentUserId={user?.id ?? null}
        glickoRating={profile?.glicko_rating ?? null}
        onBack={() => setLeaderboardOpen(false)}
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
      />
    );
  }

  const renderLadderOverlays = () => (
    <>
      {submitPending || finalizePending ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={finalizePending ? 'Finalizing ladder' : 'Submitting puzzle'}
        >
          <div className="rh-result dpl-ladder-pending-modal">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>
                DAILY LADDER
              </div>
              <div className="rh-result__feedback">
                {finalizePending ? 'Finalizing ladder…' : 'Submitting puzzle…'}
              </div>
            </header>
            <p className="dpl-ladder-pending-copy">Please wait.</p>
          </div>
        </div>
      ) : null}

      {slotOverlay ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Puzzle complete"
        >
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{slotOverlay.response.slotResult.awardedPoints}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(
                  slotOverlay.response.slotResult.slotIndex,
                  slotOverlay.response.slotResult.slotTitle,
                )}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Raw Score</span>
                <span className="rh-result__summary-value">{slotOverlay.rawScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{slotOverlay.response.slotResult.bestPossibleScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Ladder Total</span>
                <span className="rh-result__summary-value">{slotOverlay.response.attempt.totalScore}</span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions">
              <button type="button" className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost" onClick={exitPlayToHub}>
                Back to Ladder
              </button>
              {slotOverlay.response.nextSlot ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                  onClick={() => {
                    const nextSlot = slotOverlay.response.nextSlot;
                    setSlotOverlay(null);
                    if (nextSlot) launchSlot(nextSlot, 'scored');
                  }}
                >
                  {`Next · Puzzle ${slotOverlay.response.nextSlot.slotIndex}`}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {practiceOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Practice complete">
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>PRACTICE COMPLETE</div>
              <div className="rh-result__score">
                <span>{practiceOverlay.rawScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex, practiceOverlay.slotTitle)}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{practiceOverlay.bestPossible ?? '—'}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Mode</span>
                <span className="rh-result__summary-value">Practice</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Slot</span>
                <span className="rh-result__summary-value">P{practiceOverlay.slotIndex}</span>
              </div>
            </div>
            <footer
              className="rh-result__actions"
              style={{ gridTemplateColumns: practiceOverlay.slotIndex < 3 ? '1fr 1.2fr' : '1fr 1fr' }}
            >
              <button
                type="button"
                className="rh-btn-leave"
                onClick={() => {
                  const idx = practiceOverlay.slotIndex;
                  setPracticeOverlay(null);
                  handleStartPractice(idx as 1 | 2 | 3);
                }}
              >
                Replay P{practiceOverlay.slotIndex}
              </button>
              {practiceOverlay.slotIndex < 3 ? (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => {
                    const nextIdx = practiceOverlay.slotIndex + 1;
                    setPracticeOverlay(null);
                    handleStartPractice(nextIdx as 1 | 2 | 3);
                  }}
                >
                  Practice P{practiceOverlay.slotIndex + 1}
                </button>
              ) : (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}
                >
                  ← Back to Ladder
                </button>
              )}
            </footer>
            {practiceOverlay.slotIndex < 3 && (
              <div style={{ padding: '0 22px 22px', marginTop: '-10px', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn text compact"
                  style={{ opacity: 0.5, fontSize: '11px' }}
                  onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}
                >
                  Return to Ladder Home
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {finalOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Ladder complete">
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">LADDER COMPLETE</div>
              <div className="rh-result__score">
                <span>{finalOverlay.response.attempt.totalScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {finalOverlay.response.leaderboardRank ? `Rank #${finalOverlay.response.leaderboardRank}` : 'Ladder finalized'}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Completed</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.puzzlesCompleted}/3</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Puzzle 3</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.masterChainScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Breakdown</span>
                <span className="rh-result__summary-value">
                  {currentSlotBreakdown.map((chip) => `${chip.label} ${chip.value}`).join(' · ')}
                </span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions dpl-ladder-result__actions--with-share">
              {finalLadderShareText ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-share-result-btn"
                  onClick={() => handleShareLadderResult(finalLadderShareText)}
                >
                  {shareDone ? '✓ Shared!' : 'Share Result'}
                </button>
              ) : null}
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => {
                  exitPlayToHub();
                  onBack();
                }}
              >
                ← Home
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => {
                  setFinalOverlay(null);
                  exitPlayToHub();
                }}
              >
                Review Ladder
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                onClick={() => {
                  setFinalOverlay(null);
                  exitPlayToHub();
                  setLeaderboardOpen(true);
                }}
              >
                Leaderboard
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );

  if (!inActivePlay) {
    const showNav = Boolean(onNavigate && onOpenAuth);
    const isLadderComplete = attempt?.status === 'completed';
    const ladderStateLabel = isLadderComplete
      ? 'Completed'
      : attempt
        ? `Live · Puzzle ${attempt.currentSlotIndex}`
        : 'Ready to start';
    const primaryLabel = isLadderComplete
      ? 'Practice Mode'
      : attempt
        ? 'Resume Daily Ladder'
        : 'Start Daily Ladder';
    const trustLine = isLadderComplete
      ? 'Practice any puzzle after your scored run.'
      : 'Leaderboard updates after a scored run.';

    return (
      <>
        {renderLadderOverlays()}
        <div
          className="df-page dpl-ladder-hub"
          style={{ '--pvf-dynamic-color': 'var(--tier-standard)' } as React.CSSProperties}
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

          {showNav ? (
            <GlobalNav
              currentMode="daily"
              onNavigate={onNavigate}
              onOpenAuth={onOpenAuth}
              onOpenAccount={onOpenAccount}
              activeColor="var(--tier-standard)"
              compactChrome
            />
          ) : null}

          <div className="df-shell df-shell--daily-fritz">
            <div className="df-layout df-pvf-layout">
              <div className="df-pvf-left-col">
                <button type="button" className="df-back-btn df-pvf-back-btn rh-back-button" onClick={onBack}>
                  <span aria-hidden>←</span> Back to home
                </button>

                <div className="df-pvf-header">
                  <div className="df-pvf-label">DAILY PUZZLE</div>
                  <h1 className="df-pvf-title">Daily Ladder</h1>
                  <p className="df-pvf-subtitle">
                    Three curated boards in a fixed sequence.
                    <br />
                    One scored run posts to the global ladder — practice stays open after you lock it in.
                  </p>
                </div>

                <article className="df-pvf-opponent-card" aria-label="Daily Ladder overview">
                  <img
                    src={dailyLadderHeroImg}
                    className="df-pvf-card-bg-img dpl-ladder-hero-img"
                    alt="Daily Ladder puzzle boards"
                    decoding="async"
                    loading="eager"
                  />
                  <div className="df-pvf-card-overlay" aria-hidden />

                  <div className="df-pvf-card-content">
                    <div className="df-pvf-card-header">
                      <div className="df-pvf-card-eyebrow">TODAY&apos;S DAILY</div>
                      <h2 className="df-pvf-card-name">Ladder</h2>
                    </div>

                    <div className="df-pvf-card-badges">
                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconSameBoard />
                          </span>
                          <span className="df-pvf-card-badge-title">Same boards</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">One daily deal for everyone.</div>
                      </div>

                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconOrdered />
                          </span>
                          <span className="df-pvf-card-badge-title">Sequenced run</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">Solve in order — no skipping slots.</div>
                      </div>

                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconLeaderboard />
                          </span>
                          <span className="df-pvf-card-badge-title">Live ladder</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">Points lock on a single scored attempt.</div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              <section className="df-pvf-control-panel" aria-label="Daily Ladder">
                <div className="df-pvf-section">
                  <div className="fritz-section-label">1. TODAY&apos;S LADDER</div>
                  <div className="df-pvf-overview-grid" role="list" aria-label="Ladder details">
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconCalendar />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{formatDateLabel(today.runDate)}</div>
                        <div className="df-pvf-overview-key">Date</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card df-pvf-overview-card--active" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <LadderIconLeaderboard />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{attempt?.totalScore ?? 0}</div>
                        <div className="df-pvf-overview-key">Ladder pts</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconFlame />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{streakDisplay} days</div>
                        <div className="df-pvf-overview-key">Streak</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconLayers />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{ladderTotalPoints} pts</div>
                        <div className="df-pvf-overview-key">Available</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="df-pvf-section">
                  <div className="fritz-section-label">2. LADDER PROGRESS</div>
                  <div className="df-pvf-progress-grid" role="list" aria-label="Ladder progress">
                    {ladderSlotRows.map((row) => {
                      const cardState = getLadderPuzzleCardState(row);
                      const cardClass =
                        cardState === 'done'
                          ? 'dpl-puzzle-card--done'
                          : cardState === 'idle'
                            ? 'dpl-puzzle-card--idle'
                            : `df-game-card--${cardState}`;
                      const hintLine = row.slotResult
                        ? `${row.slotResult.awardedPoints} pts awarded`
                        : row.unlockHint ??
                          (row.slot?.slotMaxPoints != null ? `Up to ${row.slot.slotMaxPoints} pts` : null);

                      return (
                        <article
                          key={row.slotIndex}
                          role="listitem"
                          className={['df-pvf-progress-card', 'df-game-card', cardClass].filter(Boolean).join(' ')}
                        >
                          <div className="df-pvf-progress-index" aria-hidden>
                            {row.slotIndex}
                          </div>
                          <div className="df-pvf-progress-body">
                            <span className="df-pvf-progress-eyebrow">{row.step.subtitle}</span>
                            <h3 className="df-pvf-progress-title">{row.step.title}</h3>
                            <p className="df-pvf-progress-status">{row.statusSub}</p>
                            {hintLine ? <p className="df-pvf-progress-hint">{hintLine}</p> : null}
                            <div className="df-pvf-progress-footer">
                              <span className="df-pvf-progress-meta">
                                {cardState === 'locked'
                                  ? 'Locked'
                                  : cardState === 'done'
                                    ? 'Completed'
                                    : cardState === 'active'
                                      ? 'Available now'
                                      : 'Up next'}
                              </span>
                              {cardState === 'locked' ? (
                                <span className="df-pvf-progress-lock" aria-hidden>
                                  <DplIconLock />
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="df-pvf-section">
                  <div className="fritz-section-label">3. RUN SUMMARY</div>
                  <div className="df-pvf-summary-strip" aria-label="Run summary">
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconLayers />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">Daily Ladder</div>
                        <div className="df-pvf-summary-key">Mode</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconTrophy />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">{ladderStateLabel}</div>
                        <div className="df-pvf-summary-key">State</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <LadderIconLeaderboard />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">{ladderTotalPoints} pts</div>
                        <div className="df-pvf-summary-key">Available</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconFlame color="var(--tier-standard)" />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">
                          {isLadderComplete ? 'Unlocked' : 'One attempt'}
                        </div>
                        <div className="df-pvf-summary-key">Run</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="df-pvf-actions">
                  {hubError ? (
                    <p className="df-hub-error dpl-ladder-hub-error" role="alert">
                      {hubError}
                    </p>
                  ) : null}
                  {isLadderComplete ? (
                    <Button
                      variant="tier-standard"
                      size="lg"
                      type="button"
                      className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                      onClick={() => handleStartPractice(1)}
                    >
                      {primaryLabel}
                      <span className="df-start-match-chevron" aria-hidden>
                        {' '}
                        ›
                      </span>
                    </Button>
                  ) : (
                    <Button
                      variant="tier-standard"
                      size="lg"
                      type="button"
                      className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                      disabled={startPending}
                      onClick={() => {
                        void handleStartScored();
                      }}
                    >
                      {primaryLabel}
                      {!startPending ? (
                        <span className="df-start-match-chevron" aria-hidden>
                          {' '}
                          ›
                        </span>
                      ) : null}
                    </Button>
                  )}
                  <div className="df-pvf-footer dpl-ladder-footer">
                    <div className="dpl-ladder-footer-actions">
                      {isLadderComplete && hubLadderShareText ? (
                        <button
                          type="button"
                          className="dpl-share-result-btn"
                          onClick={() => handleShareLadderResult(hubLadderShareText)}
                        >
                          {shareDone ? '✓ Shared!' : 'Share Result'}
                        </button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        className="df-pvf-leaderboard-link"
                        onClick={() => setLeaderboardOpen(true)}
                      >
                        View Leaderboard →
                      </Button>
                    </div>
                    <p className="dpl-ladder-trust-line">{trustLine}</p>
                  </div>
                  {isLadderComplete ? (
                    <div className="dpl-ladder-practice">
                      <div className="dpl-ladder-practice-row">
                        {([1, 2, 3] as const).map((slotIdx) => (
                          <button
                            key={`practice-${slotIdx}`}
                            type="button"
                            className="dpl-ladder-practice-chip"
                            onClick={() => handleStartPractice(slotIdx)}
                          >
                            P{slotIdx}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </>
    );
  }

  const playingSlot = activeSlot!;
  const playingState = runtimeState!;

  return (
    <>
      {renderLadderOverlays()}
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-standard-live-board">
        <div className="wl-top-rail daily-top-rail" data-ui="hud">
          <div className="wl-player-pill is-active daily-hud-pill">
            <span className="wl-player-label">{getDailyPuzzleDisplayTitle(playingSlot.slotIndex, playingSlot.slotTitle)}</span>
            <span className="wl-player-score">{displayScore}</span>
          </div>
          <div className="daily-center-zone">
            <div className="wl-center-status">
              <span className="wl-turn-label your-turn">DAILY PUZZLE LADDER</span>
              <span className="wl-room-code">Puzzle {playingSlot.slotIndex} / 3</span>
            </div>
          </div>
          <div className="daily-top-actions-pill">
            <button className="btn text compact daily-chip-control rh-back-button" onClick={onBack}>← Back to Home</button>
            <button className="btn text compact daily-chip-control" onClick={() => setLeaderboardOpen(true)}>Leaderboard</button>
          </div>
        </div>

        <div className="rh-live-studio-shell">
          <div className="rh-live-board-zone" data-ui="live-board-zone">
            <div className="wl-stage-shell">
              <MatchNblBoardFrame>
                <Board
                  board={playingState.board}
                  legalMoves={legalMoves}
                  selectedTile={selectedTile}
                  lastPlayedTile={lastPlayedTile}
                  onPositionClick={onPositionClick}
                  tileSize={84}
                />
              </MatchNblBoardFrame>
            </div>
          </div>

          <div className="hand-area wl-hand-area" data-ui="tray">
            <div className="tray-rail">
              <div className="tray-center">
              <div className={`hand-container ${handCompactStacked ? 'is-stacked' : ''}`}>
                {(handCompactStacked
                  ? [
                      playingState.players.you.hand.slice(0, Math.ceil(playingState.players.you.hand.length / 2)),
                      playingState.players.you.hand.slice(Math.ceil(playingState.players.you.hand.length / 2)),
                    ]
                  : [playingState.players.you.hand]
                ).map((row, rowIdx) => (
                  <div key={`ladder-hand-row-${rowIdx}`} className="hand-row">
                    {row.map((tile, idx) => {
                      const playable = legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile));
                      const inProgress = status === 'IN_PROGRESS';
                      const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;
                      return (
                        <DominoTile
                          key={`ladder-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          selected={isSelected}
                          highlight={inProgress && playable}
                          unplayable={inProgress && !playable}
                          disabled={!inProgress}
                          onClick={() => {
                            if (!inProgress || !playable) return;
                            setSelectedTile(tile);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        </div>

      </div>
    </>
  );
}
