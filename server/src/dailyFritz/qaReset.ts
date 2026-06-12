import { isValidUuid } from '../scheduledTournament/persistence';
import { supabaseFetch } from '../supabaseUtils';

type DailyFritzAttemptRow = {
  id: string;
  run_date: string;
  user_id: string;
  status: string;
  verified_match_id: string | null;
};

export type QaDailyFritzResetResult = {
  runDate: string;
  qaUserId: string;
  deleted: boolean;
  previousStatus: string | null;
  attemptId: string | null;
};

export type QaDailyFritzResetDeps = {
  env: NodeJS.ProcessEnv;
  now: Date;
  log: (...args: unknown[]) => void;
  fetchAttempt: (runDate: string, userId: string) => Promise<DailyFritzAttemptRow | null>;
  deleteAttempt: (attemptId: string) => Promise<void>;
  abandonVerifiedMatch: (verifiedMatchId: string, reason: string | null) => Promise<void>;
};

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function isObviousNonLocalSupabaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host.endsWith('.local')) return false;
    return host.endsWith('.supabase.co');
  } catch {
    return true;
  }
}

export function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function resolveQaDailyFritzUserId(env: NodeJS.ProcessEnv): string {
  return env.QA_DAILY_FRITZ_USER_ID?.trim() || env.QA_TOURNAMENT_USER_ID?.trim() || '';
}

export function assertQaDailyFritzResetEnv(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === 'production') {
    throw new Error('qa_daily_fritz_reset_blocked_in_production');
  }
  if (!isTruthyFlag(env.ENABLE_QA_DAILY_FRITZ_RESET)) {
    throw new Error('qa_daily_fritz_reset_requires_ENABLE_QA_DAILY_FRITZ_RESET');
  }
  const qaUserId = resolveQaDailyFritzUserId(env);
  if (!qaUserId) {
    throw new Error('qa_daily_fritz_reset_requires_QA_DAILY_FRITZ_USER_ID');
  }
  if (!isValidUuid(qaUserId)) {
    throw new Error('qa_daily_fritz_reset_requires_valid_QA_DAILY_FRITZ_USER_ID');
  }
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? '';
  if (!supabaseUrl) {
    throw new Error('qa_daily_fritz_reset_requires_SUPABASE_URL');
  }
  if (isObviousNonLocalSupabaseUrl(supabaseUrl) && !isTruthyFlag(env.QA_ALLOW_NONLOCAL_STAGING)) {
    throw new Error('qa_daily_fritz_reset_refused_nonlocal_supabase_without_QA_ALLOW_NONLOCAL_STAGING');
  }
  return qaUserId;
}

function createDefaultDeps(): QaDailyFritzResetDeps {
  return {
    env: process.env,
    now: new Date(),
    log: (...args: unknown[]) => console.log(...args),
    async fetchAttempt(runDate, userId) {
      const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
        `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,verified_match_id&run_date=eq.${encodeURIComponent(runDate)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
        { method: 'GET' },
      );
      return rows[0] ?? null;
    },
    async deleteAttempt(attemptId) {
      await supabaseFetch(`/rest/v1/daily_fritz_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
        method: 'DELETE',
      });
    },
    async abandonVerifiedMatch(verifiedMatchId, reason) {
      await supabaseFetch(
        `/rest/v1/verified_single_player_matches?match_id=eq.${encodeURIComponent(verifiedMatchId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'abandoned',
            completed_at: new Date().toISOString(),
            completion_result: reason ? { reset_reason: reason } : null,
          }),
        },
      ).catch(() => {
        /* verified matches table may be absent in some dev setups */
      });
    },
  };
}

export async function resetDailyFritzQaAttempt(
  input?: {
    runDate?: string;
    userId?: string;
    reason?: string;
    authenticatedUserId?: string | null;
  },
  depsInput?: Partial<QaDailyFritzResetDeps>,
): Promise<QaDailyFritzResetResult> {
  const deps = { ...createDefaultDeps(), ...depsInput } as QaDailyFritzResetDeps;
  const qaUserId = input?.userId?.trim() || assertQaDailyFritzResetEnv(deps.env);
  if (input?.authenticatedUserId && input.authenticatedUserId !== qaUserId) {
    throw new Error('qa_daily_fritz_reset_forbidden_user');
  }
  const runDate = input?.runDate?.trim() || getPacificDateKey(deps.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new Error('qa_daily_fritz_reset_invalid_run_date');
  }

  deps.log('[daily-fritz:qa-reset] start', { runDate, qaUserId });

  const attempt = await deps.fetchAttempt(runDate, qaUserId);
  if (!attempt) {
    const result: QaDailyFritzResetResult = {
      runDate,
      qaUserId,
      deleted: false,
      previousStatus: null,
      attemptId: null,
    };
    deps.log('[daily-fritz:qa-reset] noop', result);
    return result;
  }

  await deps.deleteAttempt(attempt.id);
  if (attempt.verified_match_id) {
    await deps.abandonVerifiedMatch(attempt.verified_match_id, input?.reason?.trim() || 'qa_reset');
  }

  const result: QaDailyFritzResetResult = {
    runDate,
    qaUserId,
    deleted: true,
    previousStatus: attempt.status,
    attemptId: attempt.id,
  };
  deps.log('[daily-fritz:qa-reset] complete', result);
  return result;
}
