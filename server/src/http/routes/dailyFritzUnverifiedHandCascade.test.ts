/**
 * One unverified hand used to poison every later hand of the run.
 *
 * writeUnverifiedDailyFritzHand deliberately leaves the authority ledger
 * untouched, and resolveHandStartScoresForVerification required every prior
 * hand to be IN that ledger. So after any hand advanced without a receipt,
 * the next hand threw missing_hand_start_progress — an infrastructure code,
 * which does not never-strand, so the player saw an error at the End of Hand
 * modal, retried, advanced unverified again, and created the next gap.
 * The run failed at every remaining hand boundary.
 *
 * The attempt is already `verification_status: 'rejected'` at that point and
 * that is sticky, so refusing later hands bought no integrity at all.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import {
  findUnverifiedHand,
  resolveHandStartScoresForVerification,
  writeUnverifiedDailyFritzHand,
} from './dailyFritzVerificationGlue';

/** A ledger holding one verified hand, without needing a real transcript. */
function ledgerWithVerifiedHand(handIndex: number, you: number, fritz: number) {
  return {
    authority: {
      version: 1,
      hands: [
        {
          gameNumber: 1,
          handIndex,
          playerScoreAfter: you,
          fritzScoreAfter: fritz,
        },
      ],
      games: [],
    },
  } as Record<string, unknown>;
}

describe('unverified hand does not poison the rest of the run', () => {
  it('records the post-hand scores alongside the unverified hand', () => {
    const result = writeUnverifiedDailyFritzHand(null, {
      gameNumber: 1,
      handIndex: 0,
      verifierCode: 'incomplete_transcript',
      playerScoreAfter: 7,
      fritzScoreAfter: 3,
    });

    expect(result.verification_status).toBe('rejected');
    const found = findUnverifiedHand(result, 1, 0);
    expect(found).toMatchObject({ playerScoreAfter: 7, fritzScoreAfter: 3 });
  });

  it('keeps it OUT of the authority ledger, so nothing reads it as verified', () => {
    const result = writeUnverifiedDailyFritzHand(null, {
      gameNumber: 1,
      handIndex: 0,
      verifierCode: 'incomplete_transcript',
      playerScoreAfter: 7,
      fritzScoreAfter: 3,
    });
    expect(result.authority).toBeUndefined();
  });

  it('the NEXT hand still resolves, using the recorded scores', () => {
    // Hand 0 advanced without a receipt — the exact production shape.
    const result = writeUnverifiedDailyFritzHand(null, {
      gameNumber: 1,
      handIndex: 0,
      verifierCode: 'incomplete_transcript',
      playerScoreAfter: 7,
      fritzScoreAfter: 3,
    });

    // Before the fix this threw missing_hand_start_progress.
    const scores = resolveHandStartScoresForVerification({ result, gameNumber: 1, handIndex: 1 });
    expect(scores).toEqual({ gameNumber: 1, you: 7, fritz: 3 });
  });

  it('a verified hand is still preferred over an unverified one', () => {
    const base = ledgerWithVerifiedHand(0, 11, 4);
    const result = writeUnverifiedDailyFritzHand(base, {
      gameNumber: 1,
      handIndex: 0,
      verifierCode: 'incomplete_transcript',
      playerScoreAfter: 999,
      fritzScoreAfter: 999,
    });

    const scores = resolveHandStartScoresForVerification({ result, gameNumber: 1, handIndex: 1 });
    expect(scores).toEqual({ gameNumber: 1, you: 11, fritz: 4 });
  });

  it('mixed chain: verified hand 0, unverified hand 1, hand 2 still resolves', () => {
    const base = ledgerWithVerifiedHand(0, 5, 2);
    const result = writeUnverifiedDailyFritzHand(base, {
      gameNumber: 1,
      handIndex: 1,
      verifierCode: 'fritz_state_mismatch',
      playerScoreAfter: 9,
      fritzScoreAfter: 6,
    });

    const scores = resolveHandStartScoresForVerification({ result, gameNumber: 1, handIndex: 2 });
    expect(scores).toEqual({ gameNumber: 1, you: 9, fritz: 6 });
  });

  it('a genuinely absent hand still fails closed', () => {
    // Nothing recorded for hand 0 at all — a real gap, not a known one.
    expect(() =>
      resolveHandStartScoresForVerification({ result: {}, gameNumber: 1, handIndex: 1 }),
    ).toThrow(/hand-start scores/i);
  });

  it('an unverified record without scores still fails closed', () => {
    // Pre-existing rows carry no scores and cannot seed the chain.
    const result = {
      unverified_hands: [
        { game_number: 1, hand_index: 0, verifier_code: 'incomplete_transcript' },
      ],
    } as Record<string, unknown>;

    expect(() =>
      resolveHandStartScoresForVerification({ result, gameNumber: 1, handIndex: 1 }),
    ).toThrow(/hand-start scores/i);
  });
});
