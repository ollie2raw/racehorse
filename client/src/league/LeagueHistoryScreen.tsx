import type { LeagueHistoryResponse, LeagueHistorySeason } from './types';

interface LeagueHistoryScreenProps {
  history: LeagueHistoryResponse;
  onBack: () => void;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

function seasonOutcome(entry: LeagueHistorySeason): { label: string; className: string } {
  if (entry.promoted) return { label: 'PROMOTED', className: 'is-promoted' };
  if (entry.relegated) return { label: 'RELEGATED', className: 'is-relegated' };
  return { label: 'STAYED', className: 'is-stayed' };
}

export default function LeagueHistoryScreen({ history, onBack }: LeagueHistoryScreenProps) {
  const seasons = history.seasons;
  const summary = {
    totalSeasons: seasons.length,
    bestPosition: seasons.length > 0 ? Math.min(...seasons.map((entry) => entry.finalPosition)) : null,
    totalPromotions: seasons.filter((entry) => entry.promoted).length,
    totalRelegations: seasons.filter((entry) => entry.relegated).length,
    currentDivision: history.currentDivision,
  };

  return (
    <div className="league-history-screen">
      <div className="league-history-summary">
        <div className="league-history-summary-card">
          <span>Total Seasons</span>
          <strong>{summary.totalSeasons}</strong>
        </div>
        <div className="league-history-summary-card">
          <span>Best Finish</span>
          <strong>{summary.bestPosition ? ordinal(summary.bestPosition) : '—'}</strong>
        </div>
        <div className="league-history-summary-card">
          <span>Total Promotions</span>
          <strong>{summary.totalPromotions}</strong>
        </div>
        <div className="league-history-summary-card">
          <span>Total Relegations</span>
          <strong>{summary.totalRelegations}</strong>
        </div>
        <div className="league-history-summary-card">
          <span>Current Division</span>
          <strong>{summary.currentDivision ? `Division ${summary.currentDivision}` : '—'}</strong>
        </div>
      </div>

      <div className="league-history-list">
        {seasons.length === 0 ? (
          <div className="league-history-card league-history-empty">
            <p>No completed seasons yet.</p>
          </div>
        ) : (
          seasons.map((entry) => {
            const outcome = seasonOutcome(entry);
            return (
              <div key={entry.season} className="league-history-card">
                <div className="league-history-card-top">
                  <div>
                    <p className="league-card-label">Season {entry.season}</p>
                    <h3>Division {entry.division}</h3>
                  </div>
                  <span className={`league-history-outcome ${outcome.className}`}>{outcome.label}</span>
                </div>
                <p className="league-fixture-result">
                  {outcome.label === 'PROMOTED'
                    ? 'Strong finish. You moved up a division.'
                    : outcome.label === 'RELEGATED'
                      ? 'Below the line. You dropped a division.'
                      : 'Held your level for another season.'}
                </p>
                <div className="league-history-card-stats">
                  <div>
                    <span>Final Position</span>
                    <strong>{ordinal(entry.finalPosition)} of 7</strong>
                  </div>
                  <div>
                    <span>Record</span>
                    <strong>
                      {entry.wins}-{entry.draws}-{entry.losses} W-D-L
                    </strong>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="league-actions-inline">
        <button className="mode-inline-btn" onClick={onBack}>Back to League</button>
      </div>
    </div>
  );
}
