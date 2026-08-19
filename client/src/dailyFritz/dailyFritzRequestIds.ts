export const DAILY_FRITZ_REQUEST_ID_HEADER = 'x-racehorse-request-id';

export function createDailyFritzRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `df-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
