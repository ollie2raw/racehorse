import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pacificDate from '../shared/pacificDate';
import {
  isStartupDailyFritzWarmupEnabled,
  isTruthyEnvFlag,
  scheduleDailyFritzWarmup,
  scheduleStartupDailyWarmups,
  warmDailyFritzRuns,
  warmOneDailyFritzRun,
} from './dailyWarmup';

describe('isTruthyEnvFlag', () => {
  it('returns false for empty or missing values', () => {
    expect(isTruthyEnvFlag(undefined)).toBe(false);
    expect(isTruthyEnvFlag('')).toBe(false);
    expect(isTruthyEnvFlag('   ')).toBe(false);
  });

  it('accepts true, 1, and yes case-insensitively', () => {
    expect(isTruthyEnvFlag('true')).toBe(true);
    expect(isTruthyEnvFlag('TRUE')).toBe(true);
    expect(isTruthyEnvFlag('  Yes ')).toBe(true);
    expect(isTruthyEnvFlag('1')).toBe(true);
  });

  it('rejects other strings', () => {
    expect(isTruthyEnvFlag('false')).toBe(false);
    expect(isTruthyEnvFlag('0')).toBe(false);
    expect(isTruthyEnvFlag('on')).toBe(false);
  });
});

describe('startup warmup env gates', () => {
  const originalFritz = process.env.ENABLE_STARTUP_FRITZ_WARMUP;

  afterEach(() => {
    if (originalFritz === undefined) delete process.env.ENABLE_STARTUP_FRITZ_WARMUP;
    else process.env.ENABLE_STARTUP_FRITZ_WARMUP = originalFritz;
  });

  it('isStartupDailyFritzWarmupEnabled reads ENABLE_STARTUP_FRITZ_WARMUP', () => {
    delete process.env.ENABLE_STARTUP_FRITZ_WARMUP;
    expect(isStartupDailyFritzWarmupEnabled()).toBe(false);
    process.env.ENABLE_STARTUP_FRITZ_WARMUP = 'true';
    expect(isStartupDailyFritzWarmupEnabled()).toBe(true);
  });
});

describe('Pacific warmup schedule delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scheduleDailyFritzWarmup uses at least 1000ms and respects next Pacific warmup', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(pacificDate, 'getNextPacificWarmupAt').mockReturnValue(new Date('2026-07-04T12:00:30.000Z'));

    scheduleDailyFritzWarmup();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it('scheduleDailyFritzWarmup floors delay at 1000ms when next warmup is immediate', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(pacificDate, 'getNextPacificWarmupAt').mockReturnValue(new Date('2026-07-04T11:59:59.500Z'));

    scheduleDailyFritzWarmup();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

});

describe('scheduleStartupDailyWarmups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('defers startup warmups by 12 seconds', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    scheduleStartupDailyWarmups();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12_000);
  });
});


// ---------------------------------------------------------------------------
// DF-STALE-1 regression: the warmup pre-generates [today, tomorrow] every night,
// so it re-visits each date. Before this fix, a FRITZ_POLICY_VERSION bump between
// the run that first published a date and a later run made the later run's blind
// publishDailyFritzChallenge raise daily_fritz_challenge_identity_conflict against
// the frozen row (and, via Promise.all, skip the sibling date's pre-generation).
// ---------------------------------------------------------------------------

const {
  ensureRunMock,
  getPublishedChallengeMock,
  publishChallengeMock,
  transactionalEnabledMock,
} = vi.hoisted(() => ({
  ensureRunMock: vi.fn(),
  getPublishedChallengeMock: vi.fn(),
  publishChallengeMock: vi.fn(),
  transactionalEnabledMock: vi.fn(() => true),
}));

vi.mock('../http/stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../http/stores/dailyFritzStore')>(
    '../http/stores/dailyFritzStore',
  );
  return { ...actual, ensureDailyFritzRunForDate: ensureRunMock };
});

