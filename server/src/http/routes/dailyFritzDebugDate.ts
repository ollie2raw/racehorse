/**
 * Validates and resolves a debug date override for Daily Fritz routes.
 * Both /today (query param) and /start (body param) use this logic.
 * isDevLike = process.env.NODE_ENV !== 'production'
 */
export function validateDailyFritzDebugDate(
  raw: unknown,
  isDevLike: boolean,
): { ok: true; date: string } | { ok: false; status: 400; error: string } {
  const date = typeof raw === 'string' ? raw.trim() : '';
  if (!date) return { ok: true, date: '' };
  if (!isDevLike) {
    return { ok: false, status: 400, error: 'debug date is only available outside production.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: 'debug date must be in YYYY-MM-DD format.' };
  }
  return { ok: true, date };
}
