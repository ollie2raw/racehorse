import './tournamentMatchBanner.css';

export interface TournamentMatchBannerProps {
  round: 1 | 2 | 3;
  opponentName: string | null;
  opponentRating: number | null;
}

export default function TournamentMatchBanner(props: TournamentMatchBannerProps) {
  const label = props.round === 1 ? 'Quarterfinal' : props.round === 2 ? 'Semifinal' : 'Final';
  return (
    <div className="tmb-banner" role="status" aria-live="polite">
      <div className="tmb-banner__left">
        <span className="tmb-banner__kicker">Tournament</span>
        <span className="tmb-banner__round">{label}</span>
      </div>
      <div className="tmb-banner__opp">
        vs <strong>{props.opponentName ?? 'Opponent'}</strong>
        {props.opponentRating != null ? ` · ${props.opponentRating} ELO` : ''}
      </div>
      <div className="tmb-banner__target">First to 30</div>
    </div>
  );
}
