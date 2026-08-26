/**
 * Daily volume of Daily Fritz attempts that entered unverified_hands.
 *
 * The existing legacyUnverifiedCompletions counter answers a different
 * question: how many runs finalized with no transcript authority at all. It
 * says nothing about protocol-v2 runs that DID carry authority and still had a
 * hand advance without a receipt — which is exactly the population the 2026-08
 * fritz_state_mismatch incidents came from.
 *
 * Pre-authority rows are excluded deliberately: they have no verifier receipt
 * by construction, so counting them would bury a real v2 regression under a
 * constant legacy baseline.
 */
import { describe, expect, it } from 'vitest';
import { countDailyFritzUnverifiedHandAttempts } from './dailyFritzHealthSummary';

function row(result: Record<string, unknown> | null) {
  return { result };
}

describe('countDailyFritzUnverifiedHandAttempts', () => {
  it('counts protocol-v2 attempts carrying at least one unverified hand', () => {
    expect(countDailyFritzUnverifiedHandAttempts([
      row({
        verification_protocol_version: 2,
        verification_status: 'rejected',
        unverified_hands: [{ game_number: 1, hand_index: 3, verifier_code: 'fritz_state_mismatch' }],
      }),
      row({
        verification_protocol_version: 2,
        verification_status: 'rejected',
        unverified_hands: [
          { game_number: 1, hand_index: 2, verifier_code: 'fritz_state_mismatch' },
          { game_number: 2, hand_index: 5, verifier_code: 'score_mismatch' },
        ],
      }),
    ])).toBe(2);
  });

  it('counts an attempt once however many hands it lost', () => {
    expect(countDailyFritzUnverifiedHandAttempts([
      row({
        verification_protocol_version: 2,
        unverified_hands: [
          { hand_index: 1, verifier_code: 'fritz_state_mismatch' },
          { hand_index: 2, verifier_code: 'fritz_state_mismatch' },
          { hand_index: 3, verifier_code: 'fritz_state_mismatch' },
        ],
      }),
    ])).toBe(1);
  });

  it('excludes legacy pre-authority rows', () => {
    expect(countDailyFritzUnverifiedHandAttempts([
      // No protocol pin at all — pre-authority.
      row({ verification_status: 'legacy_unverified' }),
      // Protocol 1 predates the unverified_hands ledger.
      row({ verification_protocol_version: 1, unverified_hands: [{ hand_index: 0 }] }),
      row(null),
    ])).toBe(0);
  });

  it('excludes clean protocol-v2 attempts', () => {
    expect(countDailyFritzUnverifiedHandAttempts([
      row({ verification_protocol_version: 2, verification_status: 'verified' }),
      // Present but empty: the run never lost a hand.
      row({ verification_protocol_version: 2, verification_status: 'verified', unverified_hands: [] }),
      // Malformed ledger must not be read as a failure.
      row({ verification_protocol_version: 2, unverified_hands: 'not-an-array' }),
    ])).toBe(0);
  });
});
