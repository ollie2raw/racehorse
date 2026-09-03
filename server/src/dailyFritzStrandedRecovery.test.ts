import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzAttemptRecord } from './http/stores/dailyFritzStore';

const {
  listStrandedMock,
  getAttemptByIdMock,
  upsertAttemptMock,
  recordEventMock,
  commitCommandMock,
} = vi.hoisted(() => ({
  listStrandedMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  recordEventMock: vi.fn().mockResolvedValue(undefined),
  commitCommandMock: vi.fn(),
}));

vi.mock('./http/stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('./http/stores/dailyFritzStore')>('./http/stores/dailyFritzStore');
  return {
    ...actual,
    listStrandedDailyFritzAttempts: listStrandedMock,
    getDailyFritzAttemptById: getAttemptByIdMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
    invalidateDailyFritzLeaderboard: vi.fn(),
  };
});

vi.mock('./http/stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('./http/stores/dailyFritzEventStore')>('./http/stores/dailyFritzEventStore');
  return { ...actual, recordDailyFritzEvent: recordEventMock };
});

vi.mock('./http/stores/dailyFritzCommandStore', async () => {
  const actual = await vi.importActual<typeof import('./http/stores/dailyFritzCommandStore')>('./http/stores/dailyFritzCommandStore');
  return { ...actual, commitDailyFritzAttemptCommand: commitCommandMock };
});

import { recoverStrandedDailyFritzAttempts } from './dailyFritzStrandedRecovery';

const RUN_DATE = '2026-09-01';
const USER_ID = 'user-stranded';
const OLD_STARTED_AT = '2026-09-01T00:00:00.000Z';

function completedSetResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    format: 'best_of_3',
    verification_status: 'in_progress',
    verification_protocol_version: 2,
    games: [
      { gameNumber: 1, seed: `s:${RUN_DATE}:1`, playerScore: 61, fritzScore: 20, playerWon: true, pointDiff: 41, completedAt: '2026-09-01T00:05:00.000Z' },
      { gameNumber: 2, seed: `s:${RUN_DATE}:2`, playerScore: 60, fritzScore: 15, playerWon: true, pointDiff: 45, completedAt: '2026-09-01T00:12:00.000Z' },
    ],
    authority: {
      version: 1,
      hands: [
        { gameNumber: 1, handIndex: 0, transcriptDigest: 'a'.repeat(64), actionCount: 12 },
        { gameNumber: 2, handIndex: 0, transcriptDigest: 'b'.repeat(64), actionCount: 14 },
      ],
      games: [
        { gameNumber: 1, playerScore: 61, fritzScore: 20, handDigests: ['a'.repeat(64)] },
        { gameNumber: 2, playerScore: 60, fritzScore: 15, handDigests: ['b'.repeat(64)] },
      ],
    },
    ...overrides,
  };
}

function strandedAttempt(overrides: Partial<DailyFritzAttemptRecord> = {}): DailyFritzAttemptRecord {
  return {
    id: 'attempt-stranded',
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 2,
    revision: 4,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: 2,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    startedAt: OLD_STARTED_AT,
    completedAt: null,
    verifiedMatchId: 'vm-1',
    completionHash: null,
    result: completedSetResult(),
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
    ...overrides,
  };
}

/** A store that reflects upserts back through getDailyFritzAttemptById (idempotency). */
function wireStore(initial: DailyFritzAttemptRecord[]): void {
  const byId = new Map(initial.map((a) => [a.id, { ...a }]));
  listStrandedMock.mockImplementation(async () =>
    [...byId.values()].filter((a) => a.status === 'started').map((a) => ({ ...a })));
  getAttemptByIdMock.mockImplementation(async (id: string, userId: string) => {
    const row = byId.get(id);
    return row && row.userId === userId ? { ...row } : null;
  });
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => {
    byId.set(record.id, { ...record });
    return { ...record };
  });
}

