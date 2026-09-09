/**
 * SA-4 (HARDENING_PLAN.md §11.3): guards `/api/ghost/complete` against a
 * genuinely concurrent double-completion for the same verified match — a
 * double-submit, a flaky client retry, or two tabs racing the same
 * `matchId`. Same shape as `dailyFritzAttemptLock.ts`'s
 * `withDailyFritzAttemptLock`, ported directly: a per-key promise-chain
 * mutex is the right tool here because this deployment is structurally
 * single-instance (Render free tier, `HARDENING_PLAN.md` D-2 addendum) — an
 * in-process lock closes the race completely at this scale, the same call
 * this codebase already made for Daily Fritz. Kept in its own file (rather
 * than sharing Daily Fritz's Map) so a ghost matchId and a Daily Fritz
 * attemptId can never collide on the same key space, even though both are
 * UUIDs from independent generators and never would in practice.
 */
const completionTails = new Map<string, Promise<void>>();

export async function withGhostCompletionLock<T>(
  matchId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = completionTails.get(matchId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  completionTails.set(matchId, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (completionTails.get(matchId) === tail) {
      completionTails.delete(matchId);
    }
  }
}

export function getGhostCompletionLockCountForTests(): number {
  return completionTails.size;
}
