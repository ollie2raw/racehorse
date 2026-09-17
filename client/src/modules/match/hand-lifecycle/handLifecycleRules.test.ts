import { describe, expect, it, vi } from 'vitest';

const { operational, info } = vi.hoisted(() => ({
  operational: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../../../utils/logger', () => ({
  logger: {
    operational,
    info,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logDailyFritzStaleCursorBreadcrumb } from './handLifecycleRules';

describe('logDailyFritzStaleCursorBreadcrumb (2026-09 instrumentation follow-up)', () => {
  it('routes stale-cursor-detected to logger.operational (Sentry breadcrumb, production-visible), not logger.info (DEV-only)', () => {
    logDailyFritzStaleCursorBreadcrumb('stale-cursor-detected', { staleByHands: 3 });
    expect(operational).toHaveBeenCalledWith('daily-flow', 'stale-cursor-detected', { staleByHands: 3 });
    expect(info).not.toHaveBeenCalled();
  });

  it('routes resync-triggered to logger.operational', () => {
    logDailyFritzStaleCursorBreadcrumb('resync-triggered', { staleByHands: 3 });
    expect(operational).toHaveBeenCalledWith('daily-flow', 'resync-triggered', { staleByHands: 3 });
    expect(info).not.toHaveBeenCalled();
  });
});
