import {
  isTerminalTournamentMatch,
  readTournamentTerminalCompletedAt,
} from './terminalMatches';
import type {
  BracketView,
  Registration,
  ScheduledTournament,
  TournamentAssignedMatch,
  TournamentMatch,
  TournamentUserPhase,
} from './types';
import { resolveTournamentPlayerName } from './displayNames';

/** Mirrors server scheduledTournament/activeWindow.ts */
export const TOURNAMENT_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const TOURNAMENT_BRACKET_AUTO_KICK_MS = 3 * 60 * 1000;

export type BracketTerminalKind =
  | 'live'
  | 'final_complete'
  | 'tournament_completed'
  | 'tournament_cancelled'
  | 'tournament_expired';

export type BracketTerminalState = {
  kind: BracketTerminalKind;
  suppressJoin: boolean;
  showFinalResult: boolean;
  title: string;
  detail: string;
  championName: string | null;
  runnerUpName: string | null;
  yourPlacementLabel: string | null;
  completedAtMs: number | null;
  shouldAutoKickToHub: boolean;
};

export function isClientTournamentPastActiveWindow(
  tournament: Pick<ScheduledTournament, 'status' | 'scheduled_start' | 'winner_id'>,
  nowMs = Date.now(),
): boolean {
  if (tournament.status !== 'in_progress') return false;
  if (tournament.winner_id) return false;
  const scheduledStartMs = Date.parse(tournament.scheduled_start);
  if (!Number.isFinite(scheduledStartMs)) return false;
  return scheduledStartMs < nowMs - TOURNAMENT_ACTIVE_WINDOW_MS;
}

function isMatchLive(match: TournamentMatch): boolean {
  if (match.status === 'completed' || match.status === 'bye') return false;
  if (match.winner_id || match.completed_at) return false;
  if (isTerminalTournamentMatch(match.id)) return false;
  return match.status === 'ready' || match.status === 'in_progress';
}

function finalMatch(bracket: BracketView): TournamentMatch | null {
  return bracket.matches.find((m) => m.round === 3) ?? null;
}

function placementLabel(regs: Registration[], userId: string | null): string | null {
  if (!userId) return null;
  const reg = regs.find((r) => r.user_id === userId);
  if (!reg) return null;
  if (reg.status === 'winner') return 'Champion';
  if (reg.placement === 1) return 'Champion';
  if (reg.placement === 2) return 'Runner-up';
  if (reg.status === 'eliminated') return 'Eliminated';
  return null;
}

function namesForFinal(
  match: TournamentMatch,
  regs: Registration[],
): { championName: string | null; runnerUpName: string | null } {
  const championId = match.winner_id;
  if (!championId) {
    return { championName: null, runnerUpName: null };
  }
  const runnerUpId =
    championId === match.player1_id ? match.player2_id : match.player1_id;
  return {
    championName: resolveTournamentPlayerName(championId, {
      username: regs.find((r) => r.user_id === championId)?.username,
      botTier: match.bot_tier,
      round: 3,
    }),
    runnerUpName: runnerUpId
      ? resolveTournamentPlayerName(runnerUpId, {
          username: regs.find((r) => r.user_id === runnerUpId)?.username,
          botTier: match.bot_tier,
          round: 3,
        })
      : null,
  };
}

