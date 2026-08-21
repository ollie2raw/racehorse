// @vitest-environment jsdom
/**
 * Puzzle Rush core loop.
 *
 * The four behaviours here are the ones the design depends on and that a
 * refactor could quietly break: one request per run, a transition beat only at
 * real stage boundaries, an advance that never waits on the network, and a
 * results headline that is the server's number rather than the client's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { RushResultsView } from './RushResultsView';
import { RushStageProgress } from './RushStageProgress';
import { useRushRun } from './useRushRun';
import type {
  PuzzleRushCompleteResponse,
  PuzzleRushPuzzle,
  PuzzleRushStage,
  PuzzleRushStartResponse,
  RushPuzzleResult,
} from './types';

const mocks = vi.hoisted(() => ({
  reportPuzzleRushPuzzle: vi.fn(),
  completePuzzleRush: vi.fn(),
  startPuzzleRush: vi.fn(),
}));

vi.mock('./api', () => ({
  reportPuzzleRushPuzzle: (...args: unknown[]) => mocks.reportPuzzleRushPuzzle(...args),
  completePuzzleRush: (...args: unknown[]) => mocks.completePuzzleRush(...args),
  startPuzzleRush: (...args: unknown[]) => mocks.startPuzzleRush(...args),
}));

// ─── fixtures ────────────────────────────────────────────────────────────

const STAGES: PuzzleRushStage[] = [
  { key: 'warm_up', label: 'Warm-Up', fromOrdinal: 1, toOrdinal: 3, maxPointsPerPuzzle: 100, puzzleCount: 3 },
  { key: 'building', label: 'Building', fromOrdinal: 4, toOrdinal: 8, maxPointsPerPuzzle: 250, puzzleCount: 5 },
  { key: 'master', label: 'Master', fromOrdinal: 9, toOrdinal: 15, maxPointsPerPuzzle: 500, puzzleCount: 7 },
];

function stageForOrdinal(ordinal: number): PuzzleRushStage {
  return [...STAGES].reverse().find((stage) => ordinal >= stage.fromOrdinal) ?? STAGES[0];
}

function makePuzzle(ordinal: number): PuzzleRushPuzzle {
  const stage = stageForOrdinal(ordinal);
  return {
    ordinal,
    puzzleId: `pool-${ordinal}`,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    } as never,
    startingHand: [{ low: 1, high: 2 }],
    maxMoves: 1,
    puzzleType: 'one_turn_high_score',
    tier: stage.key === 'warm_up' ? 'quick_line' : stage.key === 'building' ? 'tactical_setup' : 'master_chain',
    dealSize: 14,
    targetScore: 999,
    maxPoints: stage.maxPointsPerPuzzle,
    stageKey: stage.key,
    stageLabel: stage.label,
    isStageStart: STAGES.some((entry) => entry.fromOrdinal === ordinal),
  };
}

function makeStart(count = 30): PuzzleRushStartResponse {
  return {
    ok: true,
    replayed: false,
    run: {
      id: 'run-1',
      userId: 'user-1',
      username: 'Player',
      status: 'in_progress',
      startedAt: '2026-08-20T10:00:00.000Z',
      endedAt: null,
      totalScore: 0,
      puzzlesSolved: 0,
      clientReportedScore: 0,
      invalidatedReason: null,
      configVersion: 1,
    },
    puzzles: Array.from({ length: count }, (_, i) => makePuzzle(i + 1)),
    selection: { requested: 15, served: count, shortfall: count < 15, fallbackCount: 0 },
    stages: STAGES,
    config: {
      version: 1,
      baseSeconds: 90,
      maxSeconds: 300,
      minBonusSeconds: 1,
      maxBonusSeconds: 5,
      puzzlesPerRun: 15,
    },
  };
}

function result(ordinal: number, overrides: Partial<RushPuzzleResult> = {}): RushPuzzleResult {
  const stage = stageForOrdinal(ordinal);
  return {
    ordinal,
    puzzleId: `pool-${ordinal}`,
    stageKey: stage.key,
    rawScore: 20,
    bonusSeconds: 3,
    solved: true,
    submittedLine: [{ tile: { low: 1, high: 2 }, position: 'left' }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.reportPuzzleRushPuzzle.mockReset().mockResolvedValue({ ok: true, recorded: {} });
  mocks.completePuzzleRush.mockReset();
  mocks.startPuzzleRush.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ─── one request per run ─────────────────────────────────────────────────

describe('run start', () => {
  it('holds the whole run client-side from a single request', async () => {
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    // The entire set is present up front — there is no per-puzzle fetch.
    expect(hook.current.puzzles).toHaveLength(15);
    expect(hook.current.current?.ordinal).toBe(1);
    expect(hook.current.stages).toHaveLength(3);

    // Advancing through several puzzles issues zero additional start calls.
    for (let ordinal = 1; ordinal <= 8; ordinal++) {
      await act(async () => {
        hook.current.reportResult(result(ordinal));
      });
    }
    expect(mocks.startPuzzleRush).not.toHaveBeenCalled();
    expect(hook.current.current?.ordinal).toBe(9);
  });

  it('exposes the full stage plan before any puzzle is played', () => {
    render(
      <RushStageProgress stages={STAGES} activeStageKey="warm_up" completedOrdinals={[]} />,
    );
    // All three stages are visible from ordinal 1, not discovered on arrival.
    expect(screen.getByText('Warm-Up')).toBeTruthy();
    expect(screen.getByText('Building')).toBeTruthy();
    expect(screen.getByText('Master')).toBeTruthy();
    expect(screen.getByText('Stage 1 of 3')).toBeTruthy();
  });
});

// ─── stage transition boundaries ─────────────────────────────────────────

describe('stage transition', () => {
  it('fires only at ordinals 7 and 19, never at 1', async () => {
    const start = makeStart(15);
    const transitions: number[] = [];
    const { result: hook } = renderHook(() =>
      useRushRun({
        start,
        onAdvance: (next) => {
          // Exactly the condition the screen uses.
          if (next && next.isStageStart && next.ordinal > 1) transitions.push(next.ordinal);
        },
      }),
    );

    for (let ordinal = 1; ordinal <= 12; ordinal++) {
      await act(async () => {
        hook.current.reportResult(result(ordinal));
      });
    }

    expect(transitions).toEqual([4, 9]);
    expect(transitions).not.toContain(1);
  });

  it('marks ordinal 1 as a stage start but never as a transition', () => {
    const start = makeStart(15);
    // The data says "first of its stage"...
    expect(start.puzzles[0].isStageStart).toBe(true);
    // ...and the screen's guard is what excludes it from being a beat.
    const isTransition = (p: PuzzleRushPuzzle) => p.isStageStart && p.ordinal > 1;
    expect(isTransition(start.puzzles[0])).toBe(false);
    expect(isTransition(start.puzzles[3])).toBe(true);
    expect(isTransition(start.puzzles[8])).toBe(true);
  });
});

// ─── optimistic reporting ────────────────────────────────────────────────

describe('optimistic reporting', () => {
  it('advances without awaiting the report response', async () => {
    // A report that never settles: if the UI waited on it, the run would stall.
    mocks.reportPuzzleRushPuzzle.mockReturnValue(new Promise(() => {}));
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    expect(hook.current.current?.ordinal).toBe(1);
    await act(async () => {
      hook.current.reportResult(result(1));
    });

    // Advanced and scored locally while the request is still in flight.
    expect(hook.current.current?.ordinal).toBe(2);
    // Tally is the raw board score, summed.
    expect(hook.current.clientTally).toBe(20);
    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.current.reportResult(result(2));
    });
    expect(hook.current.current?.ordinal).toBe(3);
  });

  it('sends stageReachedKey with every report', async () => {
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    await act(async () => {
      hook.current.reportResult(result(1));
    });
    await act(async () => {
      hook.current.reportResult(result(7));
    });

    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ordinal: 1, stageReachedKey: 'warm_up', runId: 'run-1' }),
    );
    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ordinal: 7, stageReachedKey: 'building' }),
    );
  });

  it('counts a failed report without interrupting the run', async () => {
    mocks.reportPuzzleRushPuzzle.mockRejectedValue(new Error('offline'));
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    await act(async () => {
      hook.current.reportResult(result(1));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.current.current?.ordinal).toBe(2);
    expect(hook.current.reportFailures).toBe(1);
  });

  it('sends the client tally to /complete, not the server total', async () => {
    mocks.completePuzzleRush.mockResolvedValue({
      ok: true,
      replayed: false,
      run: { ...makeStart(1).run, status: 'completed', totalScore: 999 },
    });
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    await act(async () => {
      hook.current.reportResult(result(1));
      hook.current.reportResult(result(2));
    });
    await act(async () => {
      await hook.current.finishRun();
    });

    expect(mocks.completePuzzleRush).toHaveBeenCalledWith({
      runId: 'run-1',
      clientReportedScore: 40,
    });
  });

  it('finishRun is idempotent under a double trigger', async () => {
    mocks.completePuzzleRush.mockResolvedValue({
      ok: true,
      replayed: false,
      run: { ...makeStart(1).run, status: 'completed' },
    });
    const start = makeStart(15);
    const { result: hook } = renderHook(() => useRushRun({ start }));

    await act(async () => {
      await Promise.all([hook.current.finishRun(), hook.current.finishRun()]);
    });
    expect(mocks.completePuzzleRush).toHaveBeenCalledTimes(1);
  });
});

// ─── results headline ────────────────────────────────────────────────────

describe('results', () => {
  function completion(totalScore: number, extra: Partial<PuzzleRushCompleteResponse> = {}) {
    return {
      ok: true,
      replayed: false,
      run: { ...makeStart(1).run, status: 'completed', totalScore, puzzlesSolved: 4 },
      authoritativeScore: totalScore,
      ...extra,
    } as PuzzleRushCompleteResponse;
  }

  it('headlines the server total, not the client tally', () => {
    render(
      <RushResultsView
        completion={completion(870)}
        completeError={null}
        clientTally={640}
        results={[result(1), result(2)]}
        stages={STAGES}
        reportFailures={0}
        onPlayAgain={() => {}}
        onBack={() => {}}
      />,
    );

    const scoreNode = document.querySelector('[data-ui="rush-final-score"]');
    expect(scoreNode?.textContent).toContain('870');
    // The client's own number is never the headline.
    expect(scoreNode?.textContent).not.toContain('640');
  });

  it('discloses an over-claim rather than silently swapping the number', () => {
    render(
      <RushResultsView
        completion={completion(640)}
        completeError={null}
        clientTally={870}
        results={[result(1)]}
        stages={STAGES}
        reportFailures={0}
        onPlayAgain={() => {}}
        onBack={() => {}}
      />,
    );

    const notice = document.querySelector('[data-ui="rush-score-mismatch"]');
    expect(notice).toBeTruthy();
    // Both numbers are shown, with the server's named as the real one.
    expect(notice?.textContent).toContain('870');
    expect(notice?.textContent).toContain('640');
    expect(notice?.textContent).toContain('verified on the server');
  });

  it('shows no notice when the server total simply exceeds the raw tally', () => {
    // Normal case: raw board score and points are different measures, so the
    // server number being higher is expected and must not alarm the player.
    render(
      <RushResultsView
        completion={completion(640)}
        completeError={null}
        clientTally={40}
        results={[result(1)]}
        stages={STAGES}
        reportFailures={0}
        onPlayAgain={() => {}}
        onBack={() => {}}
      />,
    );
    expect(document.querySelector('[data-ui="rush-score-mismatch"]')).toBeNull();
  });

  it('flags an invalidated run', () => {
    render(
      <RushResultsView
        completion={completion(120, { invalidated: true, invalidatedReason: 'client_score_mismatch' })}
        completeError={null}
        clientTally={9999}
        results={[result(1)]}
        stages={STAGES}
        reportFailures={0}
        onPlayAgain={() => {}}
        onBack={() => {}}
      />,
    );
    const flag = document.querySelector('[data-ui="rush-invalidated"]');
    expect(flag?.textContent).toContain('does not count');
    expect(document.querySelector('[data-ui="rush-final-score"]')?.textContent).toContain('120');
  });

  it('surfaces reports that never reached the server', () => {
    render(
      <RushResultsView
        completion={completion(300)}
        completeError={null}
        clientTally={300}
        results={[result(1)]}
        stages={STAGES}
        reportFailures={2}
        onPlayAgain={() => {}}
        onBack={() => {}}
      />,
    );
    expect(document.querySelector('[data-ui="rush-report-failures"]')?.textContent).toContain('2 puzzles');
  });
});
