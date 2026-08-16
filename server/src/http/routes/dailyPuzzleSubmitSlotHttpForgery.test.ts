import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import type { BoardState } from '@racehorse/game-core';
import {
  calculateDailyPuzzleAwardedPoints,
  type DailyPuzzleAttemptRow,
  type DailyPuzzleSlotResultRow,
  type DailyPuzzleSlotRow,
} from '../../dailyPuzzle';

// This test closes the residual gap in the prior pillar-4 pass:
// dailyPuzzleLeaderboardForgery.test.ts proves buildDailyPuzzleLeaderboard
// ignores a forged clientRawScore when handed a constructed
// DailyPuzzleAttempt object directly — it never exercises the real HTTP
// route, real validateDailyPuzzleSubmission, or the real store/persistence
// call sites. This test goes one layer deeper: it POSTs to the real
// /api/daily-puzzle/submit-slot handler (registerDailyPuzzleRoutes, real,
// unmocked) with a forged rawScore wildly different from the correct answer
// for a real puzzle slot, lets that request run through the real
// validateDailyPuzzleSubmission and the REAL, unmocked
// server/src/http/stores/dailyPuzzleStore.ts persistence functions, then
// calls the real buildDailyPuzzleLeaderboardForDate (also real, unmocked —
// including its internal call to listDailyPuzzleAttemptsForDate, which is a
// same-module call and therefore cannot be intercepted by mocking the store
// module's exports) for that date, and asserts the resulting entry reflects
// only the server-computed score.
//
// Only the true I/O boundary is faked: supabaseFetch (server/src/supabaseUtils.ts)
// is replaced with an in-memory simulation of the two real tables
// (daily_puzzle_attempts, daily_puzzle_slot_results) plus the read-only
// daily_puzzles table, keyed on the exact REST query shapes the store module
// actually issues. Every function between the HTTP route and this boundary —
// route handler, validateDailyPuzzleSubmission, every dailyPuzzleStore.ts
// function, buildDailyPuzzleLeaderboardForDate, buildDailyPuzzleLeaderboard —
// runs for real. This mirrors the boundary-only mocking pillar 1's Glicko
// forgery tests used (supabaseFetch faked, everything above it real).

const { authUserMock } = vi.hoisted(() => ({ authUserMock: vi.fn() }));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
}));

const RUN_DATE = '2026-08-16';
const USER_ID = 'user-forger';
const ATTEMPT_ID = 'attempt-forger-1';
const PUZZLE_ID = 'puzzle-slot-1';
const FORGED_RAW_SCORE = 999999;
const HONEST_RAW_SCORE = 2; // engine score for the legal 0-5-on-right line
const BEST_POSSIBLE_SCORE = 10; // higher than the submitted line so awardedPoints is not capped at slotMax
const SLOT_MAX_POINTS = 150;
const HONEST_AWARDED_POINTS = calculateDailyPuzzleAwardedPoints(
  HONEST_RAW_SCORE,
  BEST_POSSIBLE_SCORE,
  SLOT_MAX_POINTS,
);
const FORGED_AWARDED_POINTS = calculateDailyPuzzleAwardedPoints(
  FORGED_RAW_SCORE,
  BEST_POSSIBLE_SCORE,
  SLOT_MAX_POINTS,
);

const startingBoard: BoardState = {
  mainLine: [{ tile: { low: 5, high: 5 }, orientation: 'vertical-normal' }],
  leftEnd: 5,
  rightEnd: 5,
  leftEndIsDouble: true,
  rightEndIsDouble: true,
  hubDoubles: [
    {
      hubId: 0,
      laneType: 'mainline',
      laneRef: 'mainline',
      tileIndex: 0,
      mainlineIndex: 0,
      hubValue: 5,
      isCrossed: false,
      leftSideFilled: false,
      rightSideFilled: false,
      branches: [],
    },
  ],
};

function makePuzzleRow(overrides: Partial<DailyPuzzleSlotRow> = {}): DailyPuzzleSlotRow {
  return {
    id: PUZZLE_ID,
    puzzle_date: RUN_DATE,
    title: null,
    starting_board: startingBoard,
    starting_hand: [
      { low: 0, high: 5 },
      { low: 1, high: 1 },
    ],
    max_moves: 1,
    target_score: BEST_POSSIBLE_SCORE,
    puzzle_type: 'one_turn_high_score',
    deal_size: 14,
    slot_index: 1,
    slot_title: 'Quick Line',
    tier: 'quick_line',
    slot_max_points: SLOT_MAX_POINTS,
    objective_type: 'one_turn_high_score',
    objective_payload: { best_possible_score: BEST_POSSIBLE_SCORE },
    set_version: 1,
    published: true,
    ...overrides,
  };
}

