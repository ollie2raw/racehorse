import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPuzzleRushToday, startPuzzleRush } from './api';
import { PuzzleRushLeaderboardScreen } from './PuzzleRushLeaderboardScreen';
import { PuzzleRushHubView } from './PuzzleRushHubView';
import { getLocalDateKey } from '../dailyPuzzle/date';
import type { AppMode } from '../types';
import { PuzzleRushPlayView } from './PuzzleRushPlayView';
import { RushResultsView } from './RushResultsView';
import { RushStageTransition } from './RushStageTransition';
import { estimateBonusSeconds } from './rushScoring';
import { useRushClock } from './useRushClock';
import { useRushRun } from './useRushRun';
import type {
  PuzzleRushStage,
  PuzzleRushStartResponse,
  PuzzleRushTodayResponse,
  RushPuzzleResult,
} from './types';
import './puzzleRush.css';

type Phase = 'intro' | 'starting' | 'running' | 'error' | 'leaderboard';

export interface PuzzleRushScreenProps {
  onBack: () => void;
  muted?: boolean;
  onNavigate?: (mode: AppMode) => void;
}

/**
 * Stage shape shown on the hub before a run exists. The server sends the real
 * plan with the run; this only has to describe the arc.
 */
const FALLBACK_STAGES: PuzzleRushStage[] = [
  { key: 'warm_up', label: 'Warm-Up', fromOrdinal: 1, toOrdinal: 3, maxPointsPerPuzzle: 100, puzzleCount: 3 },
  { key: 'building', label: 'Building', fromOrdinal: 4, toOrdinal: 8, maxPointsPerPuzzle: 250, puzzleCount: 5 },
  { key: 'master', label: 'Master', fromOrdinal: 9, toOrdinal: 15, maxPointsPerPuzzle: 500, puzzleCount: 7 },
];

