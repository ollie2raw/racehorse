import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzAttemptRecord } from './http/stores/dailyFritzStore';

const {
  listStrandedMock,
  getAttemptByIdMock,
  upsertAttemptMock,
  recordEventMock,
  commitCommandMock,
  classifyMock,
} = vi.hoisted(() => ({
  listStrandedMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  recordEventMock: vi.fn().mockResolvedValue(undefined),
  commitCommandMock: vi.fn(),
  classifyMock: vi.fn(),
}));

vi.mock('./dailyFritzRecoveryEligibility', async () => {
  const actual = await vi.importActual<typeof import('./dailyFritzRecoveryEligibility')>('./dailyFritzRecoveryEligibility');
  return { ...actual, classifyDailyFritzRecovery: classifyMock };
});

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

import { recoverStrandedDailyFritzAttempts, resetDailyFritzRecoveryScanForTests } from './dailyFritzStrandedRecovery';

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
  listStrandedMock.mockImplementation(async (_cutoff: string, limit: number, afterId?: string) =>
    [...byId.values()].filter((a) => a.status === 'started' && (!afterId || a.id > afterId)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map((a) => ({ ...a })));
  getAttemptByIdMock.mockImplementation(async (id: string, userId: string) => {
    const row = byId.get(id);
    return row && row.userId === userId ? { ...row } : null;
  });
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => {
    byId.set(record.id, { ...record });
    return { ...record };
  });
  return byId;
}