describe('recoverStrandedDailyFritzAttempts (DF-G1)', () => {
  const originalTransactional = process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
  beforeEach(() => {
    delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    for (const m of [listStrandedMock, getAttemptByIdMock, upsertAttemptMock, recordEventMock, commitCommandMock]) m.mockReset();
    recordEventMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    if (originalTransactional === undefined) delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    else process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = originalTransactional;
  });

  it('finalizes a stranded completed set that survived a simulated restart — the run stops vanishing', async () => {
    wireStore([strandedAttempt()]);

    const result = await recoverStrandedDailyFritzAttempts();

    expect(result).toEqual({ scanned: 1, finalized: 1, skipped: 0 });
    const persisted = upsertAttemptMock.mock.calls[0]![0] as DailyFritzAttemptRecord;
    expect(persisted.status).toBe('completed');
    expect(persisted.completedAt).toBeTruthy();
    expect(persisted.completionHash).toBeTruthy();
    // Two player-won games -> verified, on the board.
    expect((persisted.result as Record<string, unknown>).verification_status).toBe('verified');
    expect(persisted.finalScore).toBe(2);
    expect(persisted.opponentScore).toBe(0);
    expect(persisted.won).toBe(true);
    // A recovery_succeeded event is journaled for observability.
    const eventTypes = recordEventMock.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain('recovery_succeeded');
    expect(eventTypes).toContain('attempt_completed');
  });

  it('skips an attempt whose set is not complete — a player genuinely mid-attempt is never finalized', async () => {
    wireStore([strandedAttempt({ result: { version: 2, format: 'best_of_3', games: [] } })]);

    const result = await recoverStrandedDailyFritzAttempts();

    expect(result).toEqual({ scanned: 1, finalized: 0, skipped: 1 });
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });

  it('finalizes a rejected stranded set as legacy_unverified — never promotes it onto the board (DM-INV-11)', async () => {
    wireStore([
      strandedAttempt({
        result: completedSetResult({
          verification_status: 'rejected',
          unverified_hands: [{ game_number: 1, hand_index: 3, verifier_code: 'fritz_state_mismatch' }],
        }),
      }),
    ]);

    const result = await recoverStrandedDailyFritzAttempts();

    expect(result.finalized).toBe(1);
    const persisted = upsertAttemptMock.mock.calls[0]![0] as DailyFritzAttemptRecord;
    expect(persisted.status).toBe('completed');
    expect((persisted.result as Record<string, unknown>).verification_status).toBe('legacy_unverified');
  });

  it('is idempotent — a second sweep after finalization does nothing', async () => {
    wireStore([strandedAttempt()]);

    const first = await recoverStrandedDailyFritzAttempts();
    expect(first.finalized).toBe(1);

    upsertAttemptMock.mockClear();
    const second = await recoverStrandedDailyFritzAttempts();
    expect(second).toEqual({ scanned: 0, finalized: 0, skipped: 0 });
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });

  it('skips an attempt a concurrent /complete already finalized (status flipped under the lock)', async () => {
    // listStranded still returns it (stale read) but getDailyFritzAttemptById shows it completed.
    listStrandedMock.mockResolvedValue([strandedAttempt()]);
    getAttemptByIdMock.mockResolvedValue(strandedAttempt({ status: 'completed', completedAt: '2026-09-01T00:20:00.000Z' }));

    const result = await recoverStrandedDailyFritzAttempts();

    expect(result).toEqual({ scanned: 1, finalized: 0, skipped: 1 });
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });

  it('uses the transactional command path when the attempt has a challengeId', async () => {
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    listStrandedMock.mockResolvedValue([strandedAttempt({ challengeId: 'challenge-1' })]);
    getAttemptByIdMock.mockResolvedValue(strandedAttempt({ challengeId: 'challenge-1' }));
    commitCommandMock.mockResolvedValue({ outcome: 'committed', errorCode: null, committedRevision: 5, response: {} });

    const result = await recoverStrandedDailyFritzAttempts();

    expect(result.finalized).toBe(1);
    expect(commitCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'finalize_verified_attempt', operationId: 'finalize:set' }),
    );
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });
});