export function PuzzleRushScreen({ onBack, muted = false, onNavigate }: PuzzleRushScreenProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [startResponse, setStartResponse] = useState<PuzzleRushStartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<PuzzleRushTodayResponse | null>(null);
  // Bumped when a run finishes, so returning to the hub re-reads /today and
  // the new personal best / streak show without a hard refresh.
  const [todayNonce, setTodayNonce] = useState(0);

  useEffect(() => {
    if (phase !== 'intro') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchPuzzleRushToday();
        if (!cancelled) setToday(response);
      } catch {
        // A hub that cannot read its stats still has to let you play.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, todayNonce]);

  const beginRun = useCallback(async () => {
    setPhase('starting');
    setError(null);
    try {
      // One request: the whole run and its stage plan. Nothing is fetched again
      // until the run ends.
      const response = await startPuzzleRush();
      setStartResponse(response);
      setPhase('running');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start Puzzle Rush.');
      setPhase('error');
    }
  }, []);

  if (phase === 'leaderboard') {
    return (
      <PuzzleRushLeaderboardScreen
        onBack={() => setPhase('intro')}
        onNavigate={onNavigate}
      />
    );
  }

  if (phase === 'running' && startResponse) {
    return (
      <PuzzleRushActiveRun
        key={startResponse.run.id}
        start={startResponse}
        muted={muted}
        onBack={() => {
          // Returning to the hub after a run: refresh the stats it shows.
          setStartResponse(null);
          setTodayNonce((n) => n + 1);
          setPhase('intro');
        }}
        onPlayAgain={() => {
          setStartResponse(null);
          setTodayNonce((n) => n + 1);
          void beginRun();
        }}
      />
    );
  }

  return (
    <PuzzleRushHubView
      viewModel={{
        runDate: today?.runDate ?? getLocalDateKey(),
        personalBest: today?.personalBest ?? null,
        streakDays: today?.streakDays ?? 0,
        playedToday: today?.playedToday ?? false,
        stages: FALLBACK_STAGES,
        baseSeconds: 120,
        startPending: phase === 'starting',
        error,
      }}
      actions={{
        onBack,
        onStart: () => void beginRun(),
        onNavigate,
        onOpenLeaderboard: () => setPhase('leaderboard'),
      }}
    />
  );
}

function PuzzleRushActiveRun({
  start,
  muted,
  onBack,
  onPlayAgain,
}: {
  start: PuzzleRushStartResponse;
  muted: boolean;
  /** Return to the hub (and refresh its stats). */
  onBack: () => void;
  onPlayAgain: () => void;
}) {
  const [transitionStage, setTransitionStage] = useState<PuzzleRushStage | null>(null);
  const [lastBonusSeconds, setLastBonusSeconds] = useState<number | null>(null);

  const clockRef = useRef<{ addSeconds: (seconds: number) => void } | null>(null);

  const run = useRushRun({
    start,
    onAdvance: (next) => {
      // The transition beat fires on the first ordinal of a stage, never on
      // ordinal 1 — the run's opening is not a "stage up".
      if (next && next.isStageStart && next.ordinal > 1) {
        const stage = start.stages.find((entry) => entry.key === next.stageKey) ?? null;
        setTransitionStage(stage);
      }
    },
  });

  const clock = useRushClock({
    baseSeconds: start.config.baseSeconds,
    maxSeconds: start.config.maxSeconds,
    autoStart: true,
    onExpire: () => {
      void run.finishRun();
    },
  });
  clockRef.current = clock;

  // Out of puzzles before the clock ran out: settle up immediately.
  useEffect(() => {
    if (run.outOfPuzzles && run.phase === 'playing') {
      clock.stop();
      void run.finishRun();
    }
  }, [clock, run]);

  const handlePuzzleFinished = useCallback(
    (result: Omit<RushPuzzleResult, 'bonusSeconds'>) => {
      const bonusSeconds = estimateBonusSeconds({
        rawScore: result.rawScore,
        config: start.config,
      });

      if (bonusSeconds > 0) clockRef.current?.addSeconds(bonusSeconds);
      setLastBonusSeconds(bonusSeconds > 0 ? bonusSeconds : null);

      // Fire-and-forget report + immediate advance; the clock never waits.
      run.reportResult({ ...result, bonusSeconds });
    },
    [run, start.config],
  );

  if (run.phase !== 'playing') {
    return (
      <div className="screen puzzle-rush-results-screen">
        {/* Same atmospheric ground as the hub — the bare obsidian panel on a
            flat black page was the dullest surface in the product. */}
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
          <div className="home-bg__domino home-bg__domino--tl" />
          <div className="home-bg__domino home-bg__domino--tr" />
          <div className="home-bg__line home-bg__line--1" />
          <div className="home-bg__line home-bg__line--2" />
          <div className="home-bg__line home-bg__line--3" />
          <div className="home-bg__texture" />
        </div>
        {run.phase === 'completing' ? (
          <div className="pr-results pr-results--pending" data-ui="rush-completing">
            <span className="pr-results__eyebrow">Scoring your run…</span>
          </div>
        ) : (
          <RushResultsView
            completion={run.completion}
            completeError={run.completeError}
            clientTally={run.clientTally}
            results={run.results}
            stages={run.stages}
            reportFailures={run.reportFailures}
            onPlayAgain={onPlayAgain}
            onBack={onBack}
          />
        )}
      </div>
    );
  }

  if (!run.current) return null;

  return (
    <>
      <PuzzleRushPlayView
        puzzle={run.current}
        stages={run.stages}
        completedOrdinals={run.completedOrdinals}
        secondsLeft={clock.secondsLeft}
        clientTally={run.clientTally}
        lastBonusSeconds={lastBonusSeconds}
        totalPuzzles={start.puzzles.length}
        onPuzzleFinished={handlePuzzleFinished}
        onQuit={() => {
          clock.stop();
          void run.finishRun();
        }}
      />
      <RushStageTransition
        stage={transitionStage}
        muted={muted}
        onDone={() => setTransitionStage(null)}
      />
    </>
  );
}

export default PuzzleRushScreen;