describe('recoverStrandedDailyFritzAttempts (DF-G1)', () => {
  const originalTransactional = process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('./dailyFritzRecoveryEligibility')>('./dailyFritzRecoveryEligibility');
    classifyMock.mockReset().mockImplementation(actual.classifyDailyFritzRecovery);
    resetDailyFritzRecoveryScanForTests();
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

  it('records amplification before/after: 100 incomplete rows cost one scan and zero full-row reads, on repeated runs', async () => {
    const population = Array.from({ length: 100 }, (_, i) => strandedAttempt({
      id: `old-${String(i).padStart(3, '0')}`,
      result: { version: 2, format: 'best_of_3', games: [], active_checkpoint: { resumable: true } },
    }));
    wireStore(population);
    // The old loop always did one full-row lookup for each bulk-query row.
    await listStrandedMock();
    for (const row of population) await getAttemptByIdMock(row.id, row.userId);
    const before = { scans: listStrandedMock.mock.calls.length, fullReads: getAttemptByIdMock.mock.calls.length };
    listStrandedMock.mockClear();
    getAttemptByIdMock.mockClear();
    for (let run = 0; run < 4; run += 1) await recoverStrandedDailyFritzAttempts();
    const after = { scans: listStrandedMock.mock.calls.length, fullReads: getAttemptByIdMock.mock.calls.length };
    expect(before).toEqual({ scans: 1, fullReads: 100 });
    expect(after).toEqual({ scans: 4, fullReads: 0 });
    expect(upsertAttemptMock).not.toHaveBeenCalled();
    expect(recordEventMock).not.toHaveBeenCalled();
    for (const row of population) {
      expect(await getAttemptByIdMock(row.id, row.userId)).toEqual(row);
    }
  });

  it('advances past an old incomplete page to recover a newer completion and wraps without repeatedly fetching it', async () => {
    wireStore([
      ...Array.from({ length: 100 }, (_, i) => strandedAttempt({ id: `a-${String(i).padStart(3, '0')}`, result: { version: 2, format: 'best_of_3', games: [] } })),
      strandedAttempt({ id: 'z-newer', startedAt: '2026-09-02T00:00:00.000Z' }),
    ]);
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(0);
    expect(getAttemptByIdMock).not.toHaveBeenCalled();
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(listStrandedMock.mock.calls[1]?.[2]).toBe('a-099');
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(1);
    for (let run = 0; run < 4; run += 1) await recoverStrandedDailyFritzAttempts();
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(1);
    expect(upsertAttemptMock).toHaveBeenCalledTimes(1);
  });

  it('does not refetch corrupt/ambiguous results or permanently pin the scan on them', async () => {
    wireStore([strandedAttempt({ result: { version: 2, format: 'best_of_3', games: [{ corrupt: true }], setWinner: 'player' } })]);
    for (let run = 0; run < 3; run += 1) await recoverStrandedDailyFritzAttempts();
    expect(getAttemptByIdMock).not.toHaveBeenCalled();
    expect(upsertAttemptMock).not.toHaveBeenCalled();
    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it('revisits a previously incomplete row after it becomes complete', async () => {
    wireStore([strandedAttempt({ result: { version: 2, format: 'best_of_3', games: [] } })]);
    await recoverStrandedDailyFritzAttempts();
    await upsertAttemptMock(strandedAttempt());
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
  });

  it('preserves a transactional completion conflict without falling back to an upsert', async () => {
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    wireStore([strandedAttempt({ challengeId: 'challenge-1' })]);
    commitCommandMock.mockResolvedValue({ outcome: 'conflict', errorCode: 'stale_revision' });
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(0);
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });

  it('does not overlap scans or advance the cursor while another sweep is running', async () => {
    let release!: (value: DailyFritzAttemptRecord[]) => void;
    listStrandedMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = recoverStrandedDailyFritzAttempts();
    expect(await recoverStrandedDailyFritzAttempts()).toEqual({ scanned: 0, finalized: 0, skipped: 0 });
    expect(listStrandedMock).toHaveBeenCalledTimes(1);
    release([]);
    await first;
  });

  it.each(['setWinner', 'set_winner'])('recovers a one-game instant skunk using %s through the unchanged finalizer', async (alias) => {
    const full = completedSetResult();
    wireStore([strandedAttempt({ result: { ...full, games: (full.games as unknown[]).slice(0, 1), [alias]: 'player', instant_skunk: true } })]);
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(upsertAttemptMock.mock.calls[0]![0]).toMatchObject({ status: 'completed', won: true, finalScore: 2, opponentScore: 0 });
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(0);
  });

  it('isolates a malformed first row, finalizes a later row, advances a full page, and never mutates the malformed row', async () => {
    const full = completedSetResult();
    const malformed = strandedAttempt({ id: 'a-000', result: JSON.parse(JSON.stringify({ ...full, games: [{ ...(full.games as Record<string, unknown>[])[0], playerScore: { toString: 'invalid', valueOf: 'invalid' } }] })) });
    const before = structuredClone(malformed);
    const rows = wireStore([
      malformed, strandedAttempt({ id: 'a-001' }),
      ...Array.from({ length: 98 }, (_, i) => strandedAttempt({ id: `a-${String(i + 2).padStart(3, '0')}`, result: { version: 2, format: 'best_of_3', games: [] } })),
      strandedAttempt({ id: 'z-later' }),
    ]);
    expect(await recoverStrandedDailyFritzAttempts()).toEqual({ scanned: 100, finalized: 1, skipped: 99 });
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(1);
    expect(rows.get(malformed.id)).toEqual(before);
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(listStrandedMock.mock.calls[1]?.[2]).toBe('a-099');
    for (let run = 0; run < 3; run += 1) await recoverStrandedDailyFritzAttempts();
    expect(listStrandedMock.mock.calls[2]?.[2]).toBeUndefined();
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(2);
    expect(upsertAttemptMock).toHaveBeenCalledTimes(2);
    expect(rows.get(malformed.id)).toEqual(before);
    expect(getAttemptByIdMock.mock.calls.some(([id]) => id === malformed.id)).toBe(false);
  });

  it('isolates an unforeseen classifier exception and still advances to later work', async () => {
    const rows = wireStore([
      ...Array.from({ length: 100 }, (_, i) => strandedAttempt({ id: `a-${String(i).padStart(3, '0')}`, result: { version: 2, format: 'best_of_3', games: [] } })),
      strandedAttempt({ id: 'z-later' }),
    ]);
    const before = structuredClone(rows.get('a-000'));
    // A future classifier regression is independently isolated by the sweep.
    // Throw a non-Error with unsafe string coercion to exercise safe logging.
    classifyMock.mockImplementationOnce(() => { throw { toString: 'invalid', valueOf: 'invalid' }; });
    expect(await recoverStrandedDailyFritzAttempts()).toEqual({ scanned: 100, finalized: 0, skipped: 100 });
    expect(recordEventMock).not.toHaveBeenCalled();
    expect(getAttemptByIdMock).not.toHaveBeenCalled();
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(listStrandedMock.mock.calls[1]?.[2]).toBe('a-099');
    expect(rows.get('a-000')).toEqual(before);
  });

  it('surfaces scan infrastructure failure, retains its cursor, and permits a later retry', async () => {
    wireStore([
      ...Array.from({ length: 100 }, (_, i) => strandedAttempt({ id: `a-${String(i).padStart(3, '0')}`, result: { version: 2, format: 'best_of_3', games: [] } })),
      strandedAttempt({ id: 'z-later' }),
    ]);
    await recoverStrandedDailyFritzAttempts();
    const failure = new Error('database scan unavailable');
    listStrandedMock.mockRejectedValueOnce(failure);
    classifyMock.mockClear();
    await expect(recoverStrandedDailyFritzAttempts()).rejects.toBe(failure);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(recordEventMock).not.toHaveBeenCalled();
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(listStrandedMock.mock.calls[1]?.[2]).toBe('a-099');
    expect(listStrandedMock.mock.calls[2]?.[2]).toBe('a-099');
  });
  it('backs off a complete poison attempt without refetching or journaling every cadence', async () => {
    wireStore([strandedAttempt()]);
    upsertAttemptMock.mockRejectedValue(new Error('permanent invalid authority state'));
    const now = Date.parse('2026-10-15T00:00:00Z');
    await recoverStrandedDailyFritzAttempts({ now });
    await recoverStrandedDailyFritzAttempts({ now: now + 15 * 60_000 });
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(1);
    expect(upsertAttemptMock).toHaveBeenCalledTimes(1);
    expect(recordEventMock).toHaveBeenCalledTimes(1);
    await recoverStrandedDailyFritzAttempts({ now: now + 30 * 60_000 });
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(2);
    expect(recordEventMock).toHaveBeenCalledTimes(2);
  });

  it('stops the sweep on a finalization infrastructure outage instead of refetching the whole page', async () => {
    wireStore(Array.from({ length: 100 }, (_, i) => strandedAttempt({ id: `a-${i}` })));
    getAttemptByIdMock.mockRejectedValueOnce(new Error('Supabase request failed: 503 unavailable'));
    await expect(recoverStrandedDailyFritzAttempts()).rejects.toThrow('503');
    expect(getAttemptByIdMock).toHaveBeenCalledTimes(1);
    expect(recordEventMock).not.toHaveBeenCalled();
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(100);
  });

});
