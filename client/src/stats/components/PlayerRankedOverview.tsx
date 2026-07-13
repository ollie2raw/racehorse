import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';

type Props = { competitive: PlayerIdentityModel['competitive']; username: string | null };
const number = (value: number | null) => value == null ? '—' : value.toLocaleString();

export function PlayerRankedOverview({ competitive, username }: Props) {
  return <section className="stats-analysis-card stats-ranked-overview" aria-labelledby="stats-ranked-overview-title"><p className="stats-eyebrow">{username ? `@${username} / ranked overview` : 'Ranked overview'}</p><h1 id="stats-ranked-overview-title">Performance at the table</h1><div className="stats-ranked-lead"><div><span className="stats-stat-label">CURRENT RATING</span><strong>{number(competitive.rating)}</strong>{competitive.provisional === true && <span className="stats-provisional">Provisional</span>}</div><div><span className="stats-stat-label">PEAK RATING</span><b>{number(competitive.peakRating)}</b></div>{competitive.globalRank != null && <div><span className="stats-stat-label">GLOBAL RANK</span><b>#{competitive.globalRank.toLocaleString()}</b></div>}<div><span className="stats-stat-label">RANKED GAMES</span><b>{number(competitive.rankedGames)}</b></div></div></section>;
}
