import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pacificDate from '../shared/pacificDate';
import {
  isStartupDailyFritzWarmupEnabled,
  isTruthyEnvFlag,
  scheduleDailyFritzWarmup,
  scheduleStartupDailyWarmups,
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