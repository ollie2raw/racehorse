import { describe, expect, it } from 'vitest';
import { validateDailyFritzDebugDate } from './dailyFritzDebugDate';

describe('validateDailyFritzDebugDate', () => {
  it('returns empty date when no raw value provided', () => {
    expect(validateDailyFritzDebugDate(undefined, true)).toEqual({ ok: true, date: '' });
    expect(validateDailyFritzDebugDate('', true)).toEqual({ ok: true, date: '' });
  });

  it('rejects debug date in production', () => {
    const result = validateDailyFritzDebugDate('2026-08-01', false);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects malformed date in non-production', () => {
    expect(validateDailyFritzDebugDate('08-01-2026', true)).toMatchObject({ ok: false, status: 400 });
    expect(validateDailyFritzDebugDate('2026/08/01', true)).toMatchObject({ ok: false, status: 400 });
    expect(validateDailyFritzDebugDate('not-a-date', true)).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts a valid YYYY-MM-DD date in non-production', () => {
    const result = validateDailyFritzDebugDate('2026-08-01', true);
    expect(result).toEqual({ ok: true, date: '2026-08-01' });
  });

  it('trims whitespace before validating', () => {
    expect(validateDailyFritzDebugDate('  2026-08-01  ', true)).toEqual({ ok: true, date: '2026-08-01' });
  });
});
