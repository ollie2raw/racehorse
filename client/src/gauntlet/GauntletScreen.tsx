import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import LayoutScreen from '../ui/LayoutScreen';
import { Board, DominoTile } from '../components';
import { applyPlayMove, getLegalMoves, type BotMatchState } from '../bot/botEngine';
import type { Move, Tile } from '../types';
import {
  bankGauntletAttempt,
  finishGauntletAttempt,
  getGauntletLeaderboard,
  getTodayGauntletSummary,
  publishTodayGauntlet,
  startGauntletAttempt,
  submitGauntletRound,
  toUserFacingError,
} from './api';
import type {
  GauntletLeaderboardRow,
  GauntletRoundSubmitResult,
  GauntletTodaySummary,
  PublicGauntletScenario,
  ReplayFrame,
} from './types';
import './gauntlet.css';

interface GauntletScreenProps {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  onBack: () => void;
}

type GauntletView = 'lobby' | 'round' | 'between' | 'final';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Closed';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function isPlaceholderUsername(username: string): boolean {
  return /^user_[a-f0-9]{8}$/i.test(username);
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function cloneMove(move: Move): Move {
  return {
    type: move.type,
    tile: move.tile ? { ...move.tile } : undefined,
    position: move.position,
  };
}

const FALLBACK_ROUNDS: PublicGauntletScenario[] = [
  {
    round: 1,
    difficulty: 'intro',
    playerHand: [{ low: 1, high: 5 }, { low: 2, high: 5 }, { low: 0, high: 1 }, { low: 4, high: 6 }, { low: 3, high: 3 }],
    boardState: {
      mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' }],
      leftEnd: 1,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 3,
    optimalScore: 500,
  },
  {
    round: 2,
    difficulty: 'easy',
    playerHand: [{ low: 0, high: 4 }, { low: 2, high: 4 }, { low: 4, high: 5 }, { low: 1, high: 2 }, { low: 3, high: 6 }, { low: 2, high: 2 }],
    boardState: {
      mainLine: [{ tile: { low: 2, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 6,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 4,
    optimalScore: 800,
  },
  {
    round: 3,
    difficulty: 'medium',
    playerHand: [{ low: 1, high: 6 }, { low: 0, high: 6 }, { low: 6, high: 6 }, { low: 2, high: 3 }, { low: 3, high: 5 }, { low: 1, high: 3 }, { low: 2, high: 5 }],
    boardState: {
      mainLine: [{ tile: { low: 0, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 0,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 5,
    optimalScore: 1200,
  },
  {
    round: 4,
    difficulty: 'hard',
    playerHand: [{ low: 0, high: 3 }, { low: 3, high: 4 }, { low: 3, high: 6 }, { low: 1, high: 1 }, { low: 2, high: 4 }, { low: 4, high: 4 }, { low: 1, high: 5 }],
    boardState: {
      mainLine: [{ tile: { low: 1, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 1,
      rightEnd: 6,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 6,
    optimalScore: 1800,
  },
  {
    round: 5,
    difficulty: 'brutal',
    playerHand: [{ low: 0, high: 0 }, { low: 0, high: 2 }, { low: 2, high: 6 }, { low: 5, high: 6 }, { low: 3, high: 5 }, { low: 1, high: 4 }, { low: 2, high: 2 }],
    boardState: {
      mainLine: [{ tile: { low: 2, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 6,
    optimalScore: 2500,
  },
];

function isScenarioConfigured(scenario: PublicGauntletScenario | null | undefined): scenario is PublicGauntletScenario {
  if (!scenario) return false;
  if (!Array.isArray(scenario.playerHand) || scenario.playerHand.length === 0) return false;
  if (!scenario.boardState || !Array.isArray(scenario.boardState.mainLine)) return false;
  if (scenario.boardState.mainLine.length === 0) return false;
  return true;
}

function withPlayableFallback(scenario: PublicGauntletScenario | null | undefined, roundIdx: number): PublicGauntletScenario {
  if (isScenarioConfigured(scenario)) return scenario;
  return FALLBACK_ROUNDS[Math.max(0, Math.min(FALLBACK_ROUNDS.length - 1, roundIdx))];
}

function createRoundState(scenario: PublicGauntletScenario): BotMatchState {
  const boardHasTiles = Array.isArray(scenario.boardState?.mainLine) && scenario.boardState.mainLine.length > 0;
  return {
    players: {
      you: { hand: [...scenario.playerHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: boardHasTiles
      ? {
          ...scenario.boardState,
          mainLine: [...scenario.boardState.mainLine],
          hubDoubles: [...scenario.boardState.hubDoubles],
        }
      : null,
    boneyard: [],
    deadTiles: [],
    handOpen: boardHasTiles,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export default function GauntletScreen({ user, profile, isAdmin, onBack }: GauntletScreenProps) {
  const [summary, setSummary] = useState<GauntletTodaySummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<GauntletLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submittingRound, setSubmittingRound] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [view, setView] = useState<GauntletView>('lobby');
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [runningTotal, setRunningTotal] = useState(0);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const [roundMoves, setRoundMoves] = useState<Move[]>([]);
  const [roundReplay, setRoundReplay] = useState<ReplayFrame[]>([]);
  const [allReplayFrames, setAllReplayFrames] = useState<ReplayFrame[]>([]);
  const [roundStartMs, setRoundStartMs] = useState(0);
  const [latestRoundResult, setLatestRoundResult] = useState<GauntletRoundSubmitResult | null>(null);
  const [roundAutoSubmitted, setRoundAutoSubmitted] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const refreshSummary = async () => {
    const today = await getTodayGauntletSummary();
    setSummary(today);
    if (today?.dayDate) {
      const rows = await getGauntletLeaderboard(today.dayDate);
      setLeaderboard(rows);
    } else {
      setLeaderboard([]);
    }
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const today = await getTodayGauntletSummary();
        if (!active) return;
        setSummary(today);
        if (today?.dayDate) {
          const rows = await getGauntletLeaderboard(today.dayDate);
          if (!active) return;
          setLeaderboard(rows);
        } else {
          setLeaderboard([]);
        }
      } catch (err) {
        if (!active) return;
        setError(toUserFacingError(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const closeMs = useMemo(() => {
    if (!summary?.closesAt) return 0;
    return new Date(summary.closesAt).getTime() - now;
  }, [summary?.closesAt, now]);

  const displayName = profile?.username && !isPlaceholderUsername(profile.username)
    ? `@${profile.username}`
    : 'Player';

  const rounds = summary?.rounds ?? [];
  const hasFallbackRounds = useMemo(
    () => rounds.some((round) => !isScenarioConfigured(round)),
    [rounds],
  );
  const playableRounds = useMemo(
    () => rounds.map((round, idx) => withPlayableFallback(round, idx)),
    [rounds],
  );
  const activeRound = playableRounds[currentRoundIndex] ?? null;

  const legalMoves = useMemo(() => {
    if (!runtimeState || view !== 'round') return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((m) => m.type === 'play' && m.tile && m.position);
  }, [runtimeState, view]);

  const playableTiles = useMemo(() => {
    const set = new Set<string>();
    for (const move of legalMoves) {
      if (!move.tile) continue;
      set.add(`${move.tile.low}-${move.tile.high}`);
    }
    return set;
  }, [legalMoves]);

  const openRound = (roundIdx: number) => {
    const scenario = rounds[roundIdx];
    const safeScenario = withPlayableFallback(scenario, roundIdx);
    if (!safeScenario) return;
    setCurrentRoundIndex(roundIdx);
    setRuntimeState(createRoundState(safeScenario));
    setSelectedTile(null);
    setRoundMoves([]);
    setRoundReplay([]);
    setRoundStartMs(Date.now());
    setRoundAutoSubmitted(false);
    setView('round');
  };

  const handlePublishToday = async () => {
    if (!isAdmin) return;
    setPublishing(true);
    setError(null);
    try {
      await publishTodayGauntlet('racehorse-prod');
      await refreshSummary();
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setPublishing(false);
    }
  };

  const handleStartOrResume = async () => {
    if (!user) {
      setError('Sign in to enter The Gauntlet.');
      return;
    }

    setStarting(true);
    setError(null);
    try {
      let nextAttemptId: number | null = null;
      let nextRoundsPlayed = 0;
      let nextTotal = 0;

      const started = await startGauntletAttempt();
      nextAttemptId = started.attemptId;

      await refreshSummary();
      const refreshed = await getTodayGauntletSummary();
      if (refreshed) {
        setSummary(refreshed);
        nextRoundsPlayed = refreshed.roundsPlayed;
        nextTotal = refreshed.totalScore;
        nextAttemptId = refreshed.attemptId ?? nextAttemptId;
      }

      if (!nextAttemptId) {
        setError('Unable to start attempt.');
        return;
      }

      setAttemptId(nextAttemptId);
      setRunningTotal(nextTotal);
      setAllReplayFrames([]);
      openRound(Math.min(4, nextRoundsPlayed));
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setStarting(false);
    }
  };

  const handlePositionClick = (position: Move['position']) => {
    if (!runtimeState || !selectedTile || !activeRound || submittingRound) return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.position === position &&
        candidate.tile &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const moveCopy = cloneMove(move);

    const frame: ReplayFrame = {
      roundNumber: activeRound.round,
      moveIndex: roundMoves.length,
      move: moveCopy,
      timestampMs: Math.max(0, Date.now() - roundStartMs),
      boardStateAfter: nextState.board
        ? {
            ...nextState.board,
            mainLine: [...nextState.board.mainLine],
            hubDoubles: [...nextState.board.hubDoubles],
          }
        : {
            mainLine: [],
            leftEnd: 0,
            rightEnd: 0,
            leftEndIsDouble: false,
            rightEndIsDouble: false,
            hubDoubles: [],
          },
    };

    setRuntimeState(nextState);
    setRoundMoves((prev) => [...prev, moveCopy]);
    setRoundReplay((prev) => [...prev, frame]);
    setSelectedTile(null);
  };

  const submitCurrentRound = async () => {
    if (!attemptId || !activeRound || !runtimeState || submittingRound) return;
    setSubmittingRound(true);
    setError(null);
    try {
      const playerScore = runtimeState.players.you.score;
      const timeTakenMs = Math.max(0, Date.now() - roundStartMs);

      const scored = await submitGauntletRound({
        attemptId,
        roundNumber: activeRound.round,
        movesPlayed: roundMoves,
        replayFrames: roundReplay,
        timeTakenMs,
        playerScore,
      });

      setLatestRoundResult(scored);
      setRunningTotal(scored.runningTotal);
      setAllReplayFrames((prev) => [...prev, ...roundReplay]);

      if (!scored.hasMoreRounds || activeRound.round >= 5) {
        setFinishing(true);
        const finalized = await finishGauntletAttempt(attemptId, [...allReplayFrames, ...roundReplay]);
        setRunningTotal(finalized.totalScore);
        await refreshSummary();
        setView('final');
      } else {
        setView('between');
      }
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setSubmittingRound(false);
      setFinishing(false);
    }
  };

  useEffect(() => {
    if (view !== 'round' || !runtimeState || submittingRound || roundAutoSubmitted) return;
    if (legalMoves.length > 0) return;
    setRoundAutoSubmitted(true);
    void submitCurrentRound();
  }, [view, runtimeState, submittingRound, roundAutoSubmitted, legalMoves.length]);

  const handleContinue = () => {
    if (!activeRound) return;
    openRound(Math.min(4, currentRoundIndex + 1));
  };

  const handleBank = async () => {
    if (!attemptId || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const finalized = await bankGauntletAttempt(attemptId, allReplayFrames);
      setRunningTotal(finalized.totalScore);
      await refreshSummary();
      setView('final');
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setFinishing(false);
    }
  };

  const renderLobby = () => (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
      badge="Racehorse Dominoes"
      title="The Gauntlet"
      subtitle="Five escalating daily scenarios. Same seed for everyone."
      contentClassName="screen-shell"
    >
      <div className="gauntlet-shell">
        <div className="gauntlet-entry-card">
          <div className="gauntlet-entry-top">
            <div>
              <p className="gauntlet-kicker">Daily Challenge</p>
              <h2>⚔ The Gauntlet</h2>
            </div>
            <span className="gauntlet-pill">DAILY</span>
          </div>

          {loading && <p className="lobby-server">Loading today&apos;s gauntlet...</p>}
          {!loading && !summary && <p className="lobby-server">No gauntlet published for today yet.</p>}
          {error && <p className="auth-inline-error">{error}</p>}
          {summary && hasFallbackRounds && (
            <p className="gauntlet-fallback-note">
              Using fallback round templates. Publish full generated rounds for true daily challenge quality.
            </p>
          )}
          {isAdmin && (
            <button
              className="mode-inline-btn gauntlet-admin-publish"
              onClick={handlePublishToday}
              disabled={publishing}
            >
              {publishing ? 'Publishing...' : "Admin: Publish Today's Gauntlet"}
            </button>
          )}

          {summary && (
            <>
              <p className="gauntlet-stat">Your rating: <strong>{summary.rating.toLocaleString()}</strong> [{summary.division}]</p>
              <p className="gauntlet-stat">Today&apos;s attempts: {summary.attemptCount.toLocaleString()} players</p>
              <p className="gauntlet-stat">Signed in as: {user ? displayName : 'Guest (read-only)'}</p>

              <div className="gauntlet-round-track" aria-label="Gauntlet rounds">
                {summary.rounds.map((round) => (
                  <div key={round.round} className={`gauntlet-round-dot round-${round.difficulty}`} title={`Round ${round.round}: ${round.difficulty}`}>
                    {round.round}
                  </div>
                ))}
              </div>

              <p className="gauntlet-close">Closes in: {formatRemaining(closeMs)}</p>

              <div className="gauntlet-actions">
                <button className="mode-option mode-option-primary gauntlet-enter-btn" onClick={handleStartOrResume} disabled={starting || !user || closeMs <= 0}>
                  <span className="mode-option-title">{summary.attemptId ? 'Resume Attempt' : 'Enter the Gauntlet'}</span>
                  <span className="mode-option-meta">
                    {summary.attemptId
                      ? `Attempt #${summary.attemptId} · ${summary.roundsPlayed}/5 rounds · ${summary.totalScore.toLocaleString()} pts`
                      : 'Start your one run for today'}
                  </span>
                </button>
                <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
              </div>
            </>
          )}
        </div>

        <div className="gauntlet-leaderboard-card mode-option">
          <h3>Leaderboard Preview</h3>
          {leaderboard.length === 0 ? (
            <p className="lobby-server">No finalized attempts yet.</p>
          ) : (
            <div className="gauntlet-leaderboard-list">
              {leaderboard.slice(0, 5).map((row) => (
                <div key={`${row.rank}-${row.userId}`} className={`gauntlet-leaderboard-row ${row.isCaller ? 'is-caller' : ''}`}>
                  <span>#{row.rank}</span>
                  <span className="gauntlet-name">{row.username}</span>
                  <span>{row.totalScore.toLocaleString()}</span>
                  <span>{row.division}</span>
                </div>
              ))}
            </div>
          )}
          <p className="gauntlet-footnote">Full replay unlocks after close at 00:00 UTC.</p>
        </div>
      </div>
    </LayoutScreen>
  );

  const renderRound = () => {
    if (!runtimeState || !activeRound) return null;

    return (
      <div className="screen game-screen walnut-live theme-green gauntlet-play-screen">
        <div className="wl-top-rail gauntlet-top-rail" data-ui="hud">
          <div className="wl-player-pill is-active daily-hud-pill">
            <span className="wl-player-label">Gauntlet Total</span>
            <span className="wl-player-score">{runningTotal}</span>
          </div>
          <div className="daily-center-zone">
            <div className="wl-center-status">
              <span className="wl-turn-label your-turn">Round {activeRound.round}/5 · {activeRound.difficulty}</span>
              <span className="wl-room-code">Round score: {runtimeState.players.you.score}</span>
            </div>
          </div>
          <div className="daily-top-actions-pill">
            <button className="btn text compact daily-chip-control" onClick={onBack}>Back to Home</button>
          </div>
        </div>

        {error && <div className="gauntlet-inline-error">{error}</div>}
        <div className="gauntlet-objective">
          Objective: maximize this round&apos;s score in one turn sequence. Scoring plays and doubles can extend your turn; non-scoring non-double plays usually end it.
        </div>

        <div className="wl-stage-shell">
          <div className="board-area wl-board-area" data-ui="board">
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              onPositionClick={handlePositionClick}
              tileSize={72}
            />
          </div>
        </div>

        <div className="hand-area wl-hand-area" data-ui="tray">
          <div className="tray-rail">
            <div className="tray-center">
              <div className="hand-container">
                <div className="hand-row">
                  {runtimeState.players.you.hand.map((tile, idx) => {
                    const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;
                    const key = `${tile.low}-${tile.high}`;
                    const playable = playableTiles.has(key);
                    return (
                      <DominoTile
                        key={`gauntlet-hand-${idx}-${key}`}
                        tile={tile}
                        size={56}
                        rotation={0}
                        selected={isSelected}
                        highlight={playable}
                        disabled={!playable || submittingRound}
                        onClick={() => {
                          if (!playable || submittingRound) return;
                          setSelectedTile(tile);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="gauntlet-round-actions">
          <button
            className="mode-option mode-option-primary"
            onClick={submitCurrentRound}
            disabled={submittingRound || finishing}
          >
            <span className="mode-option-title">{submittingRound ? 'Submitting...' : 'End Round & Score'}</span>
            <span className="mode-option-meta">Submit current line for server-side scoring</span>
          </button>
          <span className="gauntlet-round-meta">Moves played: {roundMoves.length}</span>
        </div>
      </div>
    );
  };

  const renderBetween = () => {
    if (!activeRound || !latestRoundResult) return null;

    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
        badge="Racehorse Dominoes"
        title={`Round ${activeRound.round} Complete`}
        subtitle="Bank now or push into the next round."
        contentClassName="screen-shell"
      >
        <div className="gauntlet-result-card">
          <p>Base score: <strong>{latestRoundResult.baseScore}</strong></p>
          <p>Speed bonus: <strong>+{latestRoundResult.speedBonus}</strong></p>
          <p>Optimality ({Math.round(latestRoundResult.optimalityPct * 100)}%): <strong>+{latestRoundResult.optimalityBonus}</strong></p>
          <p>Round total: <strong>{latestRoundResult.roundTotal}</strong></p>
          <p>Running total: <strong>{latestRoundResult.runningTotal}</strong></p>
          <p className="gauntlet-warning">
            Next round: <strong>{rounds[currentRoundIndex + 1]?.difficulty ?? 'final'}</strong>
          </p>
          {error && <p className="auth-inline-error">{error}</p>}
          <div className="gauntlet-actions">
            <button className="mode-option mode-option-secondary" onClick={handleBank} disabled={finishing}>
              <span className="mode-option-title">🏦 Bank My Score</span>
            </button>
            <button className="mode-option mode-option-primary" onClick={handleContinue} disabled={finishing}>
              <span className="mode-option-title">Push On →</span>
            </button>
          </div>
        </div>
      </LayoutScreen>
    );
  };

  const renderFinal = () => (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
      badge="Racehorse Dominoes"
      title="Gauntlet Complete"
      subtitle="Finalized for today."
      contentClassName="screen-shell"
    >
      <div className="gauntlet-result-card">
        <p>Total score: <strong>{runningTotal.toLocaleString()}</strong></p>
        <p>Attempt: <strong>#{attemptId ?? '-'}</strong></p>
        <p>Rounds completed: <strong>{summary?.roundsPlayed ?? currentRoundIndex + 1}</strong></p>
        <div className="gauntlet-actions">
          <button className="mode-option mode-option-secondary" onClick={() => setView('lobby')}>
            <span className="mode-option-title">Back to Gauntlet Lobby</span>
          </button>
          <button className="mode-option mode-option-secondary" onClick={onBack}>
            <span className="mode-option-title">Back to Home</span>
          </button>
        </div>
      </div>
    </LayoutScreen>
  );

  if (view === 'round') return renderRound();
  if (view === 'between') return renderBetween();
  if (view === 'final') return renderFinal();
  return renderLobby();
}
