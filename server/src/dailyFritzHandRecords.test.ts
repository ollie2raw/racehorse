import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzTranscript } from '@racehorse/game-core';
import { verifyDailyFritzHand } from './dailyFritzVerifier';
import {
  dailyFritzHandRecordsEnabled,
  prepareDailyFritzHandRecordRow,
  resetHandRecordWarningThrottleForTests,
  saveVerifiedDailyFritzHandRecord,
  type DailyFritzHandRecordRow,
} from './dailyFritzHandRecords';
import { ATTEMPT_ID, CHALLENGE_ID, USER_ID, finishedHands, inputFor, transcriptOf } from './dailyFritzHand.testkit';

const hands = finishedHands();
const verifiedOf = (i = 0) => {
  const { handIndex, initialState, actions } = hands[i]!;
  return verifyDailyFritzHand(inputFor(handIndex, initialState, transcriptOf(handIndex, actions)));
};

describe('dailyFritzHandRecordsEnabled', () => {
  it('is on only for exactly "true"', () => {
    expect(dailyFritzHandRecordsEnabled('true')).toBe(true);
    for (const off of [undefined, '', 'TRUE', '1', 'yes', 'false', ' true']) expect(dailyFritzHandRecordsEnabled(off)).toBe(false);
  });
});

describe('prepareDailyFritzHandRecordRow', () => {
  it('builds a row for every verified hand that is exactly the verified transcript and its receipt', () => {
    expect(hands.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < hands.length; i += 1) {
      const verified = verifiedOf(i);
      const prepared = prepareDailyFritzHandRecordRow(verified);
      if (!prepared.ok) throw new Error(`hand ${i}: ${prepared.reason}`);
      const { row } = prepared;
      expect(row).toMatchObject({
        user_id: USER_ID,
        attempt_id: ATTEMPT_ID,
        challenge_id: CHALLENGE_ID,
        game_number: 1,
        hand_index: hands[i]!.handIndex,
        transcript_digest: verified.result.transcriptDigest,
        verification_version: verified.result.verificationVersion,
        fritz_policy_version: verified.result.fritzPolicyVersion,
        action_count: verified.transcript.actions.length,
      });
      expect(row.transcript).toBe(verified.transcript);
      expect(row.transcript_digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('refuses a transcript that is not the one the receipt digests', () => {
    const verified = verifiedOf();
    const tampered: DailyFritzTranscript = { ...verified.transcript, actions: verified.transcript.actions.slice(0, -1) };
    expect(prepareDailyFritzHandRecordRow({ transcript: tampered, result: verified.result })).toEqual({ ok: false, reason: 'digest_mismatch' });
  });

  it('refuses ids that are not UUIDs (the table keys on them), a receipt for another hand, and an oversized transcript', () => {
    const verified = verifiedOf();
    expect(prepareDailyFritzHandRecordRow({ transcript: verified.transcript, result: { ...verified.result, userId: 'guest-1' } })).toEqual({ ok: false, reason: 'user_not_uuid' });
    expect(prepareDailyFritzHandRecordRow({ transcript: verified.transcript, result: { ...verified.result, attemptId: 'attempt-1' } })).toEqual({ ok: false, reason: 'attempt_not_uuid' });
    expect(prepareDailyFritzHandRecordRow({ transcript: verified.transcript, result: { ...verified.result, handIndex: verified.result.handIndex + 1 } }))
      .toEqual({ ok: false, reason: 'transcript_result_mismatch' });
    expect(prepareDailyFritzHandRecordRow({ transcript: verified.transcript, result: { ...verified.result, transcriptDigest: 'nope' } })).toEqual({ ok: false, reason: 'digest_malformed' });
  });
});

describe('saveVerifiedDailyFritzHandRecord', () => {
  beforeEach(() => resetHandRecordWarningThrottleForTests());

  it('does nothing while the flag is off', () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    saveVerifiedDailyFritzHandRecord(verifiedOf(), { enabled: false, insert });
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts exactly the prepared row once while the flag is on', () => {
    const verified = verifiedOf();
    const insert = vi.fn().mockResolvedValue(undefined);
    saveVerifiedDailyFritzHandRecord(verified, { enabled: true, insert });
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0]![0] as DailyFritzHandRecordRow;
    expect(row.transcript_digest).toBe(verified.result.transcriptDigest);
    expect(row.transcript).toBe(verified.transcript);
  });

  it('never throws and never rejects: a failing insert, a synchronously throwing insert, a refused row and garbage are all absorbed', async () => {
    const verified = verifiedOf();
    expect(() => saveVerifiedDailyFritzHandRecord(verified, { enabled: true, insert: () => Promise.reject(new Error('relation does not exist')) })).not.toThrow();
    expect(() => saveVerifiedDailyFritzHandRecord(verified, { enabled: true, insert: () => { throw new Error('boom'); } })).not.toThrow();
    expect(() => saveVerifiedDailyFritzHandRecord({ transcript: verified.transcript, result: { ...verified.result, userId: 'guest' } }, { enabled: true, insert: vi.fn() })).not.toThrow();
    expect(() => saveVerifiedDailyFritzHandRecord(undefined as never, { enabled: true, insert: vi.fn() })).not.toThrow();
    expect(() => saveVerifiedDailyFritzHandRecord(null as never, { enabled: true })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the rejected insert's handler must not become an unhandled rejection
  });

  it('does not insert a refused row', () => {
    const verified = verifiedOf();
    const insert = vi.fn().mockResolvedValue(undefined);
    saveVerifiedDailyFritzHandRecord({ transcript: verified.transcript, result: { ...verified.result, userId: 'guest' } }, { enabled: true, insert });
    expect(insert).not.toHaveBeenCalled();
  });
});
