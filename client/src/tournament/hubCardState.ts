/**
 * Tournament Hub card states (Phase 3C): one place that turns server state
 * into what a card shows. Server status is authoritative; the (server-clock)
 * time only decides which side of a stored boundary we are on, for display.
 */
import type { FritzLaunchState } from './useTournament';
import type {
  MyTournament,
  ScheduledTournament,
  TournamentAssignedPlayable,
  TournamentFeatures,
} from './types';

export type LiveEventCardState =
  | { kind: 'not_open'; opensAt: string; startsAt: string }
  | { kind: 'open'; closesAt: string; startsAt: string }
  | { kind: 'full'; startsAt: string }
  | { kind: 'registered'; startsAt: string; canWithdraw: boolean }
  | { kind: 'closed'; startsAt: string; underway: boolean }
  | { kind: 'bracket_set'; startsAt: string }
  | { kind: 'starting' }
  | { kind: 'match_ready'; matchId: string; round: 1 | 2 | 3 }
  | { kind: 'in_match'; matchId: string; round: 1 | 2 | 3 }
  | { kind: 'advanced' }
  | { kind: 'eliminated'; placementLabel: string | null; exitRound: 1 | 2 | 3 | null }
  | { kind: 'champion' }
  | { kind: 'cancelled' }
  | { kind: 'finished' };

export function deriveLiveEventCardState(input: {
  event: ScheduledTournament;
  mine: MyTournament | null;
  playable: TournamentAssignedPlayable | null;
  cancelled: boolean;
  nowMs: number;
}): LiveEventCardState {
  const { event, mine, nowMs } = input;
  const status = mine?.status ?? event.status;
  if (status === 'cancelled' || input.cancelled) return { kind: 'cancelled' };

  const playable = input.playable && input.playable.tournamentId === event.id ? input.playable : null;
  if (playable) {
    return playable.matchStatus === 'in_progress'
      ? { kind: 'in_match', matchId: playable.matchId, round: playable.round }
      : { kind: 'match_ready', matchId: playable.matchId, round: playable.round };
  }

  const closeMs = Date.parse(event.registration_close_at);
  const startMs = Date.parse(event.scheduled_start);
  const reg = mine?.myRegistration.status ?? null;

  if (reg === 'winner') return { kind: 'champion' };
  if (reg === 'eliminated') {
    return { kind: 'eliminated', placementLabel: mine?.myRegistration.placementLabel ?? null, exitRound: mine?.myLastMatch?.round ?? null };
  }
  if (reg === 'registered' || reg === 'active') {
    if (status === 'in_progress') {
      if (nowMs < startMs) return { kind: 'bracket_set', startsAt: event.scheduled_start };
      return mine?.myLastMatch?.won ? { kind: 'advanced' } : { kind: 'starting' };
    }
    if (status === 'completed') return { kind: 'finished' };
    return { kind: 'registered', startsAt: event.scheduled_start, canWithdraw: status === 'registration_open' && nowMs < closeMs };
  }

  // Not entered.
  if (status === 'completed') return { kind: 'finished' };
  if (status === 'in_progress') return { kind: 'closed', startsAt: event.scheduled_start, underway: nowMs >= startMs };
  if (status === 'registration_open' && nowMs < closeMs) {
    const count = event.registered_count ?? 0;
    return count >= event.max_players
      ? { kind: 'full', startsAt: event.scheduled_start }
      : { kind: 'open', closesAt: event.registration_close_at, startsAt: event.scheduled_start };
  }
  if (status === 'upcoming' && nowMs < closeMs) {
    // Before its opening time — or just past it, until the server opens it.
    return { kind: 'not_open', opensAt: event.registration_open_at, startsAt: event.scheduled_start };
  }
  return { kind: 'closed', startsAt: event.scheduled_start, underway: nowMs >= startMs };
}

/**
 * The Live Events the hub shows: the player's own unfinished (or just
 * cancelled) Live Events and the public schedule, by start time. The first
 * is the primary card; at most one more is shown.
 */
