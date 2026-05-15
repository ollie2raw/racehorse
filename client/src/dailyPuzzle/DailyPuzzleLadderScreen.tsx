import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, DominoTile, GlobalNav, RotateOverlay } from '../components';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { AppMode, Move, Tile } from '../types';
import {
  completeDailyPuzzleLadder,
  fetchDailyPuzzleLadderLeaderboard,
  startDailyPuzzleLadder,
  submitDailyPuzzleSlot,
} from './api';
import { createPuzzleMatchState } from './validator';
import type {
  CuratedDailyPuzzle,
  DailyPuzzleAttempt,
  DailyPuzzleCompleteResponse,
  DailyPuzzleLeaderboardRow,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
} from './types';
import LeaderboardPageShell from '../ui/LeaderboardPageShell';
import dailyLadderHeroImg from '../assets/dailyPuzzle/donedoneLADDER.png';
import { getDisplayStreak, recordSolvedStreak } from './streakStorage';
import '../dailyFritz/dailyFritz.css';

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
    weekday: 'long',
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

const DplDfIconCrown = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
      fill={color}
    />
  </svg>
);

const DplLockIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
    <path
      d="M7 11V8a5 5 0 0 1 10 0v3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" />
  </svg>
);

function toCuratedPuzzle(slot: DailyPuzzleSlot): CuratedDailyPuzzle | null {
  if (!slot.startingBoard || !slot.startingHand) return null;
  return {
    id: slot.id,
    puzzleDate: slot.puzzleDate,
    title: slot.slotTitle,
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
  profile: _profile,
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
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState<DailyPuzzleLeaderboardRow[]>(
    initialToday.leaderboardPreview ?? [],
  );
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
  const startTimeRef = useRef(0);
  const runningScoreRef = useRef(0);
  const moveTraceRef = useRef<Array<Record<string, unknown>>>([]);
  const lastPlayedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completedSlots = attempt?.result.slots ?? [];
  const nextSlotIndex = attempt?.status === 'completed' ? null : (attempt?.currentSlotIndex ?? 1);
  const currentScore = runtimeState?.players.you.score ?? 0;
  const displayScore =
    activeSlot?.puzzleType === 'one_turn_high_score' ? (finalScore ?? runningScoreRef.current) : currentScore;

  const refreshLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLadderLeaderboard(today.runDate);
      setLeaderboardRows(rows);
    } catch (error) {
      setHubError(error instanceof Error ? error.message : 'Unable to load ladder leaderboard.');
    } finally {
      setLeaderboardLoading(false);
    }
  }, [today.runDate]);

  useEffect(() => {
    if (!leaderboardOpen) return;
    void refreshLeaderboard();
  }, [leaderboardOpen, refreshLeaderboard]);

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
      const trayHeight = forceTwoRows ? 138 : (isLandscape && isMobileWidth ? 70 : 120);
      document.documentElement.style.setProperty('--tray-height', `${trayHeight}px`);
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
        setLeaderboardRows(completeResponse.leaderboardPreview);
        recordSolvedStreak(completeResponse.attempt.puzzleDate);
        setRuntimeState(null);
        setActiveSlot(null);
      } else {
        setSlotOverlay({ response, rawScore: rawScoreValue });
        setRuntimeState(null);
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
      return {
        slotIndex,
        label: `P${slotIndex}`,
        value: result ? `${result.awardedPoints}` : '—',
      };
    });
  }, [completedSlots]);

  const streakDisplay = useMemo(() => getDisplayStreak(today.runDate), [today.runDate]);

  const ladderSlotRows = useMemo(() => {
    return [1, 2, 3].map((slotIndex) => {
      const slot = today.slots.find((s) => s.slotIndex === slotIndex);
      const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
      const isCompleteRun = attempt?.status === 'completed';
      const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
      const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
      const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';

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
        rowVariant,
        statusSub,
        unlockHint,
        isLocked,
        isAvailable,
      };
    });
  }, [attempt?.status, completedSlots, nextSlotIndex, today.slots]);

  if (leaderboardOpen) {
    return (
      <LeaderboardPageShell
        mode="puzzle"
        className="mode-subpage-screen mode-accent-daily"
        label="Daily Puzzle"
        title="Ladder Leaderboard"
        subtitle={`${formatDateLabel(today.runDate)} · Global ranking`}
        backLabel="Back to Ladder"
        summaryCards={[
          {
            label: 'Total Score',
            value: `${attempt?.totalScore ?? 0}`,
            sublabel: 'Your current ladder total',
            tone: 'accent',
          },
          {
            label: 'Completed',
            value: `${attempt?.puzzlesCompleted ?? 0}/3`,
            sublabel: 'Scored puzzle slots',
            tone: 'neutral',
          },
          {
            label: 'Master',
            value: `${attempt?.masterChainScore ?? 0}`,
            sublabel: 'Master Chain score',
            tone: 'neutral',
          },
        ]}
        resultsLabel={`Global Results · ${leaderboardRows.length} ${leaderboardRows.length === 1 ? 'player' : 'players'}`}
        onClose={() => setLeaderboardOpen(false)}
      >
        <div className="daily-leaderboard-panel daily-leaderboard-page-panel">
          {leaderboardLoading ? <p className="daily-leaderboard-loading">Loading leaderboard...</p> : null}
          {!leaderboardLoading && leaderboardRows.length === 0 ? (
            <p className="daily-leaderboard-empty">No ladder runs recorded yet.</p>
          ) : null}
          {!leaderboardLoading && leaderboardRows.length > 0 ? (
            <div className="daily-ladder-board">
              <div className="daily-ladder-board-head">
                <span>#</span>
                <span>Player</span>
                <span>Total</span>
                <span>Done</span>
                <span>Master</span>
                <span>Breakdown</span>
              </div>
              {leaderboardRows.map((row) => (
                <div
                  key={`${row.userId}-${row.rank}`}
                  className={`daily-ladder-board-row ${user?.id === row.userId ? 'is-current-user' : ''}`}
                >
                  <span>{row.rank}</span>
                  <span>@{row.username}</span>
                  <span>{row.totalScore}</span>
                  <span>{row.puzzlesCompleted}/3</span>
                  <span>{row.masterChainScore}</span>
                  <span className="daily-ladder-chip-row">
                    {row.breakdown.map((chip) => (
                      <span key={`${row.userId}-${chip.slotIndex}`} className="daily-ladder-chip">
                        P{chip.slotIndex} {chip.awardedPoints ?? '—'}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </LeaderboardPageShell>
    );
  }

  if (!runtimeState || !activeSlot) {
    const showNav = Boolean(onNavigate && onOpenAuth);
    const isLadderComplete = attempt?.status === 'completed';
    const primaryLabel = isLadderComplete
      ? 'Practice mode'
      : attempt
        ? `Resume puzzle ${attempt.currentSlotIndex}`
        : 'Start daily ladder';

    return (
      <>
        <div
          className="df-page dpl-ladder-df-page dpl-ladder-hub"
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
            <button type="button" className="df-back-btn df-back--ghost df-back--floating rh-back-button" onClick={onBack}>
              <span aria-hidden>←</span> Back to home
            </button>

            <div className="df-layout">
              <div className="df-left-col">
                <div className="df-hero-fullbleed">
                  <div className="df-hero-fullbleed__copy">
                    <div className="df-hero-kicker">• DAILY PUZZLE</div>
                    <h1 className="df-title df-title--page df-hero-title">Daily Ladder</h1>
                    <p className="df-hero-subtitle">
                      Three curated boards in a fixed sequence.
                      <br />
                      One scored run posts to the global ladder — practice stays open after you lock it in.
                    </p>
                  </div>
                  <img
                    src={dailyLadderHeroImg}
                    className="df-hero-fullbleed__img dpl-ladder-df-hero-img"
                    alt=""
                    decoding="async"
                    loading="eager"
                  />
                  <div className="df-hero-fullbleed__overlay" aria-hidden />
                  <div className="df-hero-fullbleed__rim" aria-hidden />
                  <div className="df-feature-bar" aria-label="Daily ladder features">
                    <div className="df-feature-bar__col">
                      <span className="df-feature-bar__icon" style={{ color: 'var(--tier-standard)' }} aria-hidden>
                        <LadderIconSameBoard />
                      </span>
                      <div className="df-feature-bar__text">
                        <span className="df-feature-bar__label">Same boards</span>
                        <span className="df-feature-bar__desc">One daily deal for everyone.</span>
                      </div>
                    </div>
                    <div className="df-feature-bar__col">
                      <span className="df-feature-bar__icon" style={{ color: 'var(--tier-standard)' }} aria-hidden>
                        <LadderIconOrdered />
                      </span>
                      <div className="df-feature-bar__text">
                        <span className="df-feature-bar__label">Sequenced run</span>
                        <span className="df-feature-bar__desc">Solve in order — no skipping slots.</span>
                      </div>
                    </div>
                    <div className="df-feature-bar__col">
                      <span className="df-feature-bar__icon" style={{ color: 'var(--tier-standard)' }} aria-hidden>
                        <LadderIconLeaderboard />
                      </span>
                      <div className="df-feature-bar__text">
                        <span className="df-feature-bar__label">Live ladder</span>
                        <span className="df-feature-bar__desc">Points lock on a single scored attempt.</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="df-streak-card">
                  <div className="df-streak-card__block df-streak-card__block--current">
                    <span className="df-streak-card__crown" aria-hidden>
                      <DplDfIconCrown />
                    </span>
                    <div className="df-streak-card__meta">
                      <span className="df-streak-card__key">Your streak</span>
                      <span className="df-streak-card__value">{streakDisplay} Days</span>
                    </div>
                  </div>
                  <div className="df-streak-card__block df-streak-card__block--best">
                    <span className="df-streak-card__key">Scored total</span>
                    <span className="df-streak-card__value">{attempt?.totalScore ?? 0}</span>
                  </div>
                  <div className="df-streak-card__block df-streak-card__block--copy">
                    <p className="df-streak-card__gold-lead">Climb with the field.</p>
                    <p className="df-streak-card__gold-line">One scored run locks ladder points.</p>
                    <p className="df-streak-card__gold-line">Practice stays open after you post.</p>
                  </div>
                </div>
              </div>

              <div className="df-control-panel">
                <div className="df-panel-surface">
                  <div className="df-panel-body">
                    <div className="df-section df-section--overview">
                      <div className="fritz-section-label">1. TODAY&apos;S SNAPSHOT</div>
                      <div className="df-overview-stats dpl-ladder-overview-stats">
                        <div className="df-overview-stat">
                          <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--tile dpl-ladder-df-overview-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                              <rect x="3" y="4" width="18" height="18" rx="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </div>
                          <div className="df-overview-stat__value">{formatDateLabel(today.runDate)}</div>
                          <div className="df-overview-stat__key">Date</div>
                        </div>
                        <div className="df-overview-stat">
                          <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--tile dpl-ladder-df-overview-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path
                                d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
                                fill="currentColor"
                              />
                            </svg>
                          </div>
                          <div className="df-overview-stat__value">{attempt?.totalScore ?? 0}</div>
                          <div className="df-overview-stat__key">Ladder pts</div>
                        </div>
                        <div className="df-overview-stat">
                          <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--tile dpl-ladder-df-overview-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.5 3.5 6.5 1 1.5 2 3 2 5a7 7 0 1 1-14 0c0-3 2.5-5 2.5-5s0 1 1 2.5z" />
                            </svg>
                          </div>
                          <div className="df-overview-stat__value">{streakDisplay} days</div>
                          <div className="df-overview-stat__key">Streak</div>
                        </div>
                      </div>
                    </div>

                    <div className="df-section df-section--games-spotlight dpl-ladder-df-run-section">
                      <div className="fritz-section-label">2. THE RUN</div>
                      <div className="df-bof3-arena">
                        <div className="df-bof3-arena__chrome" aria-hidden />
                        <div className="df-bof3-arena__head">
                          <span className="df-bof3-arena__pulse" aria-hidden />
                          <span className="df-bof3-arena__tag">Live ladder</span>
                          <span className="df-bof3-arena__rule">
                            Three stops in order. One scored run locks points — then practice any slot.
                          </span>
                        </div>
                        <div className="dpl-ladder-run-track">
                          {ladderSlotRows.map((row) => {
                            const slot = row.slot;
                            if (!slot) return null;
                            const stepClass = [
                              'dpl-ladder-run-step',
                              row.rowVariant === 'active' && !row.slotResult && 'dpl-ladder-run-step--active',
                              row.slotResult?.solved && 'dpl-ladder-run-step--done',
                              row.slotResult && !row.slotResult.solved && 'dpl-ladder-run-step--failed',
                              row.isLocked && 'dpl-ladder-run-step--locked',
                            ]
                              .filter(Boolean)
                              .join(' ');
                            return (
                              <div key={slot.id} className={stepClass}>
                                <div className="dpl-ladder-run-platform">
                                  <div className="dpl-ladder-run-rail">
                                    <span className="dpl-ladder-run-badge">{row.slotIndex}</span>
                                  </div>
                                  <div className="dpl-ladder-run-main">
                                    <p className="dpl-ladder-run-eyebrow">Stop {row.slotIndex}</p>
                                    <p className="dpl-ladder-run-status">{row.statusSub}</p>
                                    <p className="dpl-ladder-run-meta">
                                      <strong>{slot.slotTitle}</strong>
                                      <span> · {slot.slotMaxPoints} pts max</span>
                                    </p>
                                  </div>
                                  <div className="dpl-ladder-run-aside">
                                    {row.rowVariant === 'done' && row.slotResult ? (
                                      <span className="dpl-ladder-run-pts">{row.slotResult.awardedPoints} pts</span>
                                    ) : null}
                                    {row.isLocked && row.unlockHint ? (
                                      <div className="dpl-ladder-run-lock">
                                        <span>{row.unlockHint}</span>
                                        <DplLockIcon />
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="df-panel-footer">
                    {hubError ? <p className="dpl-ladder-hub-error">{hubError}</p> : null}

                    {isLadderComplete ? (
                      <button type="button" className="pvf-start-btn dpl-ladder-start-btn" onClick={() => handleStartPractice(1)}>
                        <span>{primaryLabel}</span>
                        <span className="pvf-start-arrow" aria-hidden>
                          ›
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pvf-start-btn dpl-ladder-start-btn"
                        disabled={startPending}
                        onClick={() => {
                          void handleStartScored();
                        }}
                      >
                        <span>{primaryLabel}</span>
                        {!startPending ? (
                          <span className="pvf-start-arrow" aria-hidden>
                            ›
                          </span>
                        ) : null}
                      </button>
                    )}

                    <button type="button" className="rh-btn df-leaderboard-link" onClick={() => setLeaderboardOpen(true)}>
                      View leaderboard →
                    </button>

                    {isLadderComplete ? (
                      <div className="dpl-ladder-practice">
                        <span className="dpl-ladder-practice-label">Jump to practice</span>
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
                </div>
              </div>
            </div>
          </div>
        </div>

        {finalOverlay ? (
          <div className="rh-modal-overlay" role="dialog" aria-modal="true">
            <div className="rh-result">
              <header className="rh-result__head">
                <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>LADDER COMPLETE</div>
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
                  <span className="rh-result__summary-label">Master Chain</span>
                  <span className="rh-result__summary-value">{finalOverlay.response.attempt.masterChainScore}</span>
                </div>
                <div>
                  <span className="rh-result__summary-label">Breakdown</span>
                  <span className="rh-result__summary-value">
                    {currentSlotBreakdown.map((chip) => `${chip.label} ${chip.value}`).join(' · ')}
                  </span>
                </div>
              </div>
              <footer className="rh-result__actions">
                <button type="button" className="rh-btn-home rh-back-button" onClick={onBack}>
                  ← Back to Home
                </button>
                <button type="button" className="rh-btn-leave" onClick={() => setFinalOverlay(null)}>
                  Review / Practice
                </button>
                <button type="button" className="rh-btn-cancel" onClick={() => setLeaderboardOpen(true)}>
                  Leaderboard
                </button>
              </footer>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen">
        <div className="wl-top-rail daily-top-rail" data-ui="hud">
          <div className="wl-player-pill is-active daily-hud-pill">
            <span className="wl-player-label">{activeSlot.slotTitle}</span>
            <span className="wl-player-score">{displayScore}</span>
          </div>
          <div className="daily-center-zone">
            <div className="wl-center-status">
              <span className="wl-turn-label your-turn">DAILY PUZZLE LADDER</span>
              <span className="wl-room-code">Puzzle {activeSlot.slotIndex} / 3</span>
            </div>
          </div>
          <div className="daily-top-actions-pill">
            <button className="btn text compact daily-chip-control rh-back-button" onClick={onBack}>← Back to Home</button>
            <button className="btn text compact daily-chip-control" onClick={() => setLeaderboardOpen(true)}>Leaderboard</button>
          </div>
        </div>

        <div className="wl-stage-shell">
          <div className="board-area wl-board-area" data-ui="board">
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={72}
            />
          </div>
        </div>

        <div className="hand-area wl-hand-area" data-ui="tray">
          <div className="tray-rail">
            <div className="tray-center">
              <div className={`hand-container ${handCompactStacked ? 'is-stacked' : ''}`}>
                {(handCompactStacked
                  ? [
                      runtimeState.players.you.hand.slice(0, Math.ceil(runtimeState.players.you.hand.length / 2)),
                      runtimeState.players.you.hand.slice(Math.ceil(runtimeState.players.you.hand.length / 2)),
                    ]
                  : [runtimeState.players.you.hand]
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

        {submitPending || finalizePending ? (
          <div className="daily-puzzle-overlay" role="dialog" aria-modal="true">
            <div className="daily-puzzle-modal">
              <h3>{finalizePending ? 'Finalizing ladder…' : 'Submitting slot…'}</h3>
              <p>Please wait.</p>
            </div>
          </div>
        ) : null}

        {slotOverlay ? (
          <div className="rh-modal-overlay" role="dialog" aria-modal="true">
            <div className="rh-result">
              <header className="rh-result__head">
                <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>PUZZLE COMPLETE</div>
                <div className="rh-result__score">
                  <span>{slotOverlay.response.slotResult.awardedPoints}</span>
                  <span className="rh-result__score-suffix">PTS</span>
                </div>
                <div className="rh-result__feedback">{slotOverlay.response.slotResult.slotTitle}</div>
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
              <footer className="rh-result__actions">
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => {
                    const nextSlot = slotOverlay.response.nextSlot;
                    setSlotOverlay(null);
                    if (nextSlot) launchSlot(nextSlot, 'scored');
                  }}
                >
                  Continue
                </button>
              </footer>
            </div>
          </div>
        ) : null}

        {practiceOverlay ? (
          <div className="rh-modal-overlay" role="dialog" aria-modal="true">
            <div className="rh-result">
              <header className="rh-result__head">
                <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>PRACTICE COMPLETE</div>
                <div className="rh-result__score">
                  <span>{practiceOverlay.rawScore}</span>
                  <span className="rh-result__score-suffix">PTS</span>
                </div>
                <div className="rh-result__feedback">{practiceOverlay.slotTitle}</div>
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
              <footer className="rh-result__actions" style={{ gridTemplateColumns: practiceOverlay.slotIndex < 3 ? '1fr 1.2fr' : '1fr 1fr' }}>
                <button type="button" className="rh-btn-leave" onClick={() => {
                  const idx = practiceOverlay.slotIndex;
                  setPracticeOverlay(null);
                  handleStartPractice(idx as 1|2|3);
                }}>
                  Replay P{practiceOverlay.slotIndex}
                </button>
                {practiceOverlay.slotIndex < 3 ? (
                  <button type="button" className="rh-btn-cancel" onClick={() => {
                    const nextIdx = practiceOverlay.slotIndex + 1;
                    setPracticeOverlay(null);
                    handleStartPractice(nextIdx as 1|2|3);
                  }}>
                    Practice P{practiceOverlay.slotIndex + 1}
                  </button>
                ) : (
                  <button type="button" className="rh-btn-cancel" onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}>
                    ← Back to Ladder
                  </button>
                )}
              </footer>
              {practiceOverlay.slotIndex < 3 && (
                <div style={{ padding: '0 22px 22px', marginTop: '-10px', textAlign: 'center' }}>
                  <button type="button" className="btn text compact" style={{ opacity: 0.5, fontSize: '11px' }} onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}>
                    Return to Ladder Home
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
