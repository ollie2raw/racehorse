import { afterEach, describe, expect, it } from 'vitest';
import { isDailyFritzTransactionalAuthorityEnabled } from './dailyFritzAuthorityFeature';

describe('Daily Fritz transactional authority rollout gate', () => {
  const original = process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
  afterEach(() => {
    if (original === undefined) delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    else process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = original;
  });

  it('fails safe until explicitly enabled', () => {
    delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    expect(isDailyFritzTransactionalAuthorityEnabled()).toBe(false);
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    expect(isDailyFritzTransactionalAuthorityEnabled()).toBe(true);
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = '1';
    expect(isDailyFritzTransactionalAuthorityEnabled()).toBe(false);
  });
});
