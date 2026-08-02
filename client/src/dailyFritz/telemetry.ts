const SESSION_PREFIX = 'racehorse:daily-fritz:telemetry-session:';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getDailyFritzTelemetrySession(runDate: string): string {
  const key = `${SESSION_PREFIX}${runDate}`;
  if (typeof window === 'undefined') return `server-${randomId()}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = randomId();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return randomId();
  }
}

export function dailyFritzTelemetryEventId(
  scope: string,
  eventType: string,
  suffix = 'once',
): string {
  return `${scope}:${eventType}:${suffix}`.slice(0, 160);
}
