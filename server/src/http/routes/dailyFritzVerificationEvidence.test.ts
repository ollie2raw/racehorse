import { describe, expect, it, vi } from 'vitest';
import type { DailyFritzTranscript } from '@racehorse/game-core';
import { digestDailyFritzTranscript } from '../../dailyFritzVerifier';
import {
  buildDailyFritzTranscriptEvidence,
  dailyFritzTranscriptEvidenceFields,
  recordDailyFritzAdvanceWithoutVerification,
  recordDailyFritzAsyncVerificationScheduled,
} from './dailyFritzVerificationGlue';

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { recordEventMock } = vi.hoisted(() => ({
  recordEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>(
    '../stores/dailyFritzEventStore',
  );
  return {
    ...actual,
    recordDailyFritzEvent: recordEventMock,
  };
});

function sampleTranscript(overrides: Partial<DailyFritzTranscript> = {}): DailyFritzTranscript {
  return {
    protocolVersion: 2,
    rulesVersion: 1,
    fritzPolicyVersion: 2,
    fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
    stateDigestVersion: 1,
    clientRelease: 'test',
    challengeId: 'daily-fritz:2026-08-20:r2:s1',
    attemptId: 'attempt-1',
    gameNumber: 1,
    handIndex: 0,
    actions: [
      {
        sequence: 0,
        actor: 'player',
        kind: 'play',
        tile: { low: 6, high: 6 },
        position: 'left',
      },
    ],
    ...overrides,
  };
}

describe('Daily Fritz verification transcript evidence (observability)', () => {
  it('builds digest + transcript fields without mutating the transcript', () => {
    const transcript = sampleTranscript();
    const evidence = buildDailyFritzTranscriptEvidence(transcript);
    expect(evidence.transcriptDigest).toBe(digestDailyFritzTranscript(transcript));
    expect(evidence.actionCount).toBe(1);
    expect(evidence.transcript).toEqual(transcript);
    expect(dailyFritzTranscriptEvidenceFields(null)).toEqual({
      transcriptDigest: null,
      payload: {},
    });
  });

  it('persists transcript + digest on advance_unverified events', async () => {
    recordEventMock.mockClear();
    const transcript = sampleTranscript({ handIndex: 2 });
    await recordDailyFritzAdvanceWithoutVerification({
      attemptId: 'attempt-1',
      runDate: '2026-08-20',
      userId: 'user-1',
      requestId: 'req-1',
      gameNumber: 1,
      handIndex: 2,
      verifierCode: 'wrong_actor',
      operation: 'next-hand',
      message: 'wrong actor',
      transcript,
    });

    expect(recordEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'verification_failed',
      transcriptDigest: digestDailyFritzTranscript(transcript),
      payload: expect.objectContaining({
        outcome: 'advance_unverified',
        operation: 'next-hand',
        transcript,
        action_count: 1,
      }),
    }));
  });

  it('persists transcript + digest on async_verification_scheduled events', async () => {
    recordEventMock.mockClear();
    const transcript = sampleTranscript({ handIndex: 4, gameNumber: 2 });
    await recordDailyFritzAsyncVerificationScheduled({
      attemptId: 'attempt-1',
      runDate: '2026-08-20',
      userId: 'user-1',
      requestId: 'req-2',
      gameNumber: 2,
      handIndex: 4,
      transcript,
      expectedPlayerScore: 60,
      expectedFritzScore: 34,
    });

    expect(recordEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'async_verification_scheduled',
      transcriptDigest: digestDailyFritzTranscript(transcript),
      idempotencyKey: expect.stringContaining('async_verification_scheduled'),
      payload: expect.objectContaining({
        outcome: 'async_verification_scheduled',
        expected_player_score: 60,
        expected_fritz_score: 34,
        transcript,
        action_count: 1,
      }),
    }));
  });
});
