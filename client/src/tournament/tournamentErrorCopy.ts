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
