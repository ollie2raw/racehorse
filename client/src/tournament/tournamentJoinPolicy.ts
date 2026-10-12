/**
 * When the client may join a tournament match without a tap (Phase 3C).
 *
 * Joining starts the server's 45-second turn clock, so a match is joined only
 * when the player asked for it:
 *
 *  - A `ready` match (the player has not joined it yet) is never joined
 *    automatically — not on `tournament:match_ready`, not on socket reconnect
 *    or foreground recovery, not when /my reports it. The hub (and later an
 *    app-wide banner) offers Join Match.
 *  - An `in_progress` match from /my (that is: this player already joined it)
 *    is restored automatically — but never by pulling the player out of a
 *    different game they are in now.
 *  - Play Fritz Cup is an explicit request to play now: while that launch is
 *    still pending (FRITZ_LAUNCH_INTENT_MS) the first ready match OF THAT CUP
 *    may be joined, whether it comes in the create response or in its
 *    match_ready. Any other tournament's match ends the intent. Only the
 *    first round: after a round ends, the next one (Semifinal, Final) is
 *    always a tap — a finished match is a natural break before another
 *    turn clock starts (Phase 3D).
 *
 * A socket match_ready never auto-joins on its own status: only /my knows
 * whether THIS player joined.
 */

export const FRITZ_LAUNCH_INTENT_MS = 30_000;

/** Play Fritz Cup was tapped; `tournamentId` is known once the create response arrives. */
export type FritzLaunchIntent = {
  startedAtMono: number;
  tournamentId: string | null;
};

export type AutoAttachSource = 'my' | 'match_ready' | 'fritz_create';

export type AutoAttachInput = {
  source: AutoAttachSource;
  match: { matchId: string; tournamentId: string; matchStatus: 'ready' | 'in_progress'; round?: 1 | 2 | 3 };
  launchIntent: FritzLaunchIntent | null;
  nowMono: number;
  /** The player is in a different live game (another room) right now. */
  inOtherGame: boolean;
};

export type AutoAttachDecision =
  | { attach: true; reason: 'restore_in_progress' | 'fritz_launch' }
  | { attach: false; reason: 'ready_needs_tap' | 'in_other_game' | 'socket_not_authoritative' | 'awaiting_cup_id' };

export function isFritzLaunchIntentLive(intent: FritzLaunchIntent | null, nowMono: number): intent is FritzLaunchIntent {
  return Boolean(intent) && nowMono - intent!.startedAtMono < FRITZ_LAUNCH_INTENT_MS;
}

export function decideTournamentAutoAttach(input: AutoAttachInput): AutoAttachDecision {
  const { source, match, launchIntent, nowMono, inOtherGame } = input;
  if (inOtherGame) return { attach: false, reason: 'in_other_game' };

  if (isFritzLaunchIntentLive(launchIntent, nowMono)) {
    if (launchIntent.tournamentId === null) {
      // The cup's id is not known yet (create still in flight): wait for it.
      return { attach: false, reason: 'awaiting_cup_id' };
    }
    const firstRound = match.round === undefined || match.round === 1;
    if (launchIntent.tournamentId === match.tournamentId && firstRound) return { attach: true, reason: 'fritz_launch' };
  }

  if (source === 'my' && match.matchStatus === 'in_progress') return { attach: true, reason: 'restore_in_progress' };
  if (source === 'match_ready') return { attach: false, reason: match.matchStatus === 'ready' ? 'ready_needs_tap' : 'socket_not_authoritative' };
  return { attach: false, reason: 'ready_needs_tap' };
}

/**
 * Whether an arriving match ends a live launch intent: a match of another
 * tournament (the intent is for one cup only).
 */
export function matchEndsFritzLaunchIntent(intent: FritzLaunchIntent | null, matchTournamentId: string): boolean {
  return Boolean(intent && intent.tournamentId !== null && intent.tournamentId !== matchTournamentId);
}
