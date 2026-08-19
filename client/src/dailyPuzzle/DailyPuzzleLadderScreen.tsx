import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, RotateOverlay } from '../components';
import { MatchLiveLayout } from '../match/board';
import '../match/match-live.css';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { AppMode, Move, Tile } from '../types';
import { tileEquals } from '../game/tileUtils';
import { startDailyPuzzleLadder } from './api';
import { createPuzzleMatchState } from './validator';
import type {
  DailyPuzzleSlotIndex,
  DailyPuzzleAttempt,
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
} from './types';
import { DAILY_PUZZLE_SLOT_COUNT } from './types';
import DailyPuzzleLadderLeaderboardScreen from './DailyPuzzleLadderLeaderboardScreen';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import {
  buildLadderShareData,
  buildLadderShareText,
  invokeLadderShareResult,
} from './ladderShareCard';
import { getDisplayStreak } from './streakStorage';
import { getDailyPuzzleDisplayTitle } from './presentation';
import {
  buildLadderSlotBreakdown,
  buildLadderSlotRows,
  computeLadderTotalPoints,
} from './ladderSlotRowViewModel';
import { toCuratedPuzzle } from './dailyPuzzleSlotHelpers';
import '../dailyFritz/dailyFritz.css';
import { useResponsiveHandTileSize } from './useResponsiveHandTileSize';
import {
  evaluateOneTurnHighScoreMoveOutcome,
  evaluateTargetScoreMoveOutcome,
  isDominoDouble,
  shouldAutoFailOneTurnHighScoreWithNoLegalMoves,
  shouldRecoverCompletedOneTurnHighScore,
} from './dailyPuzzlePlayMoveCompletion';
import { useDailyPuzzleLadderGameplay } from './useDailyPuzzleLadderGameplay';
import {
  loadDailyPuzzleLadderSession,
  persistDailyPuzzleLadderSession,
} from './dailyPuzzleLadderSessionStorage';
import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';
import { DailyPuzzleLadderOverlays } from './DailyPuzzleLadderOverlays';
import { DailyPuzzleLadderHubView } from './DailyPuzzleLadderHubView';
import './dailyPuzzle.css';

