/**
 * Validates and resolves a debug date override for Daily Fritz routes.
 * Both /today (query param) and /start (body param) use this logic.
 * allowsTestFixtureDate = NODE_ENV !== 'production' && DAILY_FRITZ_TEST_FIXTURES_ENABLED === 'true'
 */
export function validateDailyFritzDebugDate(
  raw: unknown,
  allowsTestFixtureDate: boolean,
): { ok: true; date: string } | { ok: false; status: 400; error: string } {
  const date = typeof raw === 'string' ? raw.trim() : '';
  if (!date) return { ok: true, date: '' };
  if (!allowsTestFixtureDate) {
    return { ok: false, status: 400, error: 'debug date requires an enabled non-production fixture environment.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: 'debug date must be in YYYY-MM-DD format.' };
  }
  return { ok: true, date };
}
