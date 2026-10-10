import { tournamentPlayerDisplay, type TournamentPlayerDisplay } from './displayNames';
import { estimatedServerNowMs } from './tournamentClock';
import { myMatchOutcomeCopy, type MatchOutcomeCopy } from './tournamentOutcomeCopy';
import type { MyTournament, ScheduledTournament, TournamentAssignedPlayable, TournamentResultView } from './types';

/**
 * What the result screen shows (Phase 3D): the champion through the shared
 * display helper (a Fritz champion is "Master Fritz" with a Fritz chip, never
 * "—" or an id), the player's own outcome in words from /my's outcomeKind, the
 * next Live Event (counted down on the server clock by the screen), and a
 * ready next match of this tournament — offered, never joined.
 */
export function deriveResultView(input: {
  tournamentId: string;
  result: TournamentResultView | null;
  myTournaments: MyTournament[];
  upcoming: ScheduledTournament[];
  activeAssignedMatch: TournamentAssignedPlayable | null;
  nowServerMs?: number;
}): {
  champion: TournamentPlayerDisplay | null;
  myOutcome: MatchOutcomeCopy | null;
  nextEventStart: string | null;
  nextMatch: { matchId: string; round: 1 | 2 | 3 } | null;
} {
  const { result } = input;
  const champion = result?.championId ? championDisplay(result) : null;

  const mine = input.myTournaments.find((t) => t.id === input.tournamentId) ?? null;
  const last = mine?.myLastMatch ?? null;
  const opponentName = last?.opponentId
    ? result?.placements.find((p) => p.userId === last.opponentId)?.username ?? null
    : null;
  const myOutcome = last
    ? myMatchOutcomeCopy({
        round: last.round,
        won: last.won,
        outcomeKind: last.outcomeKind,
        opponentLabel: last.opponentId
          ? tournamentPlayerDisplay(last.opponentId, { username: opponentName, botTier: last.opponentBotTier, round: last.round }).label
          : null,
      })
    : null;

  const now = input.nowServerMs ?? estimatedServerNowMs();
  const nextEventStart = input.upcoming
    .filter((t) => (t.kind ?? 'live') === 'live' && t.status !== 'cancelled' && Date.parse(t.scheduled_start) > now)
    .map((t) => t.scheduled_start)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

  const a = input.activeAssignedMatch;
  const nextMatch = a && a.tournamentId === input.tournamentId && a.matchStatus === 'ready' ? { matchId: a.matchId, round: a.round } : null;

  return { champion, myOutcome, nextEventStart, nextMatch };
}

/** The server names a Fritz champion ("Master Fritz"); a missing flag still never shows an id. */
function championDisplay(result: TournamentResultView): TournamentPlayerDisplay {
  const display = tournamentPlayerDisplay(result.championId, {
    username: result.championName,
    botTier: result.championFritzTier ?? null,
    round: 3,
  });
  return display.isFritz && result.championName ? { ...display, label: result.championName } : display;
}
