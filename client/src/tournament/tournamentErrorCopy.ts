import type { TournamentApiError } from './tournamentApi';
import { formatEventTime } from './tournamentTime';
/**
 * Server tournament routes reply with machine codes (`invalid_tournament_id`,
 * `not_found`, `not_completed`, …). Those must never reach a user as copy — a
 * shared bracket link for a tournament that has since been cleared, a mistyped
 * URL, or a stale bookmark is an ordinary way to land here.
 *
 * Anything not recognised falls through to a generic message rather than
 * echoing the raw code (FEATURE_COMPLETENESS_AUDIT.md P1-2).
 */
export function tournamentErrorCopy(raw: string | null | undefined): string {
  switch ((raw ?? '').trim()) {
    case 'invalid_tournament_id':
    case 'not_found':
      return 'This tournament could not be found. It may have finished and been cleared, or the link may be out of date.';
    case 'not_completed':
      return 'This tournament has not finished yet — there are no results to show.';
    case 'upstream_timeout':
      return 'The tournament service is taking too long to respond. Try again in a moment.';
    default:
      return 'Something went wrong loading this tournament. Try again in a moment.';
  }
}


type ErrorLike = Pick<TournamentApiError, 'code'> & Partial<Pick<TournamentApiError, 'conflict' | 'retryAfterMs' | 'reason'>>;

function codeOf(err: unknown): string {
  return err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : 'network';
}

/** Registration / withdrawal refusals, for the card they happened on (Phase 3C). */
export function registrationErrorCopy(err: unknown, opts: { timeZone?: string } = {}): string {
  const e = err as ErrorLike;
  switch (codeOf(err)) {
    case 'overlapping_tournament':
      if (e.conflict?.kind === 'fritz_cup') return 'You have a Fritz Cup in progress. Finish it first.';
      if (e.conflict?.scheduledStart) {
        return `You're already entered in the ${formatEventTime(e.conflict.scheduledStart, opts)} Live Event, which overlaps this one.`;
      }
      return "You're already entered in a Live Event that overlaps this one.";
    case 'registration_closed':
      return 'Registration has closed for this event.';
    case 'tournament_full':
      return 'This event is full.';
    case 'withdraw_closed':
      return "Registration has closed, so you can't withdraw now.";
    case 'not_authenticated':
      return 'Sign in to register.';
    default:
      return "Couldn't update your registration. Try again.";
  }
}

/** Fritz Cup start refusals (Phase 3C). `null` for tournaments_disabled: the card is hidden instead. */
export function fritzCupErrorCopy(err: unknown, opts: { timeZone?: string } = {}): string | null {
  const e = err as ErrorLike;
  const seconds = Math.max(1, Math.ceil((e.retryAfterMs ?? 60_000) / 1000));
  switch (codeOf(err)) {
    case 'tournaments_disabled':
      return null;
    case 'rate_limited':
      return `Too many attempts. Try again in ${seconds}s.`;
    case 'fritz_cup_cooldown':
      return e.reason === 'daily_limit'
        ? "That's today's Fritz Cup limit. Try again later."
        : `You just started a Cup. Try again in ${seconds}s.`;
    case 'overlapping_tournament':
      return e.conflict?.scheduledStart
        ? `You're entered in a Live Event at ${formatEventTime(e.conflict.scheduledStart, opts)}. A Fritz Cup now would overlap it.`
        : "You're entered in a Live Event that a Fritz Cup now would overlap.";
    case 'not_authenticated':
      return 'Sign in to play.';
    default:
      return "Couldn't start the Fritz Cup. Try again.";
  }
}
