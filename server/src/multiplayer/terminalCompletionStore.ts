import { childLogger } from '../logger';
import { supabaseFetch } from '../supabaseUtils';
import type { CompletionRecoveryState } from './roomLivePersistence';

const log = childLogger('terminal-completion-store');

/** Lightweight projection: never selects game_state, events or the shell. */
export type StrandedTerminalCandidate = {
  room_code: string;
  match_id: string;
  status: 'game_over' | 'abandoned';
  updated_at: string;
};

export type StrandedScanCursor = { updatedAt: string; roomCode: string };

const q = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Terminal sessions that still owe a completion, oldest first.
 *
 *  - `completionPending=true` (rows written by this version), or an unlogged `game_over`
 *    row with no flag at all (written by an older server), and
 *  - not quarantined, not tournament-owned, and not touched since `cutoffIso`.
 *
 * `updated_at` is bumped by every failed replay, so a failing row moves to the back of the
 * queue instead of starving younger rows, and is retried no sooner than the cutoff allows.
 */
export function strandedTerminalScanPath(options: {
  cutoffIso: string;
  limit: number;
  after?: StrandedScanCursor;
}): string {
  const owes = [
    'room_shell->>completionPending.eq.true',
    'and(status.eq.game_over,room_shell->>completionPending.is.null,or(room_shell->>matchLogged.is.null,room_shell->>matchLogged.neq.true))',
  ].join(',');
  const clauses = [
    `or(${owes})`,
    'room_shell->completionRecovery->>quarantinedAt.is.null',
  ];
  if (options.after) {
    clauses.push(
      `or(updated_at.gt.${options.after.updatedAt},and(updated_at.eq.${options.after.updatedAt},room_code.gt.${q(options.after.roomCode)}))`,
    );
  }
  const params = new URLSearchParams({
    select: 'room_code,match_id,status,updated_at',
    status: 'in.(game_over,abandoned)',
    source_type: 'neq.tournament',
    updated_at: `lt.${options.cutoffIso}`,
    order: 'updated_at.asc,room_code.asc',
    limit: String(options.limit),
    and: `(${clauses.join(',')})`,
  });
  return `/rest/v1/room_live_sessions?${params.toString()}`;
}

export async function scanStrandedTerminalSessions(options: {
  cutoffIso: string;
  limit: number;
  after?: StrandedScanCursor;
}): Promise<StrandedTerminalCandidate[]> {
  const rows = await supabaseFetch<StrandedTerminalCandidate[]>(strandedTerminalScanPath(options), {
    method: 'GET',
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(rows) ? rows : [];
}

type ShellRow = { room_shell: Record<string, unknown> | null; updated_at: string };

/**
 * Compare-and-set on the stored shell. `updated_at` is the version: a concurrent writer (a
 * live room rewriting its snapshot) changes it, the PATCH then touches zero rows, and the
 * caller sees `false` and re-evaluates rather than clobbering newer state.
 */
export async function patchTerminalShell(
  roomCode: string,
  matchId: string,
  mutate: (shell: Record<string, unknown>) => Record<string, unknown>,
  options: { bumpUpdatedAt?: boolean } = {},
): Promise<boolean> {
  const code = encodeURIComponent(roomCode.trim().toUpperCase());
  const match = encodeURIComponent(matchId);
  const rows = await supabaseFetch<ShellRow[]>(
    `/rest/v1/room_live_sessions?select=room_shell,updated_at&room_code=eq.${code}&match_id=eq.${match}&limit=1`,
    { method: 'GET', headers: { Prefer: 'return=representation' } },
  );
  const row = rows?.[0];
  if (!row) return false;
  const next = mutate({ ...(row.room_shell ?? {}) });
  const body: Record<string, unknown> = { room_shell: next };
  if (options.bumpUpdatedAt) body.updated_at = new Date().toISOString();
  const patched = await supabaseFetch<Array<{ room_code: string }>>(
    `/rest/v1/room_live_sessions?room_code=eq.${code}&match_id=eq.${match}&updated_at=eq.${encodeURIComponent(row.updated_at)}&select=room_code`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    },
  );
  return Array.isArray(patched) && patched.length === 1;
}

/** Flip the durable marker once completion is logged (idempotent, CAS with one retry). */
export async function markTerminalCompletionLogged(roomCode: string, matchId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ok = await patchTerminalShell(roomCode, matchId, (shell) => {
      const { completionRecovery: _drop, ...rest } = shell;
      return { ...rest, matchLogged: true, completionPending: false };
    });
    if (ok) return true;
  }
  log.warn({ roomCode, matchId }, 'could not mark terminal completion logged (row changed or gone)');
  return false;
}

/** Record a failed replay; bumps `updated_at` (backoff + fairness) and quarantines past the ceiling. */
export async function recordTerminalReplayFailure(
  roomCode: string,
  matchId: string,
  error: string,
  options: { maxAttempts: number; quarantineNow?: boolean; transient?: boolean },
): Promise<{ attempts: number; quarantined: boolean } | null> {
  let result: { attempts: number; quarantined: boolean } | null = null;
  const nowIso = new Date().toISOString();
  const ok = await patchTerminalShell(
    roomCode,
    matchId,
    (shell) => {
      const previous = shell.completionRecovery as Partial<CompletionRecoveryState> | undefined;
      const priorAttempts = typeof previous?.attempts === 'number' ? previous.attempts : 0;
      const priorTransient = typeof previous?.transientFailures === 'number' ? previous.transientFailures : 0;
      // An infrastructure failure (outage, 5xx, timeout, missing schema mid-rollout) is not evidence
      // that the row is bad: it only backs the row off (updated_at) and is counted separately, so a
      // long outage can never march a legitimately recoverable completion into quarantine.
      const attempts = options.transient ? priorAttempts : priorAttempts + 1;
      const quarantined = !options.transient && (options.quarantineNow === true || attempts >= options.maxAttempts);
      result = { attempts, quarantined };
      const recovery: CompletionRecoveryState = {
        attempts,
        lastAttemptAt: nowIso,
        lastError: error.slice(0, 500),
        ...(options.transient || priorTransient > 0 ? { transientFailures: priorTransient + (options.transient ? 1 : 0) } : {}),
        ...(quarantined ? { quarantinedAt: nowIso } : {}),
      };
      return { ...shell, completionRecovery: recovery };
    },
    { bumpUpdatedAt: true },
  );
  return ok ? result : null;
}

/** Delete a resolved terminal row. Conditional: a still-owing or newer-match row is never removed. */
export async function deleteResolvedTerminalSession(roomCode: string, matchId: string): Promise<boolean> {
  const code = encodeURIComponent(roomCode.trim().toUpperCase());
  const match = encodeURIComponent(matchId);
  const deleted = await supabaseFetch<Array<{ room_code: string }>>(
    `/rest/v1/room_live_sessions?room_code=eq.${code}&match_id=eq.${match}&room_shell->>matchLogged=eq.true&status=in.(game_over,abandoned)&select=room_code`,
    { method: 'DELETE', headers: { Prefer: 'return=representation' } },
  );
  return Array.isArray(deleted) && deleted.length > 0;
}
