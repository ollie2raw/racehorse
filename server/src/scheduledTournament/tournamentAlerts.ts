import * as Sentry from '@sentry/node';
import { childLogger } from '../logger';

const log = childLogger('tournament:alerts');

/**
 * Sentry rate limit for repeating tournament failure alerts. A failure that
 * recurs every scheduler tick (30 s) would otherwise send ~2,880 events a day.
 *
 * Per key: the first failure is sent, then at most one every
 * ALERT_RESEND_INTERVAL_MS while it keeps failing. `clearAlert` (the step
 * later succeeded) forgets the key, so a new failure is sent at once. A key not
 * seen for ALERT_ENTRY_TTL_MS is dropped on the next call. Callers keep logging
 * every failure; this only decides which ones also go to Sentry.
 */
export const ALERT_RESEND_INTERVAL_MS = 10 * 60_000;
export const ALERT_ENTRY_TTL_MS = 60 * 60_000;

const entries = new Map<string, { lastSentMs: number; lastSeenMs: number }>();

function pruneExpired(nowMs: number): void {
  for (const [key, entry] of entries) {
    if (nowMs - entry.lastSeenMs >= ALERT_ENTRY_TTL_MS) entries.delete(key);
  }
}

/** Record a failure for `key`; true when it should also go to Sentry. */
export function shouldSendAlert(key: string, nowMs: number = Date.now()): boolean {
  pruneExpired(nowMs);
  const entry = entries.get(key);
  if (entry && nowMs - entry.lastSentMs < ALERT_RESEND_INTERVAL_MS) {
    entry.lastSeenMs = nowMs;
    return false;
  }
  entries.set(key, { lastSentMs: nowMs, lastSeenMs: nowMs });
  return true;
}

/** The step behind `key` succeeded: its next failure alerts immediately. */
export function clearAlert(key: string): void {
  entries.delete(key);
}

/** Test-only. */
export function resetAlertThrottleForTests(): void {
  entries.clear();
}

export type TournamentStep = 'recovery' | 'reconcile' | 'start_dispatch' | 'event_expiry';

const matchStepAlertKey = (step: TournamentStep, matchId: string) => `match-step:${step}:${matchId}`;
const tournamentStepAlertKey = (step: TournamentStep, tournamentId: string) => `tournament-step:${step}:${tournamentId}`;

/**
 * One match failed in a per-match loop (boot recovery, no-show reconcile,
 * start-time dispatch). The loop carries on with the other matches; this makes
 * the failure visible. Every failure is logged; Sentry gets the first and then
 * at most one per 10 minutes per (step, match) (see above). Fingerprinted
 * per match and step, like the engine invariant alerts.
 */
export function alertTournamentMatchStepFailed(
  step: TournamentStep,
  match: { id: string; tournament_id: string; room_code: string | null },
  err: unknown,
): void {
  const code = err instanceof Error ? err.message : String(err);
  log.error({ step, matchId: match.id, tournamentId: match.tournament_id, roomCode: match.room_code, err }, `tournament ${step} failed for one match`);
  if (!shouldSendAlert(matchStepAlertKey(step, match.id))) return;
  Sentry.captureMessage(`[tournament] ${step} failed for a match`, {
    level: 'error',
    fingerprint: ['tournament-match-step-failed', step, match.id],
    tags: {
      tournament_alert: `${step}_failed`,
      tournament_id: match.tournament_id,
      match_id: match.id,
      error_code: code,
    },
    extra: { matchId: match.id, tournamentId: match.tournament_id, roomCode: match.room_code, error: code },
  });
}

/** The same, for a whole tournament failing in a per-tournament loop (e.g. its matches could not be read). */
export function alertTournamentStepFailed(step: TournamentStep, tournamentId: string, err: unknown): void {
  const code = err instanceof Error ? err.message : String(err);
  log.error({ step, tournamentId, err }, `tournament ${step} failed for one tournament`);
  if (!shouldSendAlert(tournamentStepAlertKey(step, tournamentId))) return;
  Sentry.captureMessage(`[tournament] ${step} failed for a tournament`, {
    level: 'error',
    fingerprint: ['tournament-step-failed', step, tournamentId],
    tags: {
      tournament_alert: `${step}_failed`,
      tournament_id: tournamentId,
      error_code: code,
    },
    extra: { tournamentId, error: code },
  });
}

/** A step succeeded for this match: a later failure alerts immediately again. */
export function clearTournamentMatchStepAlert(step: TournamentStep, matchId: string): void {
  clearAlert(matchStepAlertKey(step, matchId));
}

/** A step succeeded for this tournament. */
export function clearTournamentStepAlert(step: TournamentStep, tournamentId: string): void {
  clearAlert(tournamentStepAlertKey(step, tournamentId));
}

/**
 * A tournament anomaly that is not a failed step: the state is wrong, not the
 * attempt (e.g. an in-progress match whose live game is missing, an automatic
 * turn that made no progress). Logged every time; Sentry gets the first and then
 * at most one per 10 minutes per (kind, match or room).
 */
export function alertTournamentAnomaly(
  kind: string,
  subject: { tournamentId?: string | null; matchId?: string | null; roomCode?: string | null },
  extra: Record<string, unknown> = {},
): void {
  log.error({ kind, ...subject, ...extra }, `tournament anomaly: ${kind}`);
  if (!shouldSendAlert(`anomaly:${kind}:${subject.matchId ?? subject.roomCode ?? subject.tournamentId ?? ''}`)) return;
  Sentry.captureMessage(`[tournament] ${kind}`, {
    level: 'error',
    fingerprint: ['tournament-anomaly', kind, subject.matchId ?? subject.roomCode ?? subject.tournamentId ?? 'unknown'],
    tags: {
      tournament_alert: kind,
      tournament_id: subject.tournamentId ?? undefined,
      match_id: subject.matchId ?? undefined,
      room_code: subject.roomCode ?? undefined,
    },
    extra: { ...subject, ...extra },
  });
}