// The full 5-slot ladder must exist so findLadderSlotsForAttemptSet sees a
// complete, correctly-ordered set for this attempt's setVersion. Only slot 1
// is ever submitted to in this test.
const puzzleTable: DailyPuzzleSlotRow[] = [
  makePuzzleRow({ id: PUZZLE_ID, slot_index: 1 }),
  makePuzzleRow({ id: 'puzzle-slot-2', slot_index: 2, slot_title: 'Slot 2' }),
  makePuzzleRow({ id: 'puzzle-slot-3', slot_index: 3, slot_title: 'Slot 3' }),
  makePuzzleRow({ id: 'puzzle-slot-4', slot_index: 4, slot_title: 'Slot 4' }),
  makePuzzleRow({ id: 'puzzle-slot-5', slot_index: 5, slot_title: 'Slot 5' }),
];

function makeAttemptRow(overrides: Partial<DailyPuzzleAttemptRow> = {}): DailyPuzzleAttemptRow {
  return {
    id: ATTEMPT_ID,
    puzzle_date: RUN_DATE,
    user_id: USER_ID,
    username: 'Forger Player',
    status: 'started',
    set_version: 1,
    current_slot_index: 1,
    puzzles_completed: 0,
    total_score: 0,
    master_chain_score: 0,
    completed_at: null,
    started_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
    review_unlocked: false,
    result: { slots: [] },
    ...overrides,
  };
}

const attemptsTable = new Map<string, DailyPuzzleAttemptRow>();
const slotResultsTable = new Map<string, DailyPuzzleSlotResultRow>();
let slotResultSeq = 0;

function resetTables() {
  attemptsTable.clear();
  attemptsTable.set(ATTEMPT_ID, makeAttemptRow());
  slotResultsTable.clear();
  slotResultSeq = 0;
}

function matchEqFilters(url: URL, row: Record<string, unknown>): boolean {
  for (const [key, value] of url.searchParams.entries()) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    if (value.startsWith('eq.')) {
      const expected = decodeURIComponent(value.slice(3));
      if (String(row[key] ?? '') !== expected) return false;
    } else if (value.startsWith('in.(')) {
      const idClause = value.slice(4, -1);
      const allowed = decodeURIComponent(idClause).split(',').map((entry) => entry.replace(/^"|"$/g, ''));
      if (!allowed.includes(String(row[key] ?? ''))) return false;
    }
  }
  return true;
}

const { supabaseFetchMock } = vi.hoisted(() => ({ supabaseFetchMock: vi.fn() }));

supabaseFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
  const url = new URL(`http://fake${path}`);
  const table = url.pathname.replace('/rest/v1/', '');
  const method = init?.method ?? 'GET';

  if (table === 'daily_puzzles' && method === 'GET') {
    return puzzleTable.filter((row) => matchEqFilters(url, row as unknown as Record<string, unknown>));
  }

  if (table === 'daily_puzzle_attempts') {
    if (method === 'GET') {
      return [...attemptsTable.values()].filter((row) =>
        matchEqFilters(url, row as unknown as Record<string, unknown>),
      );
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const results: DailyPuzzleAttemptRow[] = [];
      for (const entry of body) {
        const id = String(entry.id ?? ATTEMPT_ID);
        const merged: DailyPuzzleAttemptRow = { ...attemptsTable.get(id), ...entry } as DailyPuzzleAttemptRow;
        attemptsTable.set(id, merged);
        results.push(merged);
      }
      return results;
    }
  }

  if (table === 'daily_puzzle_slot_results') {
    if (method === 'GET') {
      return [...slotResultsTable.values()].filter((row) =>
        matchEqFilters(url, row as unknown as Record<string, unknown>),
      );
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const results: DailyPuzzleSlotResultRow[] = [];
      for (const entry of body) {
        slotResultSeq += 1;
        const row = { id: `slot-result-${slotResultSeq}`, ...entry } as DailyPuzzleSlotResultRow;
        slotResultsTable.set(row.id, row);
        results.push(row);
      }
      return results;
    }
  }

  throw new Error(`Unhandled fake supabaseFetch call: ${method} ${path}`);
});

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: supabaseFetchMock,
  constantTimeEqualSecret: (a: string, b: string) => a === b,
}));

import { registerDailyPuzzleRoutes } from './dailyPuzzle';
import { buildDailyPuzzleLeaderboardForDate } from '../stores/dailyPuzzleStore';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: Handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
  registerDailyPuzzleRoutes(app as unknown as Application);

  return async function request(
    method: 'GET' | 'POST',
    path: string,
    input: { body?: Record<string, unknown> } = {},
  ) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      json(value: unknown) {
        body = value;
        return res;
      },
      setHeader() {
        return res;
      },
      once() {
        return res;
      },
    };
    await handler(
      {
        headers: {},
        params: {},
        query: {},
        body: input.body ?? {},
        method,
        path,
        get() {
          return undefined;
        },
      },
      res,
    );
    return { status, body: body as any };
  };
}

