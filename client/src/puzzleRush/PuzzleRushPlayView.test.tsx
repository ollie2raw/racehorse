// @vitest-environment jsdom
/**
 * Direct coverage of the Rush board interaction.
 *
 * Deliberately *not* mocking the solving mechanics: this renders the real
 * `PuzzleRushPlayView` over a real board/hand fixture and drives it the way a
 * player does — click a hand tile, click a placement zone — so the engine, the
 * terminal rules, and Rush's own wiring around them are all exercised.
 *
 * Only the network (`./api`) is mocked. The daily ladder's tests cover the same
 * components in a different arrangement; they cannot cover this one, because
 * Rush layers optimistic reporting, a clock, and stage advance on top.
 *
 * The fixture is one board with two lines through it:
 *   board 5|5, hand [0-5, 3-5]
 *     optimal:    0-5 @ left (2 pts, turn continues) -> 3-5 @ right (terminal) = 2
 *     suboptimal: 3-5 @ left (0 pts, not a double)   -> terminal immediately   = 0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PuzzleRushPlayView } from './PuzzleRushPlayView';
import { useRushRun } from './useRushRun';
import { estimateBonusSeconds } from './rushScoring';
import type {
  PuzzleRushPuzzle,
  PuzzleRushStage,
  PuzzleRushStartResponse,
  RushPuzzleResult,
} from './types';
import type { BoardState, Tile } from '../types';

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

// ─── real fixtures ───────────────────────────────────────────────────────

const t = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });

function spinnerBoard(left: number, right: number): BoardState {
  return {
    mainLine: [{ tile: t(left, right), orientation: 'horizontal-normal' }],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  } as BoardState;
}

const STAGES: PuzzleRushStage[] = [
  { key: 'warm_up', label: 'Warm-Up', fromOrdinal: 1, toOrdinal: 3, maxPointsPerPuzzle: 100, puzzleCount: 2 },
  { key: 'building', label: 'Building', fromOrdinal: 4, toOrdinal: 8, maxPointsPerPuzzle: 250, puzzleCount: 0 },
  { key: 'master', label: 'Master', fromOrdinal: 9, toOrdinal: 15, maxPointsPerPuzzle: 500, puzzleCount: 0 },
];

function fixturePuzzle(ordinal: number): PuzzleRushPuzzle {
  return {
    ordinal,
    puzzleId: `pool-${ordinal}`,
    startingBoard: spinnerBoard(5, 5),
    startingHand: [t(5, 0), t(5, 3)],
    maxMoves: 1,
    puzzleType: 'one_turn_high_score',
    tier: 'quick_line',
    dealSize: 14,
    targetScore: 999,
    maxPoints: 100,
    stageKey: 'warm_up',
    stageLabel: 'Warm-Up',
    isStageStart: ordinal === 1,
  };
}

// ─── DOM drivers (the same affordances a player uses) ────────────────────

/**
 * Scoped to the hand dock on purpose: a played tile is re-rendered on the
 * board as another `DominoTile` with the same aria-label, so an unscoped query
 * would find the tile you just played and report it as still in hand.
 */
function handTiles(): HTMLElement[] {
  const dock = document.querySelector('.hand-container');
  if (!dock) return [];
  return Array.from(dock.querySelectorAll('button[aria-label^="Domino "]')) as HTMLElement[];
}

function findHandTile(low: number, high: number): HTMLElement | null {
  const label = `Domino ${Math.min(low, high)}-${Math.max(low, high)}`;
  return handTiles().find((node) => (node.getAttribute('aria-label') ?? '').startsWith(label)) ?? null;
}

function handTile(low: number, high: number): HTMLElement {
  const node = findHandTile(low, high);
  if (!node) throw new Error(`hand tile ${low}-${high} not in hand`);
  return node;
}

function placementZones(position: 'left' | 'right'): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(`button.placement-zone[data-position="${position}"]`),
  ) as HTMLElement[];
}

function playTile(low: number, high: number, position: 'left' | 'right') {
  fireEvent.click(handTile(low, high));
  const zones = placementZones(position);
  if (zones.length === 0) throw new Error(`no ${position} placement zone for ${low}-${high}`);
  fireEvent.click(zones[0]);
}

