import { describe, expect, it, vi } from 'vitest';
import {
  commitFritzChallengeAttemptCommand,
  digestFritzChallengeCommand,
  startFritzChallengeAttemptCommand,
} from './fritzChallengeCommandStore';

describe('Fritz Challenge transactional command store', () => {
  it('hashes semantic payloads canonically', () => {
    expect(digestFritzChallengeCommand({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(digestFritzChallengeCommand({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('sends CAS, verification receipts, and outbox data in one command', async () => {
    const fetch = vi.fn(async () => [{
      outcome: 'committed', error_code: null, replayed: false,
      committed_revision: 8, response: { attempt_id: 'attempt-1', revision: 8 },
    }]);
    await commitFritzChallengeAttemptCommand({
      userId: 'user-1', attemptId: 'attempt-1', operationId: 'hand:1:2',
      commandType: 'accept_verified_hand', expectedRevision: 7,
      next: { status: 'started', currentGameNumber: 1, currentHandIndex: 3, result: {} },
      handReceipt: { gameNumber: 1, handIndex: 2, transcriptDigest: 'a'.repeat(64), actionCount: 12 },
      outbox: { eventType: 'hand_verified', payload: { gameNumber: 1, handIndex: 2 } },
    }, { fetch: fetch as any });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      p_expected_revision: 7,
      p_operation_id: 'hand:1:2',
      p_hand_receipt: { gameNumber: 1, handIndex: 2 },
      p_outbox_event_type: 'hand_verified',
    });
  });

  it('starts attempts through an idempotent participant/challenge command', async () => {
    const fetch = vi.fn(async () => [{
      outcome: 'committed', error_code: null, replayed: false,
      committed_revision: 1, response: { attempt_id: 'attempt-1', created: true },
    }]);
    await startFritzChallengeAttemptCommand({
      userId: 'user-1', challengeId: 'challenge-1', operationId: 'start:challenge-1',
      authorityResult: { challenge_id: 'fritz-challenge:challenge-1', verifier_version: 2 },
    }, { fetch: fetch as any });
    expect(fetch).toHaveBeenCalledWith(
      '/rest/v1/rpc/start_fritz_challenge_attempt_command',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      p_operation_id: 'start:challenge-1',
      p_challenge_id: 'challenge-1',
    });
    expect(body.p_request_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
