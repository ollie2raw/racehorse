/**
 * A mismatch that lands in unverified_hands must leave behind enough evidence
 * to diagnose it without a transcript reconstruction. Before this, the record
 * path emitted the verifier code and the human-readable message only — so a
 * fritz_state_mismatch told us that a divergence happened and nothing about
 * which field diverged.
 *
 * Logging only: nothing here may change whether the hand advances.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

const { errorLogMock } = vi.hoisted(() => ({ errorLogMock: vi.fn() }));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));

vi.mock('../../logger', () => ({
  childLogger: () => ({
    error: errorLogMock,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { recordEventMock } = vi.hoisted(() => ({
  recordEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: recordEventMock,
  countRecentDailyFritzVerificationFailures: vi.fn().mockResolvedValue(0),
}));

import { recordDailyFritzAdvanceWithoutVerification } from './dailyFritzVerificationGlue';

const RUN_DATE = '2026-08-24';
const USER_ID = 'user-mismatch';
const ATTEMPT_ID = 'attempt-mismatch';

/** Shaped like the payload the verifier now attaches to the error. */
const DIAGNOSTICS = {
  digestVersion: 1,
  clientStateDigest: 'df-state-v1:aaaaaaaa',
  serverStateDigest: 'df-state-v1:bbbbbbbb',
  actionSequence: 12,
  actor: 'fritz',
  actionKind: 'play',
  serverState: {
    board: { left: 3, right: 5 },
    players: [{ hand: ['1|2', '3|4'], score: 24 }, { hand: ['0|5'], score: 31 }],
    boneyard: ['2|6'],
    handNumber: 3,
    sequence: 12,
  },
  serverTileCounts: { hands: [2, 1], scores: [24, 31], boneyard: 1, deadTiles: 0, board: null },
};

async function record(diagnostics?: Record<string, unknown>) {
  await recordDailyFritzAdvanceWithoutVerification({
    attemptId: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    requestId: 'req-mismatch',
    gameNumber: 1,
    handIndex: 3,
    verifierCode: 'fritz_state_mismatch',
    operation: 'next-hand',
    message: 'Fritz state diverged before action 12.',
    ...(diagnostics ? { diagnostics } : {}),
  });
}

afterEach(() => {
  errorLogMock.mockReset();
  recordEventMock.mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
});

describe('mismatch diagnostics reach the operator', () => {
  it('logs the server-computed state alongside both digests', async () => {
    await record(DIAGNOSTICS);

    const logged = errorLogMock.mock.calls.find(
      ([fields]) => (fields as Record<string, unknown>)?.verifierCode === 'fritz_state_mismatch',
    );
    expect(logged).toBeTruthy();
    const fields = logged?.[0] as Record<string, unknown>;
    const diagnostics = fields.diagnostics as Record<string, unknown>;
    expect(diagnostics).toBeTruthy();
    expect(diagnostics.clientStateDigest).toBe('df-state-v1:aaaaaaaa');
    expect(diagnostics.serverStateDigest).toBe('df-state-v1:bbbbbbbb');
    expect(diagnostics.serverState).toEqual(DIAGNOSTICS.serverState);
    expect(diagnostics.serverTileCounts).toEqual(DIAGNOSTICS.serverTileCounts);
  });

  it('attaches the diagnostics to the Sentry bypass alert', async () => {
    await record(DIAGNOSTICS);

    const call = vi.mocked(Sentry.captureMessage).mock.calls.at(0);
    expect(call).toBeTruthy();
    const extra = (call?.[1] as { extra?: Record<string, unknown> })?.extra ?? {};
    expect(extra.diagnostics).toEqual(DIAGNOSTICS);
  });

  it('persists the diagnostics on the durable verification_failed event', async () => {
    await record(DIAGNOSTICS);

    const event = recordEventMock.mock.calls.at(0)?.[0] as
      { payload?: Record<string, unknown> } | undefined;
    expect(event?.payload?.mismatch_diagnostics).toEqual(DIAGNOSTICS);
  });

  it('omits the field entirely when the verifier supplied no diagnostics', async () => {
    await record();

    const fields = errorLogMock.mock.calls.at(0)?.[0] as Record<string, unknown>;
    expect(fields).toBeTruthy();
    expect(fields).not.toHaveProperty('diagnostics');
    const event = recordEventMock.mock.calls.at(0)?.[0] as
      { payload?: Record<string, unknown> } | undefined;
    expect(event?.payload).not.toHaveProperty('mismatch_diagnostics');
  });
});