function renderView(overrides: Partial<Parameters<typeof PuzzleRushPlayView>[0]> = {}) {
  const onPuzzleFinished = vi.fn();
  const utils = render(
    <PuzzleRushPlayView
      puzzle={fixturePuzzle(1)}
      stages={STAGES}
      completedOrdinals={[]}
      secondsLeft={90}
      clientTally={0}
      lastBonusSeconds={null}
      totalPuzzles={2}
      onPuzzleFinished={onPuzzleFinished}
      onQuit={() => {}}
      {...overrides}
    />,
  );
  return { ...utils, onPuzzleFinished };
}

beforeEach(() => {
  mocks.reportPuzzleRushPuzzle.mockReset().mockResolvedValue({ ok: true, recorded: {} });
  mocks.completePuzzleRush.mockReset().mockResolvedValue({
    ok: true,
    replayed: false,
    run: { id: 'run-1', status: 'completed', totalScore: 140, puzzlesSolved: 2 },
  });
  mocks.startPuzzleRush.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ─── board interaction ───────────────────────────────────────────────────

describe('board interaction', () => {
  it('renders the real hand and offers placement only for legal moves', () => {
    renderView();
    // Both hand tiles present.
    expect(handTile(0, 5)).toBeTruthy();
    expect(handTile(3, 5)).toBeTruthy();
    // No tile selected yet, so no placement zones are offered.
    expect(placementZones('left')).toHaveLength(0);
    expect(placementZones('right')).toHaveLength(0);
  });

  it('selecting a tile reveals its placements, and the move applies to the board', () => {
    renderView();

    fireEvent.click(handTile(0, 5));
    // Selection alone opens the placement affordances.
    expect(placementZones('left').length + placementZones('right').length).toBeGreaterThan(0);

    fireEvent.click(placementZones('left')[0]);

    // The tile left the *hand* — the move really applied to the runtime state,
    // it did not just fire a callback. (It is now drawn on the board instead.)
    expect(findHandTile(0, 5)).toBeNull();
    expect(handTile(3, 5)).toBeTruthy();
    expect(handTiles()).toHaveLength(1);
  });

  it('a placement click with no tile selected plays nothing', () => {
    const { onPuzzleFinished } = renderView();

    // Select, play, and land in the continuing (non-terminal) state — the
    // selection is consumed, so the zones on offer belong to no tile.
    playTile(0, 5, 'left');
    expect(handTiles()).toHaveLength(1);
    expect(onPuzzleFinished).not.toHaveBeenCalled();

    // Clicking a zone now, with nothing selected, must be inert.
    placementZones('left').forEach((zone) => fireEvent.click(zone));
    placementZones('right').forEach((zone) => fireEvent.click(zone));
    expect(handTiles()).toHaveLength(1);
    expect(onPuzzleFinished).not.toHaveBeenCalled();
  });
});

// ─── terminal detection ──────────────────────────────────────────────────

describe('terminal outcomes', () => {
  it('detects a full multi-move line and reports the accumulated score', () => {
    const { onPuzzleFinished } = renderView();

    // 0-5 @ left scores 2 and keeps the turn: not terminal yet.
    playTile(0, 5, 'left');
    expect(onPuzzleFinished).not.toHaveBeenCalled();

    // 3-5 @ right empties the hand: terminal, total 2.
    playTile(3, 5, 'right');
    expect(onPuzzleFinished).toHaveBeenCalledTimes(1);
    expect(onPuzzleFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        ordinal: 1,
        puzzleId: 'pool-1',
        stageKey: 'warm_up',
        rawScore: 2,
        solved: true,
      }),
    );
  });

  it('detects a legal-but-suboptimal line and reports zero', () => {
    const { onPuzzleFinished } = renderView();

    // 3-5 scores nothing and is not a double: terminal on the first move.
    playTile(3, 5, 'left');

    expect(onPuzzleFinished).toHaveBeenCalledTimes(1);
    const result = onPuzzleFinished.mock.calls[0][0] as RushPuzzleResult;
    expect(result.rawScore).toBe(0);
    // Same puzzle, same legal mechanics — just a worse line than the 2-pointer.
    expect(result.ordinal).toBe(1);
  });

  it('forwards the played line verbatim for the server replay', () => {
    const { onPuzzleFinished } = renderView();

    playTile(0, 5, 'left');
    playTile(3, 5, 'right');

    const result = onPuzzleFinished.mock.calls[0][0] as RushPuzzleResult;
    expect(result.submittedLine).toHaveLength(2);
    expect(result.submittedLine[0]).toMatchObject({ position: 'left', pointsAwarded: 2 });
    expect(result.submittedLine[1]).toMatchObject({ position: 'right', pointsAwarded: 0 });
    // The tiles are the ones actually clicked, in order.
    expect(result.submittedLine[0].tile).toMatchObject({ low: 0, high: 5 });
    expect(result.submittedLine[1].tile).toMatchObject({ low: 3, high: 5 });
  });

  it('finishes a puzzle exactly once, even under a repeated click', () => {
    const { onPuzzleFinished } = renderView();
    playTile(3, 5, 'left');
    expect(onPuzzleFinished).toHaveBeenCalledTimes(1);
    // The board is done; any further placement clicks are inert.
    placementZones('left').forEach((zone) => fireEvent.click(zone));
    placementZones('right').forEach((zone) => fireEvent.click(zone));
    expect(onPuzzleFinished).toHaveBeenCalledTimes(1);
  });
});

