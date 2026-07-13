import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';

type Props = { ghost: PlayerIdentityModel['ghost'] };
const value = (number: number | null) => number == null ? '—' : number.toLocaleString();

export function GhostPerformanceSection({ ghost }: Props) {
  const available = [ghost.rating, ghost.gamesPlayed, ghost.wins, ghost.losses, ghost.winRate, ghost.bestWinMargin].some((item) => item != null);
  if (!available) return null;
  return <section className="stats-analysis-card stats-analysis-card--ghost" aria-labelledby="stats-ghost-title"><div className="stats-section-heading"><p className="stats-eyebrow stats-eyebrow--purple">Ghost performance</p><h2 id="stats-ghost-title">Practice under pressure</h2></div><div className="stats-fact-grid stats-fact-grid--cards"><span><b>{value(ghost.rating)}</b> rating</span><span><b>{value(ghost.gamesPlayed)}</b> games</span><span><b>{ghost.wins == null || ghost.losses == null ? '—' : `${ghost.wins}W – ${ghost.losses}L`}</b> record</span><span><b>{ghost.winRate == null ? '—' : `${ghost.winRate.toFixed(1)}%`}</b> win rate</span><span><b>{ghost.bestWinMargin == null ? '—' : `${ghost.bestWinMargin} pts`}</b> best win</span></div></section>;
}
