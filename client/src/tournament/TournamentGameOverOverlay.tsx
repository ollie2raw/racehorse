import GameOverModal from '../components/GameOverModal';
import type { TournamentMatchContext } from '../match/session/tournament/tournamentMatchSessionTypes';
import type { GameState } from '../types';
import { tournamentStageShortLabel, type TournamentPlayerDisplay } from './displayNames';
import { myMatchOutcomeCopy, outcomeHasPlayedScore } from './tournamentOutcomeCopy';
import { nextReadyMatch, outcomeForMatch, useTournamentPostgame } from './TournamentPostgameContext';
import './tournamentMatchHud.css';

/**
 * The end of a tournament match (Phase 3D). Words come from how the match was
 * decided (/my's outcomeKind once it arrives; the finished game until then),
 * so an advance nobody played is never called a win. When the next round is
 * already ready it offers "Join Semifinal" / "Join Final" — a tap, never an
 * automatic join.
 */
export default function TournamentGameOverOverlay({
  state,
  myId,
  tournamentMatch,
  myDisplayName,
  opponent,
  onViewBracket,
  onViewFinalResult,
  onReturnToTournament,
}: {
  state: GameState;
  myId: string;
  tournamentMatch: TournamentMatchContext;
  myDisplayName: string;
  opponent: TournamentPlayerDisplay;
  onViewBracket: () => void;
  onViewFinalResult: () => void;
  onReturnToTournament: () => void;
}) {
  const postgame = useTournamentPostgame();
  const outcome = outcomeForMatch(postgame.myTournaments, tournamentMatch.tournamentId, tournamentMatch.matchId);
  const next = nextReadyMatch(postgame.activeAssignedMatch, tournamentMatch.tournamentId, tournamentMatch.matchId);
  const won = outcome ? outcome.won : state.winnerId === myId;
  const kind = outcome?.outcomeKind ?? 'played';
  const copy = myMatchOutcomeCopy({ round: tournamentMatch.round, won, outcomeKind: kind, opponentLabel: opponent.label });
  const isFinal = tournamentMatch.round === 3;
  const stage = tournamentStageShortLabel(tournamentMatch.round);

  const myScore = state.players[myId]?.score ?? 0;
  const opponentId = state.playerIds.find((pid) => pid !== myId) ?? null;
  const opponentScore = opponentId ? (state.players[opponentId]?.score ?? 0) : 0;
  const tone: 'gold' | 'red' = copy.positive ? 'gold' : 'red';
  const stats = outcomeHasPlayedScore(kind)
    ? [
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone },
        { label: 'Margin', value: `${myScore >= opponentScore ? '+' : '-'}${Math.abs(myScore - opponentScore)}`, tone },
        { label: isFinal ? 'Result' : 'Round', value: isFinal ? (won ? 'Champion' : 'Runner-Up') : stage, tone },
      ]
    : [{ label: isFinal ? 'Result' : 'Round', value: isFinal ? (won ? 'Champion' : 'Runner-Up') : stage, tone }];

  const opponentLabel = (
    <>
      {opponent.label}
      {opponent.badgeLabel ? <span className="tmh-fritz-chip">{opponent.badgeLabel}</span> : null}
    </>
  );

  const actions = next
    ? {
        primaryLabel: postgame.joining ? 'Joining…' : `Join ${tournamentStageShortLabel(next.round)}`,
        onPrimary: () => { if (!postgame.joining) postgame.onJoin(next.matchId); },
        secondaryLabel: 'View Bracket',
        onSecondary: onViewBracket,
        extraActionLabel: 'Return to Tournament',
        onExtraAction: onReturnToTournament,
      }
    : {
        primaryLabel: isFinal ? 'View Final Result' : 'View Bracket',
        onPrimary: isFinal ? onViewFinalResult : onViewBracket,
        secondaryLabel: isFinal ? 'View Bracket' : 'Return to Tournament',
        onSecondary: isFinal ? onViewBracket : onReturnToTournament,
        extraActionLabel: isFinal ? 'Return to Tournament' : undefined,
        onExtraAction: isFinal ? onReturnToTournament : undefined,
      };

  return (
    <GameOverModal
      open
      ariaLabel="Tournament match complete"
      matchKind="multiplayer"
      primaryAccent={isFinal ? 'gold' : 'blue'}
      kicker={isFinal ? 'Tournament Final' : `Tournament ${stage}`}
      title={copy.title}
      subtitle={next ? `${copy.detail} · Your ${tournamentStageShortLabel(next.round)} is ready` : copy.detail}
      tone={tone}
      stats={stats}
      scores={state.playerIds.map((pid) => ({
        label: pid === myId ? myDisplayName : opponentLabel,
        value: state.players[pid]?.score ?? 0,
        winner: pid === state.winnerId,
        showCrown: pid === state.winnerId,
      }))}
      {...actions}
      onClose={onReturnToTournament}
    />
  );
}