interface DailyPuzzleLadderScreenProps {
  user: User | null;
  profile: UserProfile | null;
  initialToday: DailyPuzzleTodayResponse;
  initialLeaderboardOpen?: boolean;
  onLeaderboardClose?: () => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

type PlayStatus = 'IN_PROGRESS' | 'SOLVED' | 'FAILED';
type LadderPlayMode = 'scored' | 'practice';

export default function DailyPuzzleLadderScreen({
  user,
  profile,
  initialToday,
  initialLeaderboardOpen = false,
  onLeaderboardClose,
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
  const { handTileSize, handCompactStacked } = useResponsiveHandTileSize(runtimeState?.players.you.hand.length);
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [finalizePending, setFinalizePending] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(initialLeaderboardOpen);
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
  const loadHeroAsset = useCallback(
    () => import('../assets/dailyPuzzle/newnewladderfinal.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('daily-puzzle-ladder-hero', loadHeroAsset);
  const hubSlots = today.attemptSlots ?? today.slots;
  const publishedSlotCount =
    hubSlots.length === LEGACY_DAILY_PUZZLE_SLOT_COUNT
      ? LEGACY_DAILY_PUZZLE_SLOT_COUNT
      : DAILY_PUZZLE_SLOT_COUNT;

  const finalizeReady = useMemo(
    () =>
      Boolean(
        attempt &&
          attempt.status === 'started' &&
          attempt.result.slots.length >= DAILY_PUZZLE_SLOT_COUNT,
      ),
    [attempt, publishedSlotCount],
  );

  const { submitPending, runFinalize, completeSlot: submitLadderSlot } = useDailyPuzzleLadderGameplay({
    attempt,
    finalizeReady,
    finalizePending,
    playMode,
    movesUsed,
    startTimeRef,
    moveTraceRef,
    setAttempt,
    setToday,
    setHubError,
    setFinalizePending,
    setSlotOverlay,
    setFinalOverlay,
    setPracticeOverlay,
    finalOverlay,
  });

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

  const launchSlot = useCallback((slot: DailyPuzzleSlot, mode: LadderPlayMode, attemptForStorage = attempt) => {
    const puzzle = toCuratedPuzzle(slot);
    if (!puzzle) {
      setHubError(`Slot ${slot.slotIndex} is missing board data.`);
      return;
    }
    setPlayMode(mode);
    setActiveSlot(slot);
    const saved = mode === 'scored'
      ? loadDailyPuzzleLadderSession(attemptForStorage?.id, today.runDate, slot.id)
      : null;
    setRuntimeState(saved?.runtimeState ?? createPuzzleMatchState(puzzle));
    setStatus(saved?.status ?? 'IN_PROGRESS');
    setSelectedTile(null);
    setMovesUsed(saved?.movesUsed ?? 0);
    setFinalScore(saved?.finalScore ?? null);
    runningScoreRef.current = saved?.runningScore ?? 0;
    moveTraceRef.current = saved?.moveTrace ?? [];
    startTimeRef.current = saved?.startedAt ?? Date.now();
    setSlotOverlay(null);
    setFinalOverlay(null);
    setPracticeOverlay(null);
  }, [attempt, today.runDate]);

  const handleStartScored = useCallback(async () => {
    if (startPending || finalizePending) return;
    if (finalizeReady && attempt) {
      await runFinalize();
      return;
    }
    setStartPending(true);
    setHubError(null);
    try {
      const response = await startDailyPuzzleLadder(today.runDate);
      setAttempt(response.attempt);
      setToday((current) => ({
        ...current,
        attemptStatus: response.attempt.status,
        attempt: response.attempt,
        finalizeReady: response.finalizeReady ?? false,
      }));
      if (response.finalizeReady) {
        await runFinalize();
        return;
      }
      launchSlot(response.activeSlot, response.practiceMode === 'none' ? 'scored' : 'practice', response.attempt);
    } catch (error) {
      setHubError(error instanceof Error ? error.message : 'Unable to start today’s ladder.');
    } finally {
      setStartPending(false);
    }
  }, [attempt, finalizePending, finalizeReady, launchSlot, runFinalize, startPending, today.runDate]);

  const hubSlots = today.attemptSlots ?? today.slots;

  const handleStartPractice = useCallback((slotIndex: DailyPuzzleSlotIndex) => {
    const slot = hubSlots.find((entry) => entry.slotIndex === slotIndex);
    if (!slot) return;
    launchSlot(slot, 'practice');
  }, [hubSlots, launchSlot]);

  const legalMoves = useMemo(() => {
    if (!runtimeState || status !== 'IN_PROGRESS') return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((move) => move.type === 'play');
  }, [runtimeState, status]);

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
      const upcoming = getLegalMoves(nextState, 'you').filter((c) => c.type === 'play');
      const outcome = evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded,
        isDouble: isDominoDouble(move.tile!),
        priorRunningScore: runningScoreRef.current,
        nextCurrentPlayer: nextState.currentPlayer,
        upcomingPlayMovesCount: upcoming.length,
      });
      if (outcome.type === 'terminal') {
        runningScoreRef.current = outcome.runningScore;
        setFinalScore(outcome.runningScore);
        setStatus(outcome.status);
        void submitLadderSlot(outcome.status, outcome.runningScore, activeSlot);
      } else {
        runningScoreRef.current = outcome.runningScore;
      }
      return;
    }

    const upcoming = getLegalMoves(nextState, 'you').filter((candidate) => candidate.type === 'play');
    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: activeSlot.targetScore,
      maxMoves: activeSlot.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcoming.length,
    });
    if (targetOutcome.type === 'terminal') {
      setFinalScore(targetOutcome.totalScore);
      setStatus(targetOutcome.status);
      void submitLadderSlot(targetOutcome.status, targetOutcome.totalScore, activeSlot);
    }
  }, [activeSlot, flashLastPlayed, legalMoves, movesUsed, runtimeState, selectedTile, status, submitLadderSlot]);

  useEffect(() => {
    if (!activeSlot || activeSlot.puzzleType !== 'one_turn_high_score' || status !== 'IN_PROGRESS') return;
    if (runtimeState == null) return;
    if (shouldRecoverCompletedOneTurnHighScore(runtimeState.currentPlayer)) {
      const recoveredScore = runningScoreRef.current;
      setFinalScore(recoveredScore);
      setStatus('SOLVED');
      void submitLadderSlot('SOLVED', recoveredScore, activeSlot);
      return;
    }
    if (!shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMoves.length)) return;
    setFinalScore(0);
    setStatus('FAILED');
    void submitLadderSlot('FAILED', 0, activeSlot);
  }, [activeSlot, legalMoves.length, runtimeState, status, submitLadderSlot]);

  const currentSlotBreakdown = useMemo(
    () => buildLadderSlotBreakdown(completedSlots),
    [completedSlots],
  );

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

  const ladderSlotRows = useMemo(
    () =>
      buildLadderSlotRows({
        hubSlots,
        completedSlots,
        attemptStatus: attempt?.status,
        nextSlotIndex,
      }),
    [attempt?.status, completedSlots, hubSlots, nextSlotIndex],
  );
  const ladderTotalPoints = useMemo(
    () => computeLadderTotalPoints(today.slots),
    [today.slots],
  );

  const inActivePlay = Boolean(activeSlot && runtimeState);

  useEffect(() => {
    if (playMode !== 'scored' || status !== 'IN_PROGRESS' || !attempt || !activeSlot || !runtimeState) return;
    persistDailyPuzzleLadderSession({
      version: 1,
      attemptId: attempt.id,
      runDate: today.runDate,
      slotId: activeSlot.id,
      slotIndex: activeSlot.slotIndex,
      runtimeState,
      status,
      movesUsed,
      finalScore,
      runningScore: runningScoreRef.current,
      moveTrace: [...moveTraceRef.current],
      startedAt: startTimeRef.current || Date.now(),
      updatedAt: Date.now(),
    });
  }, [activeSlot, attempt, finalScore, movesUsed, playMode, runtimeState, status, today.runDate]);

  const exitPlayToHub = useCallback(() => {
    setSlotOverlay(null);
    setFinalOverlay(null);
    setPracticeOverlay(null);
    setRuntimeState(null);
    setActiveSlot(null);
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
  }, []);

  const ladderOverlays = (
    <DailyPuzzleLadderOverlays
      flags={{
        submitPending,
        finalizePending,
        slotOverlay,
        practiceOverlay,
        finalOverlay,
      }}
      currentSlotBreakdown={currentSlotBreakdown}
      finalLadderShareText={finalLadderShareText}
      shareDone={shareDone}
      actions={{
        exitPlayToHub,
        onSlotNext: (nextSlot) => {
          setSlotOverlay(null);
          launchSlot(nextSlot, 'scored');
        },
        onPracticeReplay: (idx) => {
          setPracticeOverlay(null);
          handleStartPractice(idx);
        },
        onPracticeNext: (idx) => {
          setPracticeOverlay(null);
          handleStartPractice(idx);
        },
        onPracticeExitToHub: () => {
          setPracticeOverlay(null);
          setRuntimeState(null);
          setActiveSlot(null);
        },
        onShareResult: handleShareLadderResult,
        onFinalHome: () => {
          exitPlayToHub();
          onBack();
        },
        onFinalReview: () => {
          setFinalOverlay(null);
          exitPlayToHub();
        },
        onFinalLeaderboard: () => {
          setFinalOverlay(null);
          exitPlayToHub();
          if (onNavigate) onNavigate('dailyPuzzleLeaderboard');
          else setLeaderboardOpen(true);
        },
      }}
    />
  );

  if (leaderboardOpen) {
    return (
      <DailyPuzzleLadderLeaderboardScreen
        user={user}
        runDate={today.runDate}
        currentUsername={profile?.username ?? null}
        currentUserId={user?.id ?? null}
        glickoRating={profile?.glicko_rating ?? null}
        onBack={() => {
          if (onLeaderboardClose) onLeaderboardClose();
          else setLeaderboardOpen(false);
        }}
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
      />
    );
  }

  if (!inActivePlay) {
    const showNav = Boolean(onNavigate && onOpenAuth);
    const isLadderComplete = attempt?.status === 'completed';
    const needsFinalize = finalizeReady && !isLadderComplete;
    const ladderStateLabel = isLadderComplete
      ? 'Completed'
      : needsFinalize
        ? 'Finalize run'
        : attempt
          ? `Live · Puzzle ${attempt.currentSlotIndex}`
          : 'Ready to start';
    const primaryLabel = isLadderComplete
      ? 'Practice Mode'
      : needsFinalize
        ? finalizePending
          ? 'Finalizing…'
          : 'Finalize Run'
        : attempt
          ? 'Resume Daily Ladder'
          : 'Start Daily Ladder';
    const trustLine = isLadderComplete
      ? 'Practice any puzzle after your scored run.'
      : needsFinalize
        ? 'All five puzzles are scored. Finalize to unlock review and the leaderboard.'
        : 'Leaderboard updates after a scored run.';

    return (
      <DailyPuzzleLadderHubView
        overlays={ladderOverlays}
        viewModel={{
          labels: {
            showNav,
            isLadderComplete,
            ladderStateLabel,
            primaryLabel,
            trustLine,
          },
          runDate: today.runDate,
          attemptTotalScore: attempt?.totalScore ?? 0,
          streakDisplay,
          ladderTotalPoints,
          ladderSlotRows,
          heroSrc,
          hubError,
          hubLadderShareText,
          shareDone,
          startPending,
          finalizePending,
        }}
        actions={{
          onBack,
          onNavigate,
          onOpenAuth,
          onOpenAccount,
          onStartScored: handleStartScored,
          onStartPractice: handleStartPractice,
          onOpenLeaderboard: () => {
            if (onNavigate) onNavigate('dailyPuzzleLeaderboard');
            else setLeaderboardOpen(true);
          },
          onShareResult: handleShareLadderResult,
        }}
      />
    );
  }

  const playingSlot = activeSlot!;
  const playingState = runtimeState!;

  return (
    <>
      {ladderOverlays}
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud daily-puzzle-root">
        <MatchLiveLayout
          hudLeft={
            <div className="wl-player-pill wl-player-pill-btn score-card is-you">
              <div className="wl-player-card-content">
                <div className="wl-player-card-text">
                  <span className="wl-player-label">
                    {getDailyPuzzleDisplayTitle(playingSlot.slotIndex, playingSlot.slotTitle)}
                  </span>
                </div>
                <span className="wl-player-score">{displayScore}</span>
              </div>
            </div>
          }
          hudCenter={
            <div className="wl-center-status" data-ui="turn-status">
              <span className="wl-turn-label your-turn">DAILY PUZZLE LADDER</span>
                      <span className="wl-room-code">Puzzle {playingSlot.slotIndex} / 5</span>
            </div>
          }
          hudRight={
            <div className="rh-match-solo-actions">
              <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={onBack}>
                ← Back to Home
              </button>
              <button type="button" className="rh-match-solo-action-btn" onClick={() => setLeaderboardOpen(true)}>
                Leaderboard
              </button>
            </div>
          }
          boardInner={
            <Board
              board={playingState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={84}
            />
          }
          handDock={
            <DailyPuzzleSoloHandDock
              hand={playingState.players.you.hand}
              handTileSize={handTileSize}
              handCompactStacked={handCompactStacked}
              selectedTile={selectedTile}
              inProgress={status === 'IN_PROGRESS'}
              isTilePlayable={(tile) =>
                legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile))
              }
              onSelectTile={setSelectedTile}
              handRowKeyPrefix="ladder-hand-row"
              tileKeyPrefix="ladder"
            />
          }
        />
      </div>
    </>
  );
}