authUserMock.mockImplementation(async () => USER_ID);

describe('POST /api/daily-puzzle/submit-slot — forged rawScore is honest end-to-end through the real HTTP path', () => {
  beforeEach(() => {
    resetTables();
  });

  it('persists and leaderboards only the server-computed score, never a forged client rawScore, when going through the real route + real validation + real store + real leaderboard build', async () => {
    // If the route trusted clientRawScore for awardedPoints, the cap would
    // award slotMax (150) instead of the honest 30. That divergence is what
    // makes this test fail under a forged-score-acceptance bug.
    expect(HONEST_AWARDED_POINTS).toBe(30);
    expect(FORGED_AWARDED_POINTS).toBe(SLOT_MAX_POINTS);
    expect(HONEST_AWARDED_POINTS).not.toBe(FORGED_AWARDED_POINTS);

    const request = makeHarness();

    const response = await request('POST', '/api/daily-puzzle/submit-slot', {
      body: {
        attemptId: ATTEMPT_ID,
        puzzleDate: RUN_DATE,
        puzzleId: PUZZLE_ID,
        slotIndex: 1,
        rawScore: FORGED_RAW_SCORE,
        movesUsed: 1,
        elapsedSeconds: 8,
        submittedLine: [{ tile: { low: 0, high: 5 }, position: 'right' }],
        clientResult: { clientRawScore: FORGED_RAW_SCORE },
      },
    });

    // 1. The route's own response, having gone through the real handler and
    // real validateDailyPuzzleSubmission, must reflect the honest
    // server-computed score, not the forged claim.
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.slotResult.rawScore).toBe(HONEST_RAW_SCORE);
    expect(response.body.slotResult.rawScore).not.toBe(FORGED_RAW_SCORE);
    expect(response.body.slotResult.awardedPoints).toBe(HONEST_AWARDED_POINTS);
    expect(response.body.slotResult.awardedPoints).not.toBe(FORGED_AWARDED_POINTS);
    expect(response.body.attempt.totalScore).toBe(HONEST_AWARDED_POINTS);
    expect(response.body.attempt.totalScore).not.toBe(FORGED_AWARDED_POINTS);

    // Prove this isn't a vacuous pass: the forged value really was sent,
    // really is wildly different from the honest score, and really did reach
    // real persistence as a side-channel diagnostic field (proving the
    // request wasn't silently stripped before validation ran) — while the
    // authoritative raw_score column that was actually written is honest.
    const persistedSlotRow = [...slotResultsTable.values()].find((row) => row.attempt_id === ATTEMPT_ID);
    expect(persistedSlotRow).toBeDefined();
    expect(persistedSlotRow!.result?.clientRawScore).toBe(FORGED_RAW_SCORE);
    expect(persistedSlotRow!.raw_score).toBe(HONEST_RAW_SCORE);
    expect(persistedSlotRow!.awarded_points).toBe(HONEST_AWARDED_POINTS);

    // 2. Now call the REAL leaderboard-building path for this date — real
    // buildDailyPuzzleLeaderboardForDate, real listDailyPuzzleAttemptsForDate,
    // real buildDailyPuzzleLeaderboard, reading from the SAME fake Supabase
    // tables the route just wrote to — and assert the resulting entry
    // reflects only the honest, server-computed score.
    const leaderboard = await buildDailyPuzzleLeaderboardForDate(RUN_DATE);
    const entry = leaderboard.find((row) => row.userId === USER_ID);

    expect(entry).toBeDefined();
    expect(entry!.totalScore).toBe(HONEST_AWARDED_POINTS);
    expect(entry!.totalScore).not.toBe(FORGED_AWARDED_POINTS);
    expect(entry!.breakdown[0]).toMatchObject({
      slotIndex: 1,
      awardedPoints: HONEST_AWARDED_POINTS,
      perfect: false,
      solved: true,
    });
    expect(entry!.breakdown[0].awardedPoints).not.toBe(FORGED_AWARDED_POINTS);

    // The leaderboard's awardedPoints must match exactly what the real route
    // computed and persisted for this slot — proving the leaderboard path is
    // reading genuine, server-derived state via real store code, not a
    // test-authored shortcut.
    expect(entry!.breakdown[0].awardedPoints).toBe(response.body.slotResult.awardedPoints);
    expect(entry!.totalScore).toBe(response.body.attempt.totalScore);
  });
});
