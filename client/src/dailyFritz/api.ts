import { apiGet, apiPost, type ApiResult } from '../api/client';
import type { BotDealSize, BotHandDeal } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';
import type { Tile } from '../types.ts';
import { normalizePreGameDrawTile } from '../match/preGameDraw/preGameDrawLogic.ts';
// DailyFritzSetGameNumber / DailyFritzDrawWinner / DailyFritzSetGameResult are
// single-sourced from @racehorse/game-core's dtoContracts module (also used by
// server/src/dailyFritz.ts) so the client and server can't silently diverge on
// these shapes.
import type {
  DailyFritzDrawWinner as SharedDailyFritzDrawWinner,
  DailyFritzSetGameNumber as SharedDailyFritzSetGameNumber,
  DailyFritzSetGameResult as SharedDailyFritzSetGameResult,
  DailyFritzSetResult as SharedDailyFritzSetResult,
} from '@racehorse/game-core';

export {
  createDailyFritzRequestId,
  DAILY_FRITZ_REQUEST_ID_HEADER,
} from './dailyFritzRequestIds';
export {
  classifyDailyFritzMutationFailure,
  DAILY_FRITZ_CHECKPOINT_TIMEOUT_MS,
  DAILY_FRITZ_COMPLETE_TIMEOUT_MS,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS,
  timedDailyFritzMutationPost,
  throwApiResult,
  type DailyFritzMutationFailureKind,
} from './dailyFritzMutations';
import {
  createDailyFritzRequestId,
  DAILY_FRITZ_REQUEST_ID_HEADER,
} from './dailyFritzRequestIds';
import {
  DAILY_FRITZ_COMPLETE_TIMEOUT_MS,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS,
  DAILY_FRITZ_CHECKPOINT_TIMEOUT_MS,
  timedDailyFritzMutationPost,
  throwApiResult,
} from './dailyFritzMutations';

export const DAILY_FRITZ_TODAY_CACHE_PREFIX = 'racehorse:daily-fritz:today:';

function dfClientDebug(..._args: unknown[]): void {
  void _args;
}

function dfInitLog(_event: string, _payload?: Record<string, unknown>): void {
  void _event;
  void _payload;
}

function isDailyFritzInitPath(path: string): boolean {
  return path === '/api/daily-fritz/today' || path === '/api/daily-fritz/start';
}

/** Clears only the Daily Fritz "today" hub cache (sessionStorage). */
export function clearDailyFritzTodayCache(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.sessionStorage.removeItem(`${DAILY_FRITZ_TODAY_CACHE_PREFIX}${userId}`);
  } catch {
    /* noop */
  }
}

/** Clears in-match localStorage checkpoints for Daily Fritz. */
export function clearDailyFritzMatchSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith('racehorse:daily-fritz:') && !key.startsWith(DAILY_FRITZ_TODAY_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* noop */
  }
}

/** Clears Daily Fritz today cache + in-match saves. Prefer clearDailyFritzTodayCache on soft retries. */
export function clearDailyFritzClientStorage(userId: string): void {
  clearDailyFritzTodayCache(userId);
  clearDailyFritzMatchSnapshots();
}

function resolveDailyFritzApiError(path: string, error: string, status?: number): Error {
  if (error.startsWith('<!DOCTYPE') || error.startsWith('<html')) {
    return new Error(
      `Daily Fritz backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`,
    );
  }
  return new Error(error || `${path} failed with ${status ?? 'unknown'}`);
}

type RequestJsonOptions = RequestInit & {
  timeoutMs?: number;
};

