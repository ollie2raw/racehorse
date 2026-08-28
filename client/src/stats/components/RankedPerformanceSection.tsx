import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { AnimatedScore } from '../../components/AnimatedScore';

type Props = { competitive: PlayerIdentityModel['competitive'] };
const display = (value: number | null) =>
  value == null ? '—' : <AnimatedScore value={value} from={0} format={(n) => n.toLocaleString()} />;

export function RankedPerformanceSection({ competitive }: Props) {
  const record = competitive.wins != null && competitive.losses != null ? `${competitive.wins}W – ${competitive.losses}L` : '—';
  return <section className="stats-analysis-card" aria-labelledby="stats-ranked-performance-title"><div className="stats-section-heading"><p className="stats-eyebrow">Ranked performance</p><h2 id="stats-ranked-performance-title">The record behind the rating</h2></div><div className="stats-performance-lead"><div><span className="stats-stat-label">WIN RATE</span><strong>{competitive.winRate == null ? '—' : `${competitive.winRate.toFixed(1)}%`}</strong></div><div><span className="stats-stat-label">RECORD</span><b>{record}</b></div></div><div className="stats-fact-grid"><span><b>{display(competitive.currentStreak)}</b> current streak</span><span><b>{display(competitive.bestStreak)}</b> best streak</span><span><b>{display(competitive.rankedGames)}</b> games played</span></div></section>;
}
