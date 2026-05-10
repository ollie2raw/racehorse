import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, DominoTile, RotateOverlay } from '../components';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { Move, Tile } from '../types';
import {
  completeDailyPuzzleLadder,
  fetchDailyPuzzleLadderLeaderboard,
  getTodayDailyPuzzleLadder,
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
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';

interface DailyPuzzleLadderScreenProps {
  user: User | null;
  profile: UserProfile | null;
  initialToday: DailyPuzzleTodayResponse;
  onBack: () => void;
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
  });
}

function formatElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}

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
  initialToday,
  onBack,
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
    return (
      <>
        <div className="screen mode-subpage-screen mode-accent-daily daily-entry-screen">
          <div className="daily-dash" style={{ ['--dash-accent' as string]: '#f0c040' }}>
            <header className="daily-dash-topbar">
              <div className="daily-dash-brand">RACEHORSE</div>
              <button type="button" className="daily-dash-back" onClick={onBack}>
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M7.5 2L3 6l4.5 4" />
                </svg>
                Back to Home
              </button>
            </header>

            <main className="daily-dash-main">
              <div className="daily-dash-header">
                <p className="daily-dash-eyebrow">Daily Puzzle</p>
                <h1 className="daily-dash-title">Daily Puzzle Ladder</h1>
                <p className="daily-dash-subtitle">Three fixed puzzles. Same board for everyone.</p>
              </div>
              <div className="daily-dash-separator" aria-hidden="true" />
              <div className="daily-dash-body">
                <div className="daily-dash-details">
                  <div className="daily-ladder-card-grid">
                    {today.slots.map((slot) => {
                      const slotResult = completedSlots.find((entry) => entry.slotIndex === slot.slotIndex);
                      const isAvailable = nextSlotIndex === slot.slotIndex;
                      const isLocked = nextSlotIndex != null && nextSlotIndex < slot.slotIndex;
                      return (
                        <div
                          key={slot.id}
                          className={`daily-ladder-slot-card ${isAvailable ? 'is-available' : ''} ${slotResult ? 'is-complete' : ''} ${isLocked ? 'is-locked' : ''}`}
                        >
                          <div className="daily-ladder-slot-head">
                            <span className="daily-ladder-slot-label">Puzzle {slot.slotIndex}</span>
                            <span className="daily-ladder-slot-points">{slot.slotMaxPoints} pts max</span>
                          </div>
                          <strong>{slot.slotTitle}</strong>
                          <p>{slot.slotIndex === 1 ? 'Short warmup.' : slot.slotIndex === 2 ? 'Medium tactic.' : 'Deep chain challenge.'}</p>
                          <span className="daily-ladder-slot-status">
                            {slotResult
                              ? `Completed · ${slotResult.awardedPoints} pts`
                              : isAvailable
                                ? 'Available Now'
                                : isLocked
                                  ? 'Locked'
                                  : 'Pending'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="daily-dash-actions">
                  <div className="daily-ladder-summary-card">
                    <ClaudeSectionLabel color="#f0c040">Today&apos;s Ladder</ClaudeSectionLabel>
                    <ClaudeStatLine label="Date" value={formatDateLabel(today.runDate)} />
                    <ClaudeStatLine label="Total Score" value={`${attempt?.totalScore ?? 0}`} accent="#f0c040" />
                    <ClaudeStatLine label="Completed" value={`${attempt?.puzzlesCompleted ?? 0}/3`} />
                    <ClaudeStatLine label="Master Chain" value={`${attempt?.masterChainScore ?? 0}`} />
                  </div>

                  {hubError ? <p className="auth-inline-error" style={{ margin: '8px 0' }}>{hubError}</p> : null}

                  <div className="daily-dash-actions-group" style={{ display: 'grid', gap: '12px', marginTop: '8px' }}>
                    {attempt?.status === 'completed' ? (
                      <>
                        <ClaudePrimaryAction
                          accent="#f0c040"
                          title="Practice Mode"
                          meta="Replay P1 → P2 → P3"
                          onClick={() => handleStartPractice(1)}
                        />
                        <ClaudeSecondaryAction
                          title="Leaderboard"
                          meta="View global standings"
                          onClick={() => setLeaderboardOpen(true)}
                        />
                      </>
                    ) : (
                      <>
                        <ClaudePrimaryAction
                          accent="#f0c040"
                          disabled={startPending}
                          title={attempt ? `Resume Puzzle ${attempt.currentSlotIndex}` : 'Start Daily Ladder'}
                          meta={attempt ? 'Continue your scored run' : 'Begin today’s three-puzzle ladder'}
                          onClick={() => {
                            void handleStartScored();
                          }}
                        />
                        <ClaudeSecondaryAction
                          title="Leaderboard"
                          meta="View global standings"
                          onClick={() => setLeaderboardOpen(true)}
                        />
                      </>
                    )}
                  </div>

                  {attempt?.status === 'completed' ? (
                    <div style={{ marginTop: '20px', padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Jump to Practice</p>
                      <div className="daily-ladder-practice-row" style={{ justifyContent: 'flex-start', gap: '8px', marginTop: 0 }}>
                        {[1, 2, 3].map((slotIdx) => (
                          <button
                            key={`practice-${slotIdx}`}
                            type="button"
                            className="mode-inline-btn"
                            style={{ flex: 1, fontSize: '11px', padding: '10px 4px', textTransform: 'uppercase', fontWeight: 800 }}
                            onClick={() => handleStartPractice(slotIdx as 1 | 2 | 3)}
                          >
                            P{slotIdx}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </main>
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
                <button type="button" className="rh-btn-home" onClick={onBack}>
                  Home
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
            <button className="btn text compact daily-chip-control" onClick={onBack}>Back to Home</button>
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
                      const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;
                      return (
                        <DominoTile
                          key={`ladder-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          selected={isSelected}
                          highlight={playable && status === 'IN_PROGRESS'}
                          disabled={status !== 'IN_PROGRESS' || !playable}
                          onClick={() => {
                            if (status !== 'IN_PROGRESS' || !playable) return;
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
                    Back to Ladder
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