async function dfRequestJsonWithTimeout<T>(path: string, init?: RequestJsonOptions): Promise<T> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timeoutMs =
    init?.timeoutMs ??
    (isDailyFritzInitPath(path) ? DAILY_FRITZ_INIT_TIMEOUT_MS : undefined);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const requestId = createDailyFritzRequestId();
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  let timedOut = false;

  if (isDailyFritzInitPath(path)) {
    dfInitLog('request-start', { endpoint: path });
  }

  const run = async (): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const requestOptions = {
      signal: controller?.signal ?? init?.signal ?? undefined,
      headers: { [DAILY_FRITZ_REQUEST_ID_HEADER]: requestId },
    };
    const result: ApiResult<T> =
      method === 'POST'
        ? await apiPost<T>(
            path,
            init?.body ? JSON.parse(String(init.body)) : {},
            requestOptions,
          )
        : await apiGet<T>(path, requestOptions);
    const fetchEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dfClientDebug('[daily-fritz-client] requestJson', {
      path,
      status: result.status,
      authMs: Number((fetchStartedAt - startedAt).toFixed(1)),
      fetchMs: Number((fetchEndedAt - fetchStartedAt).toFixed(1)),
      parseMs: Number((endedAt - fetchEndedAt).toFixed(1)),
      totalMs: Number((endedAt - startedAt).toFixed(1)),
    });

    if (result.error) {
      if (controller?.signal.aborted && timedOut) {
        throw new Error('The game server is taking longer than expected. Please try again.');
      }
      throw resolveDailyFritzApiError(path, result.error, result.status);
    }

    if (isDailyFritzInitPath(path)) {
      const initPayload = result.data as Record<string, unknown> | null;
      dfInitLog('request-success', {
        ms: Number((endedAt - startedAt).toFixed(1)),
        status: result.status,
        hasSet: Boolean(initPayload?.set_result ?? initPayload?.result),
        gameNumber: initPayload?.current_game_number ?? null,
        phase: initPayload?.attempt_status ?? null,
        drawWinner: initPayload?.draw_winner ?? null,
        drawPlayerTile: initPayload?.draw_player_tile ?? null,
        drawFritzTile: initPayload?.draw_fritz_tile ?? null,
      });
    }
    return result.data as T;
  };

  try {
    if (timeoutMs && controller) {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    return await run();
  } catch (error) {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = Number((endedAt - startedAt).toFixed(1));
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (controller?.signal.aborted && timedOut)
    ) {
      if (isDailyFritzInitPath(path)) {
        dfInitLog('timeout', { ms: timeoutMs ?? ms, endpoint: path });
      }
      throw new Error('The game server is taking longer than expected. Please try again.');
    }
    if (isDailyFritzInitPath(path)) {
      dfInitLog('request-error', {
        ms,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

async function timedApiGet<T>(path: string): Promise<ApiResult<T>> {
  const start = performance.now();
  const result = await apiGet<T>(path);
  dfClientDebug('[daily-fritz-client] request', {
    path,
    ms: Number((performance.now() - start).toFixed(1)),
    ok: result.error === null,
    status: result.status,
  });
  return result;
}

async function timedApiPost<T>(path: string, body: unknown, timeoutMs?: number): Promise<ApiResult<T>> {
  return timedDailyFritzMutationPost<T>(path, body, timeoutMs);
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

function throwDailyFritzAuthorityError<T>(result: ApiResult<T>): T {
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

export interface DailyFritzLeaderboardRow {
  rank: number;
  username: string;
  won: boolean;
  finalScore: number;
  opponentScore: number;
  pointDiff: number;
  movesUsed: number;
  completedAt: string;
  games?: Array<{
    gameNumber: DailyFritzSetGameNumber;
    playerScore: number;
    fritzScore: number;
    playerWon: boolean;
    pointDiff: number;
    skunk?: boolean;
    skunkBy?: 'player' | 'fritz';
  }>;
  is_current_user?: boolean;
}
export type DailyFritzVerificationStatus = 'in_progress' | 'pending_verification' | 'verified' | 'rejected' | 'legacy_unverified';

export type DailyFritzClientNextAction =
  | 'play_hand'
  | 'between_games'
  | 'finalize_set'
  | 'view_results'
  | 'locked';
export type DailyFritzServerNextAction =
  | DailyFritzClientNextAction
  | 'start_set'
  | 'resume_hand';
export type DailyFritzHistoryEntry = { challenge_date: string; player_score: number; fritz_score: number; won: boolean; completed_at: string | null; verification_status: DailyFritzVerificationStatus };
export async function getDailyFritzHistory(limit = 5): Promise<DailyFritzHistoryEntry[]> {
  const result = await apiGet<{ ok: true; results: DailyFritzHistoryEntry[] }>(`/api/daily-fritz/history?limit=${Math.max(1,Math.min(10,Math.floor(limit)))}`);
  if (result.error) throw new Error(result.error);
  return result.data?.results ?? [];
}

export type DailyFritzSetGameNumber = SharedDailyFritzSetGameNumber;

export type DailyFritzDrawWinner = SharedDailyFritzDrawWinner;

export type DailyFritzSetGameResult = SharedDailyFritzSetGameResult;

// Extends the shared base shape with legacy snake_case fields some older
// server responses still include.
export interface DailyFritzSetResult extends SharedDailyFritzSetResult {
  run_date?: string;
  final_score?: number;
  opponent_score?: number;
  point_diff?: number;
  won?: boolean;
  moves_used?: number;
  hands_played?: number;
}

export interface DailyFritzTodayResponse {
  ok: true;
  run_date: string;
  challenge_id?: string;
  rules_version?: number;
  seed_version?: number;
  time_zone?: 'America/Los_Angeles';
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  attempt_status: 'none' | 'started' | 'completed' | 'abandoned';
  authority_revision?: number | null;
  next_action?: DailyFritzServerNextAction;
  current_game_number: DailyFritzSetGameNumber | null;
  needs_completion?: boolean;
  streak: number;
  result: Record<string, unknown> | null;
  set_result: DailyFritzSetResult | null;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
  verification_protocol_version?: number;
  verification_status?: DailyFritzVerificationStatus;
  game_rules_version?: number;
  fritz_policy_version?: number;
  fritz_policy_contract?: string;
  state_digest_version?: number;
  state_digest_required?: boolean;
  verifier_version?: number;
  competitive_verification_available?: boolean;
}

export interface DailyFritzStartResponse {
  ok: true;
  attempt_id: string;
  verified_match_id: string;
  authority_revision?: number;
  run_date: string;
  challenge_id?: string;
  rules_version?: number;
  seed_version?: number;
  run_fingerprint?: string;
  verification_protocol_version?: number;
  game_rules_version?: number;
  fritz_policy_version?: number;
  fritz_policy_contract?: string;
  state_digest_version?: number;
  state_digest_required?: boolean;
  authority_client_release?: string | null;
  verifier_version?: number;
  time_zone?: 'America/Los_Angeles';
  verification_status?: DailyFritzVerificationStatus;
  next_action?: DailyFritzServerNextAction;
  current_hand_index: number;
  current_game_scores?: { you: number; fritz: number };
  current_game_number?: DailyFritzSetGameNumber | null;
  needs_completion?: boolean;
  set_result: DailyFritzSetResult | null;
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  first_hand: BotHandDeal;
  draw_winner: DailyFritzDrawWinner;
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
  /** Present for asynchronous fixed-deal Fritz challenges. */
  challenge_code?: string;
  /** Server-persisted mid-hand resume checkpoint when local storage is empty. */
  resume_checkpoint?: Record<string, unknown> | null;
}

export interface DailyFritzNextHandResponse {
  ok: true;
  run_date: string;
  game_number?: DailyFritzSetGameNumber;
  current_game_number?: DailyFritzSetGameNumber | null;
  set_result?: DailyFritzSetResult | null;
  current_hand_index: number;
  authority_revision?: number;
  current_game_scores: { you: number; fritz: number };
  hand: BotHandDeal;
  draw_winner: DailyFritzDrawWinner;
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
  replayed?: boolean;
  ignored?: boolean;
}

export interface DailyFritzCompleteResponse {
  ok: true;
  replayed?: boolean;
  authority_revision?: number;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
}

export interface DailyFritzRecordGameResponse {
  ok: true;
  replayed?: boolean;
  authority_revision?: number;
  set_result: DailyFritzSetResult;
  next_game_number: DailyFritzSetGameNumber | null;
  /** True when the game was recorded before async verification finished. */
  verification_pending?: boolean;
}

export interface DailyFritzLeaderboardResponse {
  ok: true;
  run_date: string;
  leaderboard: DailyFritzLeaderboardRow[];
}

function normalizeDailyFritzDrawWinner(value: unknown): DailyFritzDrawWinner | null {
  return value === 'you' || value === 'bot' ? value : null;
}

function normalizeDailyFritzStartDrawFields(
  payload: DailyFritzStartResponse,
): DailyFritzStartResponse {
  const drawPlayerTile = normalizePreGameDrawTile(payload.draw_player_tile);
  const drawFritzTile = normalizePreGameDrawTile(payload.draw_fritz_tile);
  const drawWinner = normalizeDailyFritzDrawWinner(payload.draw_winner);
  return {
    ...payload,
    ...(drawPlayerTile ? { draw_player_tile: drawPlayerTile } : {}),
    ...(drawFritzTile ? { draw_fritz_tile: drawFritzTile } : {}),
    ...(drawWinner ? { draw_winner: drawWinner } : {}),
  };
}

export async function getTodayDailyFritz(options?: {
  timeoutMs?: number;
}): Promise<DailyFritzTodayResponse> {
  return dfRequestJsonWithTimeout<DailyFritzTodayResponse>('/api/daily-fritz/today', {
    method: 'GET',
    timeoutMs: options?.timeoutMs,
  });
}

export async function startDailyFritz(options?: {
  timeoutMs?: number;
}): Promise<DailyFritzStartResponse> {
  const core = await import('@racehorse/game-core');
  const response = throwApiResult(
    await timedApiPost<DailyFritzStartResponse>('/api/daily-fritz/start', {
      verification_protocol_version: core.DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      game_rules_version: core.GAME_RULES_VERSION,
      fritz_policy_version: core.FRITZ_POLICY_VERSION,
      fritz_policy_contract: core.getFritzPolicyContract(core.FRITZ_POLICY_VERSION),
      state_digest_version: core.DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
      supported_transcript_protocol_versions: [1, core.DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
      supported_fritz_policies: ([1, 2] as const).map((version) => ({
        version,
        contract: core.getFritzPolicyContract(version),
      })),
      supported_state_digest_versions: [core.DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
      client_release: import.meta.env.VITE_APP_VERSION ?? 'unknown',
    }, options?.timeoutMs ?? DAILY_FRITZ_INIT_TIMEOUT_MS),
  );
  const normalized = normalizeDailyFritzStartDrawFields(response);
  return normalized;
}

export type DailyFritzCheckpointSaveResponse = {
  ok: true;
  checkpoint_revision: number;
  authority_revision: number;
};

export async function saveDailyFritzCheckpoint(input: {
  attemptId: string;
  verifiedMatchId: string;
  checkpoint: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<DailyFritzCheckpointSaveResponse | null> {
  try {
    return await dfRequestJsonWithTimeout<DailyFritzCheckpointSaveResponse>(
      '/api/daily-fritz/checkpoint',
      {
        method: 'POST',
        body: JSON.stringify({
          attempt_id: input.attemptId,
          verified_match_id: input.verifiedMatchId,
          checkpoint: input.checkpoint,
        }),
        timeoutMs: input.timeoutMs ?? DAILY_FRITZ_CHECKPOINT_TIMEOUT_MS,
      },
    );
  } catch {
    return null;
  }
}

export async function fetchDailyFritzLeaderboard(date: string): Promise<DailyFritzLeaderboardRow[]> {
  const response = throwApiResult(
    await timedApiGet<DailyFritzLeaderboardResponse>(`/api/daily-fritz/leaderboard/${date}`),
  );
  return response.leaderboard;
}

/**
 * Thrown when the server signals there are no more hands left in this Daily
 * Fritz run (HTTP 409 "No hands remain…").  This is a terminal, non-retryable
 * condition — the client must transition to match-complete, not show an error.
 */
export class DailyFritzEndOfRunError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DailyFritzEndOfRunError';
  }
}

const DAILY_FRITZ_NEXT_HAND_DEBUG_INGEST =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

function dfNextHandIngest(payload: {
  location: string;
  message: string;
  hypothesisId?: string;
  data?: Record<string, unknown>;
  runId?: string;
}): void {
  if (!DAILY_FRITZ_NEXT_HAND_DEBUG_INGEST) return;
  void import('../devtools/dailyFritzDebugIngest').then((module) => {
    module.ingestDailyFritzNextHandDebug(payload);
  });
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

export async function nextDailyFritzHand(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber?: DailyFritzSetGameNumber;
  completedHandIndex: number;
  transcript: import('@racehorse/game-core').DailyFritzTranscript | null;
  completedHandScores: { you: number; fritz: number };
  /**
   * Set once the player has failed to get this hand verified repeatedly. The
   * server then advances the run WITHOUT a verification receipt and marks it
   * unranked, rather than leaving the player stuck on Hand Over. The scores
   * are sent alongside the transcript here because the server needs them to
   * carry progress forward when the transcript will not replay.
   */
  unverifiedFallback?: { attempts: number } | null;
  timeoutMs?: number;
}): Promise<DailyFritzNextHandResponse> {
  const path = '/api/daily-fritz/next-hand';
  const timeoutMs = Math.max(1000, input.timeoutMs ?? DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS);
  dfNextHandIngest({
    location: 'dailyFritz/api.ts:nextDailyFritzHand',
    message: 'request-start',
    hypothesisId: 'B',
    data: {
      url: path,
      timeoutMs,
      completedHandIndex: input.completedHandIndex,
      gameNumber: input.gameNumber ?? 1,
    },
  });

  let result: ApiResult<DailyFritzNextHandResponse>;
  try {
    result = await timedApiPost<DailyFritzNextHandResponse>(
      path,
      {
        attempt_id: input.attemptId,
        verified_match_id: input.verifiedMatchId,
        run_date: input.runDate,
        game_number: input.gameNumber ?? 1,
        completed_hand_index: input.completedHandIndex,
        ...(input.transcript ? { transcript: input.transcript } : {}),
        completed_hand_scores: input.completedHandScores,
        ...(input.unverifiedFallback
          ? {
              unverified_fallback: true,
              verification_attempts: input.unverifiedFallback.attempts,
            }
          : {}),
      },
      timeoutMs,
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    dfNextHandIngest({
      location: 'dailyFritz/api.ts:nextDailyFritzHand',
      message: 'fetch-rejected',
      hypothesisId: 'B',
      data: { url: path, errorName: name, errorMessage: message, isAbort: name === 'AbortError' },
    });
    if (import.meta.env.DEV) {
      console.warn('[daily-fritz:next-hand] request failed', { url: path, name, message });
    }
    throw error;
  }

  dfNextHandIngest({
    location: 'dailyFritz/api.ts:nextDailyFritzHand',
    message: 'response',
    hypothesisId: 'B',
    data: { url: path, status: result.status, ok: result.error === null },
  });

  if (result.status === 408) {
    throw new Error(`Timed out loading the next Daily Fritz hand after ${timeoutMs}ms.`);
  }

  const parsedError = result.error ?? '';

  // Only the terminal no-hands-remain 409 means the game is complete. Other
  // conflicts are real hand-transition errors and must not auto-complete a set.
  if (result.status === 409) {
    const message = parsedError || 'No hands remain in this Daily Fritz run.';
    if (!String(message).toLowerCase().includes('no hands remain')) {
      throw new DailyFritzNextHandHttpError(
        message,
        result.status,
        result.errorCode ?? null,
        Number.isInteger(result.errorData?.authority_revision)
          ? Number(result.errorData?.authority_revision)
          : null,
        result.errorData?.authoritative_state && typeof result.errorData.authoritative_state === 'object'
          ? result.errorData.authoritative_state as Record<string, unknown>
          : null,
      );
    }
    throw new DailyFritzEndOfRunError(message);
  }

  if (result.error) {
    dfNextHandIngest({
      location: 'dailyFritz/api.ts:nextDailyFritzHand',
      message: 'http-non-ok',
      hypothesisId: 'B',
      data: {
        url: path,
        status: result.status,
        verifierCode: result.errorCode ?? null,
        error: parsedError || null,
        bodySnippet: parsedError.slice(0, 240),
      },
    });
    if (import.meta.env.DEV) {
      console.warn('[daily-fritz:next-hand] non-OK response', {
        url: path,
        status: result.status,
        verifierCode: result.errorCode ?? null,
        error: parsedError || null,
      });
    }
    throw new DailyFritzNextHandHttpError(
      parsedError || `${path} failed with ${result.status ?? 'unknown'}`,
      result.status ?? null,
      result.errorCode ?? null,
      Number.isInteger(result.errorData?.authority_revision)
        ? Number(result.errorData?.authority_revision)
        : null,
      result.errorData?.authoritative_state && typeof result.errorData.authoritative_state === 'object'
        ? result.errorData.authoritative_state as Record<string, unknown>
        : null,
    );
  }

  return result.data as DailyFritzNextHandResponse;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildDailyFritzCompletionHash(input: {
  runDate: string;
  attemptId: string;
  verifiedMatchId: string;
  currentHandIndex: number;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      runDate: input.runDate,
      attemptId: input.attemptId,
      verifiedMatchId: input.verifiedMatchId,
      currentHandIndex: input.currentHandIndex,
      finalScore: input.finalScore,
      opponentScore: input.opponentScore,
      won: input.won,
      movesUsed: input.movesUsed,
      handsPlayed: input.handsPlayed,
      moveLog: input.moveLog,
    }),
  );
}

export async function completeDailyFritz(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  completionHash: string;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
  setResult?: DailyFritzSetResult | null;
}): Promise<DailyFritzCompleteResponse> {
  return throwApiResult(
    await timedApiPost<DailyFritzCompleteResponse>('/api/daily-fritz/complete', {
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      run_date: input.runDate,
      completion_hash: input.completionHash,
      final_score: input.finalScore,
      opponent_score: input.opponentScore,
      won: input.won,
      moves_used: input.movesUsed,
      hands_played: input.handsPlayed,
      move_log: input.moveLog,
      set_result: input.setResult ?? null,
    }, DAILY_FRITZ_COMPLETE_TIMEOUT_MS),
  );
}

export async function recordDailyFritzGame(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  transcript: import('@racehorse/game-core').DailyFritzTranscript | null;
  playerScore: number;
  fritzScore: number;
  movesUsed: number;
  handsPlayed: number;
}): Promise<DailyFritzRecordGameResponse> {
  return throwDailyFritzAuthorityError(
    await timedApiPost<DailyFritzRecordGameResponse>('/api/daily-fritz/record-game', {
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      run_date: input.runDate,
      game_number: input.gameNumber,
      player_score: input.playerScore,
      fritz_score: input.fritzScore,
      moves_used: input.movesUsed,
      hands_played: input.handsPlayed,
      ...(input.transcript ? { transcript: input.transcript } : {}),
    }, DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS),
  );
}

export async function abandonDailyFritz(attemptId: string): Promise<void> {
  throwApiResult(await timedApiPost<{ ok: true }>('/api/daily-fritz/abandon', { attempt_id: attemptId }));
}

export type DailyFritzClientTelemetryEvent =
  | 'mode_impression'
  | 'start_requested'
  | 'first_move'
  | 'recovery_started'
  | 'recovery_succeeded'
  | 'recovery_failed'
  | 'review_opened'
  | 'leaderboard_opened'
  | 'share_requested'
  | 'share_completed';

/** Analytics is intentionally best-effort and can never block gameplay authority. */
export async function recordDailyFritzTelemetry(input: {
  eventId: string;
  eventType: DailyFritzClientTelemetryEvent;
  attemptId?: string | null;
  runDate?: string | null;
  challengeId?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
  failureCode?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await timedApiPost<{ ok: true }>('/api/daily-fritz/telemetry', {
      event_id: input.eventId,
      event_type: input.eventType,
      attempt_id: input.attemptId ?? null,
      run_date: input.runDate ?? null,
      challenge_id: input.challengeId ?? null,
      session_id: input.sessionId ?? null,
      duration_ms: input.durationMs ?? null,
      failure_code: input.failureCode ?? null,
      client_release: import.meta.env.VITE_APP_VERSION ?? 'unknown',
      payload: input.payload ?? {},
    });
  } catch {
    // Telemetry never changes the official run or surfaces an error to players.
  }
}
