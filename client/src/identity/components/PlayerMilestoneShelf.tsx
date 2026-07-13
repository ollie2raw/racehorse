import type { PlayerIdentityMilestone, PlayerIdentitySignal } from '../playerIdentityTypes';

type Props = { milestones: PlayerIdentityMilestone[] };

export function selectNonDuplicateMilestones(signals: PlayerIdentitySignal[], milestones: PlayerIdentityMilestone[]): PlayerIdentityMilestone[] {
  const featuredTypes = new Set(signals.map((signal) => signal.type));
  return milestones.filter((milestone) => {
    if (milestone.type === 'rating_peak') return !featuredTypes.has('competitive_at_peak');
    if (milestone.type === 'best_streak') return !featuredTypes.has('competitive_best_streak');
    if (milestone.type === 'ranked_games') return !featuredTypes.has('competitive_ranked_games');
    if (milestone.type === 'puzzle_best') return !featuredTypes.has('puzzle_best_ever');
    if (milestone.type === 'journey_progress') return !featuredTypes.has('learning_journey_progress');
    return true;
  });
}

export function PlayerMilestoneShelf({ milestones }: Props) {
  if (milestones.length === 0) return null;
  return <section className="identity-section" aria-labelledby="identity-records-title"><div className="identity-section__heading"><p className="identity-eyebrow">Personal records</p><h2 id="identity-records-title">What they have built</h2></div><div className="identity-record-grid">{milestones.map((milestone) => { const label = milestone.type === 'rating_peak' ? 'Peak Rating' : milestone.type === 'best_streak' ? 'Best Win Streak' : milestone.type === 'ranked_games' ? 'Ranked Games' : milestone.type === 'puzzle_best' ? 'Puzzle Best' : 'Journey Progress'; const value = milestone.type === 'journey_progress' ? `${milestone.completed} / ${milestone.total}` : milestone.value.toLocaleString(); return <div className="identity-record" key={milestone.type}><span>{label}</span><strong>{value}</strong></div>; })}</div></section>;
}