vi.mock('../http/stores/dailyFritzPublishedChallengeStore', () => ({
  getDailyFritzPublishedChallenge: getPublishedChallengeMock,
  publishDailyFritzChallenge: publishChallengeMock,
}));

vi.mock('../dailyFritzAuthorityFeature', () => ({
  isDailyFritzTransactionalAuthorityEnabled: transactionalEnabledMock,
}));

function runRecord(runDate: string) {
  return {
    runDate,
    seed: `seed-${runDate}`,
    fritzTier: 'elite' as const,
    dealSize: 7 as const,
    winningScore: 60,
    status: 'live' as const,
    handDeals: [],
    generatedAt: '2026-09-04T07:02:01.363Z',
    invalidatedAt: null,
    metadata: {},
  };
}

describe('warmOneDailyFritzRun — reuse-if-already-published guard (DF-STALE-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionalEnabledMock.mockReturnValue(true);
    ensureRunMock.mockImplementation(async (runDate: string) => runRecord(runDate));
  });

  it('reuses an already-published challenge instead of re-publishing under current constants', async () => {
    // A row published on an earlier warmup run, stamped with a now-stale policy
    // version and a digest that a fresh rebuild under current constants would not
    // match — the exact DF-STALE-1 shape.
    getPublishedChallengeMock.mockImplementation(async (challengeId: string) => ({
      challengeId,
      contentDigest: 'frozen-digest-under-old-FRITZ_POLICY_VERSION',
      fritzPolicyVersion: 2,
      status: 'live',
    }));

    const result = await warmOneDailyFritzRun('2026-09-05');

    expect(publishChallengeMock).not.toHaveBeenCalled();
    expect(result.publish).toBe('reused');
    expect(result.challengeDigest).toBe('frozen-digest-under-old-FRITZ_POLICY_VERSION');
  });

  it('publishes a fresh challenge when none exists yet (first warmup to reach this date)', async () => {
    getPublishedChallengeMock.mockResolvedValue(null);
    publishChallengeMock.mockImplementation(async (built: { challengeId: string }) => ({
      challengeId: built.challengeId,
      contentDigest: 'fresh-digest',
      status: 'live',
    }));

    const result = await warmOneDailyFritzRun('2026-09-05');

    expect(publishChallengeMock).toHaveBeenCalledTimes(1);
    expect(result.publish).toBe('published');
  });

  it('skips publishing entirely when transactional authority is disabled', async () => {
    transactionalEnabledMock.mockReturnValue(false);

    const result = await warmOneDailyFritzRun('2026-09-05');

    expect(getPublishedChallengeMock).not.toHaveBeenCalled();
    expect(publishChallengeMock).not.toHaveBeenCalled();
    expect(result.publish).toBe('skipped');
  });
});

describe('warmDailyFritzRuns — one date failing does not skip the other', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionalEnabledMock.mockReturnValue(true);
    getPublishedChallengeMock.mockResolvedValue(null);
    publishChallengeMock.mockImplementation(async (built: { challengeId: string }) => ({
      challengeId: built.challengeId,
      contentDigest: 'fresh-digest',
      status: 'live',
    }));
  });

  it('still pre-generates tomorrow when today throws (Promise.allSettled, not Promise.all)', async () => {
    const TODAY = '2026-09-05';
    const TOMORROW = '2026-09-06';
    ensureRunMock.mockImplementation(async (runDate: string) => {
      if (runDate === TODAY) throw new Error('run generation failed for today');
      return runRecord(runDate);
    });

    await expect(warmDailyFritzRuns('scheduled', [TODAY, TOMORROW])).resolves.toBeUndefined();

    // tomorrow's publish must have happened despite today's failure.
    expect(publishChallengeMock).toHaveBeenCalledTimes(1);
    const builtForTomorrow = publishChallengeMock.mock.calls[0]?.[0] as { runDate: string };
    expect(builtForTomorrow.runDate).toBe(TOMORROW);
  });
});