export function deriveBracketTerminalState(input: {
  bracket: BracketView | null;
  userId: string | null;
  tournamentPhase: TournamentUserPhase | null;
  assignedMatch: TournamentAssignedMatch | null;
  nowMs?: number;
}): BracketTerminalState {
  const nowMs = input.nowMs ?? Date.now();
  const liveDefault: BracketTerminalState = {
    kind: 'live',
    suppressJoin: false,
    showFinalResult: false,
    title: '',
    detail: '',
    championName: null,
    runnerUpName: null,
    yourPlacementLabel: null,
    completedAtMs: null,
    shouldAutoKickToHub: false,
  };

  const bracket = input.bracket;
  if (!bracket) return { ...liveDefault, suppressJoin: true };

  const tournament = bracket.tournament;
  const regs = bracket.registrations;
  const userId = input.userId;
  const storedCompletedAt = readTournamentTerminalCompletedAt(tournament.id);

  if (tournament.status === 'cancelled') {
    return {
      kind: 'tournament_cancelled',
      suppressJoin: true,
      showFinalResult: false,
      title: 'Tournament cancelled',
      detail: 'This event did not finish. Head back to the tournament home for the next schedule.',
      championName: null,
      runnerUpName: null,
      yourPlacementLabel: placementLabel(regs, userId),
      completedAtMs: storedCompletedAt,
      shouldAutoKickToHub: shouldKickToHub(storedCompletedAt, nowMs),
    };
  }

  if (isClientTournamentPastActiveWindow(tournament, nowMs)) {
    return {
      kind: 'tournament_expired',
      suppressJoin: true,
      showFinalResult: false,
      title: 'Tournament expired',
      detail: 'This bracket is no longer active. Return to the tournament home.',
      championName: null,
      runnerUpName: null,
      yourPlacementLabel: placementLabel(regs, userId),
      completedAtMs: storedCompletedAt,
      shouldAutoKickToHub: true,
    };
  }

  if (
    tournament.status === 'completed' ||
    input.tournamentPhase === 'completed' ||
    Boolean(tournament.winner_id)
  ) {
    const fin = finalMatch(bracket);
    const { championName, runnerUpName } = fin
      ? namesForFinal(fin, regs)
      : {
          championName: tournament.winner_id
            ? resolveTournamentPlayerName(tournament.winner_id, {
                username: regs.find((r) => r.user_id === tournament.winner_id)?.username,
                round: 3,
              })
            : null,
          runnerUpName: null,
        };
    const completedAtMs =
      storedCompletedAt ??
      (fin?.completed_at ? Date.parse(fin.completed_at) : null) ??
      null;
    return {
      kind: 'tournament_completed',
      suppressJoin: true,
      showFinalResult: Boolean(championName),
      title: 'Tournament complete',
      detail: championName
        ? `${championName} won the bracket.`
        : 'This tournament has ended.',
      championName,
      runnerUpName,
      yourPlacementLabel: placementLabel(regs, userId),
      completedAtMs,
      shouldAutoKickToHub: shouldKickToHub(completedAtMs, nowMs),
    };
  }

  const fin = finalMatch(bracket);
  const finalDone =
    fin &&
    (fin.status === 'completed' || Boolean(fin.winner_id) || Boolean(fin.completed_at));
  if (finalDone && fin) {
    const { championName, runnerUpName } = namesForFinal(fin, regs);
    const completedAtMs =
      storedCompletedAt ??
      (fin.completed_at ? Date.parse(fin.completed_at) : null) ??
      null;
    const youPlayedFinal =
      Boolean(userId) && (fin.player1_id === userId || fin.player2_id === userId);
    return {
      kind: 'final_complete',
      suppressJoin: true,
      showFinalResult: true,
      title: youPlayedFinal
        ? fin.winner_id === userId
          ? 'Tournament champion'
          : 'Runner-up'
        : 'Final complete',
      detail: championName
        ? `${championName} defeated ${runnerUpName ?? 'the field'} in the final.`
        : 'The championship match is complete.',
      championName,
      runnerUpName,
      yourPlacementLabel: placementLabel(regs, userId),
      completedAtMs,
      shouldAutoKickToHub: shouldKickToHub(completedAtMs, nowMs),
    };
  }

  const userLive = userId
    ? bracket.matches.find(
        (m) =>
          (m.player1_id === userId || m.player2_id === userId) && isMatchLive(m),
      ) ?? null
    : null;
  if (
    userLive &&
    (isTerminalTournamentMatch(userLive.id) || userLive.winner_id || userLive.completed_at)
  ) {
    console.log('[tournament:bracket] suppressed join for terminal tournament', {
      matchId: userLive.id,
      tournamentId: tournament.id,
    });
    return {
      kind: 'final_complete',
      suppressJoin: true,
      showFinalResult: false,
      title: 'Match complete',
      detail: 'This match is finished. Return to the tournament home.',
      championName: null,
      runnerUpName: null,
      yourPlacementLabel: placementLabel(regs, userId),
      completedAtMs: storedCompletedAt,
      shouldAutoKickToHub: shouldKickToHub(storedCompletedAt, nowMs),
    };
  }

  const assigned = input.assignedMatch;
  if (
    assigned?.matchId &&
    (isTerminalTournamentMatch(assigned.matchId) || !assigned.roomCode)
  ) {
    console.log('[tournament:bracket] suppressed join for terminal tournament', {
      matchId: assigned.matchId,
      tournamentId: tournament.id,
    });
    return {
      ...liveDefault,
      suppressJoin: true,
    };
  }

  if (input.tournamentPhase === 'eliminated') {
    return {
      ...liveDefault,
      suppressJoin: true,
    };
  }

  return liveDefault;
}

function shouldKickToHub(completedAtMs: number | null, nowMs: number): boolean {
  if (!completedAtMs || !Number.isFinite(completedAtMs)) return false;
  return nowMs >= completedAtMs + TOURNAMENT_BRACKET_AUTO_KICK_MS;
}

export function msUntilBracketAutoKick(completedAtMs: number | null, nowMs = Date.now()): number | null {
  if (!completedAtMs || !Number.isFinite(completedAtMs)) return null;
  const remaining = completedAtMs + TOURNAMENT_BRACKET_AUTO_KICK_MS - nowMs;
  return remaining > 0 ? remaining : 0;
}

export function isTournamentBracketTerminal(
  state: BracketTerminalState,
): boolean {
  return state.kind !== 'live';
}
