/**
 * Daily Fritz API error types, classification and user-facing copy. Split out of
 * `dailyFritz/api.ts` (REFACTOR_OPPORTUNITIES R3) — the error surface, separate
 * from the request calls that throw it.
 */
import type { ApiResult } from '../api/client';
import { throwApiResult } from './dailyFritzMutations';

export function resolveDailyFritzApiError(path: string, error: string, status?: number): Error {
  if (error.startsWith('<!DOCTYPE') || error.startsWith('<html')) {
    return new Error(
      `Daily Fritz backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`,
    );
  }
  return new Error(error || `${path} failed with ${status ?? 'unknown'}`);
}

const DAILY_FRITZ_RECOVERABLE_AUTHORITY_CODES = new Set([
  'fritz_action_mismatch',
  'fritz_state_mismatch',
  'fritz_policy_version_mismatch',
  'fritz_policy_contract_mismatch',
  'missing_fritz_state_digest',
  'stale_revision',
  'command_slot_conflict',
  'missing_game_receipts',
]);

export const DAILY_FRITZ_MISSING_GAME_RECEIPTS_MESSAGE =
  'Earlier Daily Fritz games are missing verification receipts. Resume from an earlier game or contact support.';

export function isRecoverableDailyFritzAuthorityCode(code: string | null | undefined): boolean {
  return Boolean(code && DAILY_FRITZ_RECOVERABLE_AUTHORITY_CODES.has(code));
}

export class DailyFritzAuthorityRecoveryError extends Error {
  readonly status: number | null;
  readonly verifierCode: string;
  readonly authorityRevision: number | null;
  readonly authoritativeState: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number | null,
    verifierCode: string,
    authorityRevision: number | null = null,
    authoritativeState: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'DailyFritzAuthorityRecoveryError';
    this.status = status;
    this.verifierCode = verifierCode;
    this.authorityRevision = authorityRevision;
    this.authoritativeState = authoritativeState;
  }
}

export function throwDailyFritzAuthorityError<T>(result: ApiResult<T>): T {
  if (result.error && result.errorCode && isRecoverableDailyFritzAuthorityCode(result.errorCode)) {
    throw new DailyFritzAuthorityRecoveryError(
      result.error,
      result.status ?? null,
      result.errorCode,
      Number.isInteger(result.errorData?.authority_revision)
        ? Number(result.errorData?.authority_revision)
        : null,
      result.errorData?.authoritative_state && typeof result.errorData.authoritative_state === 'object'
        ? result.errorData.authoritative_state as Record<string, unknown>
        : null,
    );
  }
  if (result.error === DAILY_FRITZ_MISSING_GAME_RECEIPTS_MESSAGE && result.status === 409) {
    throw new DailyFritzAuthorityRecoveryError(
      result.error,
      result.status,
      'missing_game_receipts',
    );
  }
  return throwApiResult(result);
}

export class DailyFritzEndOfRunError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DailyFritzEndOfRunError';
  }
}

/** Production copy for modal; dev keeps the raw message for debugging. */
export function formatDailyFritzNextHandUserMessage(raw: string): string {
  if (import.meta.env.DEV) return raw;
  const lower = raw.toLowerCase();
  if (raw === 'Failed to fetch' || lower.includes('networkerror') || lower.includes('load failed')) {
    return "Couldn't load the next hand. Check connection and retry.";
  }
  if (lower.includes('timed out loading the next daily fritz hand')) {
    return "Couldn't load the next hand. Check connection and retry.";
  }
  return raw.length > 220 ? "Couldn't load the next hand. Check connection and retry." : raw;
}

export class DailyFritzNextHandHttpError extends Error {
  readonly status: number | null;
  readonly verifierCode: string | null;
  readonly authorityRevision: number | null;
  readonly authoritativeState: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number | null,
    verifierCode: string | null = null,
    authorityRevision: number | null = null,
    authoritativeState: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'DailyFritzNextHandHttpError';
    this.status = status;
    this.verifierCode = verifierCode;
    this.authorityRevision = authorityRevision;
    this.authoritativeState = authoritativeState;
  }
}

export function isRetryableDailyFritzNextHandError(error: unknown): boolean {
  if (!(error instanceof DailyFritzNextHandHttpError)) return true;
  return error.status === null || error.status === 408 || error.status === 429 || error.status >= 500;
}
