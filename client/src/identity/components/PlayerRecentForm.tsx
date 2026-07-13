import type { PlayerIdentityModel } from '../playerIdentityTypes';

type Props = { competitive: PlayerIdentityModel['competitive'] };

function timeAgo(isoDate: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(isoDate).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PlayerRecentForm({ competitive }: Props) {
  if (competitive.recentForm.length === 0 && competitive.recentMatches.length === 0) return null;
  return (
    <section className="identity-section" aria-labelledby="identity-form-title">
      <div className="identity-section__heading identity-section__heading--inline"><div><p className="identity-eyebrow">Recent form</p><h2 id="identity-form-title">The last few tables</h2></div><div className="identity-form-markers" aria-label={`Recent form: ${competitive.recentForm.join(', ') || 'unavailable'}`}>{competitive.recentForm.map((result, index) => <span key={`${result}-${index}`} className={`identity-form-marker identity-form-marker--${result}`}>{result === 'win' ? 'W' : 'L'}</span>)}</div></div>
      {competitive.recentMatches.length > 0 && <div className="identity-match-list">{competitive.recentMatches.map((match, index) => <div className="identity-match-row" key={`${match.playedAt}-${match.opponentUsername}-${index}`}><span className={`identity-match-result identity-match-result--${match.result}`}>{match.result === 'win' ? 'WIN' : 'LOSS'}</span><span className="identity-match-opponent">vs {match.opponentUsername}</span><span className="identity-match-score">{match.score != null && match.opponentScore != null ? `${match.score} – ${match.opponentScore}` : 'Score unavailable'}</span><span className="identity-match-mode">{match.mode}</span><time dateTime={match.playedAt}>{timeAgo(match.playedAt)}</time></div>)}</div>}
    </section>
  );
}
