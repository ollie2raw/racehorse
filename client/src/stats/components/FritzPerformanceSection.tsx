import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import type { FritzTierKey } from '../statsTypes';

type Props = { fritz: PlayerIdentityModel['fritz'] };
const labels: Record<FritzTierKey, string> = { rookie: 'Rookie', standard: 'Standard', elite: 'Elite', master: 'Master' };
const colors: Record<FritzTierKey, string> = { rookie: '#00e676', standard: '#3d8eff', elite: '#ff4040', master: '#f0c040' };
const value = (number: number | null) => number == null ? '—' : number.toLocaleString();

export function FritzPerformanceSection({ fritz }: Props) {
  const hasData = [fritz.totalWins, fritz.totalLosses, fritz.winRate, fritz.averageScore, fritz.bestScore].some((item) => item != null) || fritz.difficultyRecords.length > 0;
  if (!hasData) return null;
  const records = new Map(fritz.difficultyRecords.map((record) => [record.difficulty.toLowerCase(), record]));
  return <section className="stats-analysis-card" aria-labelledby="stats-fritz-title"><div className="stats-section-heading"><p className="stats-eyebrow stats-eyebrow--gold">Fritz performance</p><h2 id="stats-fritz-title">Against every difficulty</h2></div><div className="stats-fritz-overview"><div><span className="stats-stat-label">RECORD</span><strong>{fritz.totalWins != null && fritz.totalLosses != null ? `${fritz.totalWins}W – ${fritz.totalLosses}L` : '—'}</strong></div><div><span className="stats-stat-label">WIN RATE</span><b>{fritz.winRate == null ? '—' : `${fritz.winRate.toFixed(1)}%`}</b></div><div><span className="stats-stat-label">AVERAGE SCORE</span><b>{value(fritz.averageScore)}</b></div><div><span className="stats-stat-label">BEST SCORE</span><b>{value(fritz.bestScore)}</b></div></div><div className="stats-tier-list">{(Object.keys(labels) as FritzTierKey[]).map((tier) => { const record = records.get(tier); return <div className="stats-tier-row" key={tier}><span className="stats-tier-name"><i style={{ background: colors[tier] }} aria-hidden="true" />{labels[tier]}</span><span>{record ? `${record.wins}W – ${record.losses}L` : '—'}</span><span>{record ? `${record.games} games` : 'Unavailable'}</span></div>; })}</div></section>;
}