export function selectHubLiveEvents(input: {
  upcoming: readonly ScheduledTournament[];
  myTournaments: readonly MyTournament[];
  nowMs: number;
}): Array<{ event: ScheduledTournament; mine: MyTournament | null }> {
  const mineById = new Map(input.myTournaments.filter((t) => (t.kind ?? 'live') === 'live').map((t) => [t.id, t] as const));
  const rows = new Map<string, { event: ScheduledTournament; mine: MyTournament | null }>();
  for (const t of mineById.values()) {
    const held = t.myRegistration.status === 'registered' || t.myRegistration.status === 'active';
    const relevant = t.status === 'in_progress' || t.status === 'registration_open' || t.status === 'upcoming'
      // A just-finished or just-cancelled event the player was in (until /my drops it).
      || ((t.status === 'cancelled' || t.status === 'completed') && Date.parse(t.scheduled_start) > input.nowMs - 3 * 60 * 60_000);
    if (relevant && (held || t.status === 'cancelled' || t.status === 'completed')) rows.set(t.id, { event: t, mine: t });
  }
  for (const t of input.upcoming) {
    if ((t.kind ?? 'live') !== 'live' || rows.has(t.id)) continue;
    if (t.status === 'cancelled' || t.status === 'completed') continue;
    rows.set(t.id, { event: t, mine: mineById.get(t.id) ?? null });
  }
  return [...rows.values()]
    .sort((a, b) => Date.parse(a.event.scheduled_start) - Date.parse(b.event.scheduled_start))
    .slice(0, 2);
}

export type FritzCupCardState =
  | { kind: 'hidden' }
  | { kind: 'sign_in' }
  | { kind: 'play' }
  | { kind: 'starting' }
  | { kind: 'building' }
  | { kind: 'slow'; tournamentId: string | null }
  | { kind: 'failed'; launch: FritzLaunchState }
  | { kind: 'join'; tournamentId: string; matchId: string; round: 1 | 2 | 3 }
  | { kind: 'resume'; tournamentId: string; matchId: string; round: 1 | 2 | 3 }
  | { kind: 'waiting'; tournamentId: string; round: 1 | 2 | 3 | null };

export function deriveFritzCupCardState(input: {
  features: TournamentFeatures | null;
  signedIn: boolean;
  myTournaments: readonly MyTournament[];
  playable: TournamentAssignedPlayable | null;
  launch: FritzLaunchState;
}): FritzCupCardState {
  const { features, signedIn, myTournaments, playable, launch } = input;
  const activeCup = myTournaments.find(
    (t) => t.kind === 'fritz_cup'
      && (t.status === 'in_progress' || t.status === 'registration_open')
      && (t.myRegistration.status === 'active' || t.myRegistration.status === 'registered'),
  ) ?? null;

  // A cup in progress is always reachable (even if new cups are switched off).
  if (activeCup) {
    if (playable && playable.tournamentId === activeCup.id) {
      if (playable.matchStatus === 'in_progress') return { kind: 'resume', tournamentId: activeCup.id, matchId: playable.matchId, round: playable.round };
      if (launch.phase === 'creating' || launch.phase === 'building') return { kind: 'building' };
      return { kind: 'join', tournamentId: activeCup.id, matchId: playable.matchId, round: playable.round };
    }
    if (launch.phase === 'slow') return { kind: 'slow', tournamentId: activeCup.id };
    if (launch.phase === 'creating' || launch.phase === 'building') return { kind: 'building' };
    const last = activeCup.myLastMatch;
    return { kind: 'waiting', tournamentId: activeCup.id, round: last ? (Math.min(3, last.round + (last.won ? 1 : 0)) as 1 | 2 | 3) : null };
  }

  if (!features?.tournaments || !features.fritzCup) return { kind: 'hidden' };
  if (!signedIn) return { kind: 'sign_in' };
  if (launch.phase === 'creating') return { kind: 'starting' };
  if (launch.phase === 'building') return { kind: 'building' };
  if (launch.phase === 'slow') return { kind: 'slow', tournamentId: launch.tournamentId };
  if (launch.phase === 'failed') return { kind: 'failed', launch };
  return { kind: 'play' };
}