// ─── advance through a real run ──────────────────────────────────────────

/** Wires the real play view to the real run hook — only the network is faked. */
function RunHarness({ start }: { start: PuzzleRushStartResponse }) {
  const run = useRushRun({ start });

  if (!run.current) {
    return <div data-ui="harness-run-over">run-over</div>;
  }

  return (
    <PuzzleRushPlayView
      puzzle={run.current}
      stages={run.stages}
      completedOrdinals={run.completedOrdinals}
      secondsLeft={90}
      clientTally={run.clientTally}
      lastBonusSeconds={null}
      totalPuzzles={start.puzzles.length}
      onPuzzleFinished={(result) => {
        run.reportResult({
          ...result,
          bonusSeconds: estimateBonusSeconds({
            rawScore: result.rawScore,
            config: start.config,
          }),
        });
      }}
      onQuit={() => {}}
    />
  );
}

function makeStart(count: number): PuzzleRushStartResponse {
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
    puzzles: Array.from({ length: count }, (_, i) => fixturePuzzle(i + 1)),
    selection: { requested: count, served: count, shortfall: false, fallbackCount: 0 },
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

describe('solving advances the run', () => {
  it('a solved puzzle advances to the next board', async () => {
    render(<RunHarness start={makeStart(2)} />);

    expect(screen.getByText('Puzzle 1 / 2')).toBeTruthy();

    playTile(0, 5, 'left');
    playTile(3, 5, 'right');
    await act(async () => { await Promise.resolve(); });

    // Next puzzle is mounted with a fresh board and full hand.
    expect(screen.getByText('Puzzle 2 / 2')).toBeTruthy();
    expect(handTile(0, 5)).toBeTruthy();
    expect(handTile(3, 5)).toBeTruthy();
    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenCalledTimes(1);
  });

  it('a zero-score puzzle still advances', async () => {
    render(<RunHarness start={makeStart(2)} />);

    playTile(3, 5, 'left');
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Puzzle 2 / 2')).toBeTruthy();
    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenCalledWith(
      expect.objectContaining({ ordinal: 1, clientRawScore: 0 }),
    );
  });

  it('the last puzzle ends the run instead of advancing to nothing', async () => {
    render(<RunHarness start={makeStart(1)} />);

    playTile(0, 5, 'left');
    playTile(3, 5, 'right');
    await act(async () => { await Promise.resolve(); });

    expect(document.querySelector('[data-ui="harness-run-over"]')).toBeTruthy();
    expect(mocks.reportPuzzleRushPuzzle).toHaveBeenCalledTimes(1);
  });

  it('the running tally tracks raw board score, not a points estimate', async () => {
    render(<RunHarness start={makeStart(3)} />);

    // Puzzle 1: the 2-point line.
    playTile(0, 5, 'left');
    playTile(3, 5, 'right');
    await act(async () => { await Promise.resolve(); });
    // The 2-point line adds exactly its raw board score. (An earlier version
    // divided rawScore by maxPoints and rounded this to 0.)
    const afterGood = Number(document.querySelector('[data-ui="rush-tally"]')?.textContent ?? '0');
    expect(afterGood).toBe(2);

    // Puzzle 2: the zero line adds nothing.
    playTile(3, 5, 'left');
    await act(async () => { await Promise.resolve(); });
    const afterBad = Number(document.querySelector('[data-ui="rush-tally"]')?.textContent ?? '0');
    expect(afterBad).toBe(afterGood);
  });
});
