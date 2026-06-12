import { supabaseFetch } from '../supabaseUtils';

type DailyFritzAttemptRow = {
  id: string;
  run_date: string;
  user_id: string;
  status: string;
  verified_match_id: string | null;
};

export type RestartDailyFritzUnsafeDeps = {
  now: Date;
  getPacificDateKey: (date?: Date) => string;
  fetchAttempt: (runDate: string, userId: string) => Promise<DailyFritzAttemptRow | null>;
  deleteAttempt: (attemptId: string) => Promise<void>;
  abandonVerifiedMatch: (verifiedMatchId: string) => Promise<void>;
};

export type RestartDailyFritzUnsafeInput = {
  attemptId: string;
  authenticatedUserId: string;
  runDate?: string;
};

export type RestartDailyFritzUnsafeResult = {
  ok: true;
  attemptId: string;
  runDate: string;
};

function createDefaultDeps(): RestartDailyFritzUnsafeDeps {
  const getPacificDateKey = (date: Date = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);

  return {
    now: new Date(),
    getPacificDateKey,
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
    async abandonVerifiedMatch(verifiedMatchId) {
      await supabaseFetch(
        `/rest/v1/verified_single_player_matches?match_id=eq.${encodeURIComponent(verifiedMatchId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'abandoned',
            completed_at: new Date().toISOString(),
            completion_result: { reset_reason: 'daily_fritz_unsafe_restart' },
          }),
        },
      ).catch(() => {
        /* verified matches table may be absent in some dev setups */
      });
    },
  };
}

export async function restartDailyFritzUnsafeAttempt(
  input: RestartDailyFritzUnsafeInput,
  depsInput?: Partial<RestartDailyFritzUnsafeDeps>,
): Promise<RestartDailyFritzUnsafeResult> {
  const attemptId = input.attemptId?.trim();
  const authenticatedUserId = input.authenticatedUserId?.trim();
  if (!attemptId) {
    throw new Error('daily_fritz_restart_requires_attempt_id');
  }
  if (!authenticatedUserId) {
    throw new Error('daily_fritz_restart_requires_authenticated_user');
  }

  const deps = { ...createDefaultDeps(), ...depsInput } as RestartDailyFritzUnsafeDeps;
  const runDate = input.runDate?.trim() || deps.getPacificDateKey(deps.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new Error('daily_fritz_restart_invalid_run_date');
  }

  const attempt = await deps.fetchAttempt(runDate, authenticatedUserId);
  if (!attempt || attempt.id !== attemptId) {
    throw new Error('daily_fritz_restart_attempt_not_found');
  }
  if (attempt.status !== 'started') {
    throw new Error(`daily_fritz_restart_attempt_locked:${attempt.status}`);
  }

  await deps.deleteAttempt(attempt.id);
  if (attempt.verified_match_id) {
    await deps.abandonVerifiedMatch(attempt.verified_match_id);
  }

  return { ok: true, attemptId: attempt.id, runDate };
}
