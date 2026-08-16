import { describe, expect, it } from 'vitest';
import { buildDailyPuzzleLeaderboard } from './dailyPuzzle';
import type { DailyPuzzleAttempt, DailyPuzzleSlotResult } from '@racehorse/game-core';

// Full trace (this pass) of the submission -> leaderboard chain confirmed:
//   - server/src/http/routes/dailyPuzzle.ts:270-302 (POST /submit-slot) calls
//     validateDailyPuzzleSubmission and persists rawScore: validation.rawScore
//     and awardedPoints computed from validation.rawScore — never from the
//     client-submitted req.body.rawScore directly.
//   - server/src/dailyPuzzleSubmissionValidation.ts:204 stores the raw client
//     value only as result.clientRawScore, a side-channel diagnostic field —
//     it is never read back into rawScore/awardedPoints anywhere in that file.
//   - server/src/dailyPuzzle.ts:375-408 (buildDailyPuzzleLeaderboard, pasted
//     below in full) builds every leaderboard field from
//     attempt.puzzlesCompleted, attempt.totalScore, attempt.masterChainScore,
//     attempt.completedAt, and attempt.result.slots[].awardedPoints/perfect/
//     solved. It has ZERO reference to clientRawScore, clientResult, or any
//     other client-originated field anywhere in the function body.
// This test proves the last link directly: even when a slot result's nested
// result blob carries a forged clientRawScore wildly different from the
// honest score, buildDailyPuzzleLeaderboard's output is unaffected — because
// it never looks at that field at all.
//
// buildDailyPuzzleLeaderboard, full body, for reference (server/src/dailyPuzzle.ts:375-408):
//
// export function buildDailyPuzzleLeaderboard(
//   attempts: DailyPuzzleAttempt[],
// ): DailyPuzzleLeaderboardEntry[] {
//   const sorted = [...attempts].sort((a, b) => {
//     if (a.puzzlesCompleted !== b.puzzlesCompleted) return b.puzzlesCompleted - a.puzzlesCompleted;
//     if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
//     if (a.masterChainScore !== b.masterChainScore) return b.masterChainScore - a.masterChainScore;
//     if (a.completedAt && b.completedAt && a.completedAt !== b.completedAt) {
//       return a.completedAt.localeCompare(b.completedAt);
//     }
//     if (a.completedAt && !b.completedAt) return -1;
//     if (!a.completedAt && b.completedAt) return 1;
//     return a.id.localeCompare(b.id);
//   });
//
//   return sorted.map((attempt, index) => ({
//     rank: index + 1,
//     userId: attempt.userId,
//     username: attempt.username?.trim() || 'Player',
//     puzzlesCompleted: attempt.puzzlesCompleted,
//     totalScore: attempt.totalScore,
//     masterChainScore: attempt.masterChainScore,
//     completedAt: attempt.completedAt,
//     breakdown: DAILY_PUZZLE_SLOT_INDICES.map((slotIndex) => {
//       const slot = attempt.result.slots.find((entry) => entry.slotIndex === slotIndex);
//       return {
//         slotIndex: slotIndex as DailyPuzzleSlotIndex,
//         awardedPoints: slot?.awardedPoints ?? null,
//         perfect: Boolean(slot?.perfect),
//         solved: Boolean(slot?.solved),
//       };
//     }),
//   }));
// }

function makeSlotResult(overrides: Partial<DailyPuzzleSlotResult> = {}): DailyPuzzleSlotResult {
  return {
    id: 'slot-result-1',
    attemptId: 'attempt-1',
    puzzleId: 'puzzle-1',
    puzzleDate: '2026-05-17',
    userId: 'user-honest',
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Line',
    puzzleType: 'one_turn_high_score',
    rawScore: 2,
    awardedPoints: 10,
    bestPossibleScore: 2,
    slotMaxPoints: 150,
    solved: true,
    perfect: true,
    movesUsed: 1,
    elapsedSeconds: 8,
    completedAt: '2026-05-17T00:00:05.000Z',
    submittedLine: [{ tile: { low: 0, high: 5 }, position: 'right' }],
    result: {
      serverValidated: true,
      serverRawScore: 2,
      // The forged value: what a tampered client would try to claim. If the
      // leaderboard ever read this instead of the server-computed fields
      // above, this test would catch it — but it doesn't, per the trace.
      clientRawScore: 999999,
    },
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<DailyPuzzleAttempt> = {}): DailyPuzzleAttempt {
  return {
    id: 'attempt-honest',
    puzzleDate: '2026-05-17',
    userId: 'user-honest',
    username: 'Honest Player',
    status: 'started',
    setVersion: 1,
    currentSlotIndex: 2,
    puzzlesCompleted: 1,
    totalScore: 10, // the real, server-computed total — must survive unchanged
    masterChainScore: 0,
    completedAt: null,
    startedAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:05.000Z',
    reviewUnlocked: false,
    practiceMode: 'live',
    result: {
      slots: [makeSlotResult()],
    },
    ...overrides,
  };
}

describe('buildDailyPuzzleLeaderboard — forged clientRawScore has zero effect', () => {
  it('reflects only the server-validated awardedPoints/totalScore even when the persisted record carries a wildly forged clientRawScore', () => {
    const forgedAttempt = makeAttempt();
    const [entry] = buildDailyPuzzleLeaderboard([forgedAttempt]);

    expect(entry.totalScore).toBe(10);
    expect(entry.breakdown[0]).toMatchObject({
      slotIndex: 1,
      awardedPoints: 10,
      perfect: true,
      solved: true,
    });
    // Prove this isn't a vacuous pass: the forged value really was present in
    // the input and really is wildly different from the honest score. If the
    // leaderboard's numbers happened to equal 999999 anywhere, that would be
    // the bug this test exists to catch.
    expect(forgedAttempt.result.slots[0].result.clientRawScore).toBe(999999);
    expect(entry.totalScore).not.toBe(999999);
    expect(entry.breakdown[0].awardedPoints).not.toBe(999999);
  });

  it('ranks by the honest totalScore, not by anything a forged clientRawScore could influence', () => {
    const honestLeader = makeAttempt({
      id: 'attempt-real-leader',
      userId: 'user-real-leader',
      totalScore: 50,
      result: { slots: [makeSlotResult({ awardedPoints: 50, result: { clientRawScore: 1 } })] },
    });
    const forgedButLowerScore = makeAttempt({
      id: 'attempt-forger',
      userId: 'user-forger',
      totalScore: 10,
      result: { slots: [makeSlotResult({ awardedPoints: 10, result: { clientRawScore: 999999999 } })] },
    });

    const leaderboard = buildDailyPuzzleLeaderboard([forgedButLowerScore, honestLeader]);

    expect(leaderboard[0].userId).toBe('user-real-leader');
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].userId).toBe('user-forger');
    expect(leaderboard[1].rank).toBe(2);
  });
});
