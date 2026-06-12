export type DailyFritzAttemptStatus = 'started' | 'completed' | 'abandoned';

export class DailyFritzApiError extends Error {
  readonly statusCode: number;
  readonly attemptStatus?: DailyFritzAttemptStatus;

  constructor(message: string, statusCode: number, attemptStatus?: unknown) {
    super(message);
    this.name = 'DailyFritzApiError';
    this.statusCode = statusCode;
    if (attemptStatus === 'started' || attemptStatus === 'completed' || attemptStatus === 'abandoned') {
      this.attemptStatus = attemptStatus;
    }
  }
}

export const DAILY_FRITZ_ABANDONED_PRIMARY_COPY =
  "Today's set was already abandoned on this account.";

export const DAILY_FRITZ_ABANDONED_SECONDARY_COPY =
  'Come back tomorrow for a fresh Daily Fritz set.';

export const DAILY_FRITZ_ABANDONED_QA_HINT =
  "QA: use a fresh QA user or reset today's daily_fritz_attempts row.";

export interface DailyFritzAbandonedHubCopy {
  primary: string;
  secondary: string;
  qaHint: string | null;
}

export function isDailyFritzQaDevEnv(): boolean {
  return import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';
}

export function isDailyFritzAbandonedAttemptStatus(
  status: DailyFritzAttemptStatus | 'none' | null | undefined,
): boolean {
  return status === 'abandoned';
}

export function isDailyFritzAttemptLockedAbandoned(error: unknown): boolean {
  if (error instanceof DailyFritzApiError) {
    return error.attemptStatus === 'abandoned';
  }
  return false;
}

export function formatDailyFritzAbandonedHubCopy(options?: {
  includeQaHint?: boolean;
}): DailyFritzAbandonedHubCopy {
  const includeQaHint = options?.includeQaHint ?? isDailyFritzQaDevEnv();
  return {
    primary: DAILY_FRITZ_ABANDONED_PRIMARY_COPY,
    secondary: DAILY_FRITZ_ABANDONED_SECONDARY_COPY,
    qaHint: includeQaHint ? DAILY_FRITZ_ABANDONED_QA_HINT : null,
  };
}

export function friendlyDailyFritzInitError(error: unknown): string {
  if (isDailyFritzAttemptLockedAbandoned(error)) {
    return DAILY_FRITZ_ABANDONED_PRIMARY_COPY;
  }
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim();
    const lower = message.toLowerCase();
    if (lower.includes('unauthorized') || lower.includes('sign in')) {
      return 'Please sign in again to play Daily Fritz.';
    }
    if (lower.includes('already locked')) {
      return message;
    }
    if (lower.includes('timed out') || lower.includes('longer than expected') || lower.includes('waking')) {
      return 'The game server may be waking up.';
    }
    if (lower.includes('failed to fetch') || lower.includes('network')) {
      return 'Please try again.';
    }
    return message;
  }
  return 'Please try again.';
}
