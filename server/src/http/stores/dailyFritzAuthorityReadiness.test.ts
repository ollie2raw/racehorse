import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../../supabaseUtils';
import {
  getDailyFritzAuthoritySchemaAvailability,
  probeDailyFritzAuthoritySchema,
  resetDailyFritzAuthorityReadinessForTests,
} from './dailyFritzAuthorityReadiness';

describe('Daily Fritz authority schema readiness', () => {
  const original = process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
  beforeEach(() => {
    resetDailyFritzAuthorityReadinessForTests();
    vi.mocked(supabaseFetch).mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    else process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = original;
  });

  it('does not require expanded schema while the rollout gate is disabled', async () => {
    delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    await expect(probeDailyFritzAuthoritySchema()).resolves.toBe(true);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('probes every authority surface before reporting ready', async () => {
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    vi.mocked(supabaseFetch).mockResolvedValue([]);
    await expect(probeDailyFritzAuthoritySchema()).resolves.toBe(true);
    expect(supabaseFetch).toHaveBeenCalledTimes(6);
    expect(getDailyFritzAuthoritySchemaAvailability()).toBe(true);
  });

  it('fails readiness closed when any required authority surface is unavailable', async () => {
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    vi.mocked(supabaseFetch).mockRejectedValueOnce(new Error('missing column'));
    await expect(probeDailyFritzAuthoritySchema()).resolves.toBe(false);
    expect(getDailyFritzAuthoritySchemaAvailability()).toBe(false);
  });
});
