/**
 * App-wide "your match is ready" banner (Phase 3D): which match it is about,
 * and how (or whether) a screen shows it. Showing the banner never joins
 * anything; Join is always a tap, and never offered over another game.
 */
import type { AppMode } from '../types';
import type { MatchReadyEvent, TournamentAssignedPlayable } from './types';

export type ReadyBannerMatch = { matchId: string; tournamentId: string; round: 1 | 2 | 3; roomCode: string | null };

/**
 * The ready match, from authority first: /my's playable assignment when it is
 * `ready`. A `match_ready` push counts only until a /my sent after it answers
 * (that /my is then the truth — joined, gone, or still ready). Cancelled
 * tournaments never show.
 */
export function selectReadyBannerMatch(input: {
  activeAssignedMatch: TournamentAssignedPlayable | null;
  pendingMatch: MatchReadyEvent | null;
  pendingMatchAtMono: number;
  myRequestedAtMono: number;
  cancelledTournamentIds: ReadonlySet<string>;
}): ReadyBannerMatch | null {
  const { activeAssignedMatch: a, pendingMatch: p } = input;
  if (a) {
    if (a.matchStatus !== 'ready' || input.cancelledTournamentIds.has(a.tournamentId)) return null;
    return { matchId: a.matchId, tournamentId: a.tournamentId, round: a.round, roomCode: a.roomCode };
  }
  if (p && p.matchStatus === 'ready' && input.pendingMatchAtMono > input.myRequestedAtMono && !input.cancelledTournamentIds.has(p.tournamentId)) {
    return { matchId: p.matchId, tournamentId: p.tournamentId, round: p.round, roomCode: p.roomCode };
  }
  return null;
}

/** Screens that are themselves a game: leaving one would abandon it. */
const GAME_MODES: ReadonlySet<AppMode> = new Set<AppMode>([
  'bot',
  'ghost',
  'dailyFritz',
  'puzzleRush',
  'noBrainer',
  'guidedMatchRecorder',
]);

export type ReadyBannerMode =
  /** Nothing to show (no match, dismissed, or this screen already offers Join). */
  | 'hidden'
  /** Show with a Join button. */
  | 'join'
  /** The player is in another game: show it, but no Join (finish or leave that game first). */
  | 'in_game';

export function readyBannerMode(input: {
  match: ReadyBannerMatch | null;
  dismissedMatchIds: ReadonlySet<string>;
  appMode: AppMode;
  tournamentSubView: 'hub' | 'bracket' | 'result' | 'history';
  activeTournamentId: string | null;
  /** The room the player is seated in, if any. */
  joinedRoom: string | null;
  /** The tournament match the player is (or was just) playing, if any. */
  currentTournamentMatch: { tournamentId: string; matchId: string } | null;
  /** The joined room's game is over (a post-game screen is showing). */
  liveGameOver: boolean;
}): ReadyBannerMode {
  const { match } = input;
  if (!match || input.dismissedMatchIds.has(match.matchId)) return 'hidden';

  if (input.joinedRoom) {
    const current = input.currentTournamentMatch;
    // Already in this match.
    if (current?.matchId === match.matchId) return 'hidden';
    // The post-game of this tournament's previous round offers its own Join.
    if (current?.tournamentId === match.tournamentId && input.liveGameOver) return 'hidden';
    return 'in_game';
  }

  if (input.appMode === 'tournament') {
    // The Hub's card offers Join for the playable match; the bracket's Your
    // Path and the result screen offer it for their own tournament.
    if (input.tournamentSubView === 'hub') return 'hidden';
    if (input.activeTournamentId === match.tournamentId) return 'hidden';
    return 'join';
  }

  return GAME_MODES.has(input.appMode) ? 'in_game' : 'join';
}
