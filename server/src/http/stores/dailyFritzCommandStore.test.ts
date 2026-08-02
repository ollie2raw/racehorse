import { describe, expect, it, vi } from 'vitest';
import {
  commitDailyFritzAttemptCommand,
  digestDailyFritzCommand,
  startDailyFritzAttemptCommand,
  type DailyFritzCommandStoreDeps,
} from './dailyFritzCommandStore';

describe('Daily Fritz transactional command store', () => {
  it('hashes semantic command payloads canonically', () => {
    expect(digestDailyFritzCommand({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(digestDailyFritzCommand({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('starts with a durable operation identity and server-derived user identity', async () => {
    const fetch = vi.fn(async () => [{
      outcome: 'committed', error_code: null, replayed: false,
      committed_revision: 1, response: { attempt_id: 'attempt-1', revision: 1 },
    }]) as DailyFritzCommandStoreDeps['fetch'];
    const result = await startDailyFritzAttemptCommand({
      userId: 'user-1', challengeId: 'daily-fritz:2026-08-01:r2:s1',
      operationId: 'operation-1', authorityResult: { verification_status: 'in_progress' },
    }, { fetch });

    expect(result).toMatchObject({ outcome: 'committed', committedRevision: 1 });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      p_user_id: 'user-1', p_operation_id: 'operation-1',
      p_challenge_id: 'daily-fritz:2026-08-01:r2:s1',
    });
    expect(body.p_request_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends expected revision, normalized receipt, and outbox in one RPC', async () => {
    const fetch = vi.fn(async () => [{
      outcome: 'committed', error_code: null, replayed: false,
      committed_revision: 8, response: { attempt_id: 'attempt-1', revision: 8 },
    }]) as DailyFritzCommandStoreDeps['fetch'];
    const receipt = {
      gameNumber: 1, handIndex: 2, transcriptDigest: 'a'.repeat(64),
      actionCount: 14, playerScoreAfter: 20, fritzScoreAfter: 15,
      winner: 'player', verificationVersion: 2,
    };
    await commitDailyFritzAttemptCommand({
      userId: 'user-1', attemptId: 'attempt-1', operationId: 'operation-2',
      commandType: 'accept_verified_hand', expectedRevision: 7,
      next: {
        status: 'started', currentGameNumber: 1, currentHandIndex: 3,
        result: { verification_status: 'in_progress' },
      },
      handReceipt: receipt,
      outbox: { eventType: 'hand_verified', payload: { gameNumber: 1, handIndex: 2 } },
    }, { fetch });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      p_expected_revision: 7,
      p_new_current_hand_index: 3,
      p_hand_receipt: receipt,
      p_outbox_event_type: 'hand_verified',
    });
    expect(body.p_request_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves durable replay and stale-revision outcomes', async () => {
    const fetch = vi.fn(async () => [{
      outcome: 'rejected', error_code: 'stale_revision', replayed: true,
      committed_revision: 9, response: { attempt_id: 'attempt-1', revision: 9 },
    }]) as DailyFritzCommandStoreDeps['fetch'];
    const result = await commitDailyFritzAttemptCommand({
      userId: 'user-1', attemptId: 'attempt-1', operationId: 'operation-stale',
      commandType: 'abandon_attempt', expectedRevision: 8,
      next: { status: 'abandoned', currentGameNumber: 2, currentHandIndex: 0, result: {} },
      outbox: { eventType: 'attempt_abandoned', payload: {} },
    }, { fetch });
    expect(result).toMatchObject({
      outcome: 'rejected', errorCode: 'stale_revision', replayed: true, committedRevision: 9,
    });
  });
});
