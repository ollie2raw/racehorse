import type { PlayerIdentityModel } from '../playerIdentityTypes';

type Props = { competitive: PlayerIdentityModel['competitive'] };

const value = (number: number | null) => number == null ? '—' : number.toLocaleString();

export function PlayerCompetitiveSummary({ competitive }: Props) {
  return (
    <section className="identity-section identity-competitive" aria-labelledby="identity-competitive-title">
      <div className="identity-section__heading">
        <p className="identity-eyebrow">Competitive identity</p>
        <h2 id="identity-competitive-title">How they play</h2>
      </div>
      <div className="identity-competitive__lead">
        <div className="identity-rating-block">
          <span className="identity-stat-label">RATING</span>
          <strong>{value(competitive.rating)}</strong>
          {competitive.provisional === true && <span className="identity-provisional">Provisional</span>}
        </div>
        <div className="identity-rating-block identity-rating-block--secondary">
          <span className="identity-stat-label">PEAK RATING</span>
          <strong>{value(competitive.peakRating)}</strong>
        </div>
        {competitive.globalRank != null && (
          <div className="identity-rating-block identity-rating-block--secondary">
            <span className="identity-stat-label">GLOBAL RANK</span>
            <strong>#{competitive.globalRank.toLocaleString()}</strong>
          </div>
        )}
        <div className="identity-rating-block identity-rating-block--secondary">
          <span className="identity-stat-label">WIN RATE</span>
          <strong>{competitive.winRate == null ? '—' : `${competitive.winRate.toFixed(1)}%`}</strong>
        </div>
      </div>
      <div className="identity-fact-row">
        <span><b>{value(competitive.wins)}</b> wins</span>
        <span><b>{value(competitive.losses)}</b> losses</span>
        <span><b>{value(competitive.rankedGames)}</b> ranked games</span>
        <span><b>{value(competitive.currentStreak)}</b> current streak</span>
        <span><b>{value(competitive.bestStreak)}</b> best streak</span>
      </div>
    </section>
  );
}
