import type { PlayerIdentitySignal, PlayerIdentitySignalType } from '../playerIdentityTypes';
import './PlayerIdentityHighlights.css';

export type PlayerIdentityHighlightsProps = { signals: PlayerIdentitySignal[]; isCurrentUser: boolean };

type HighlightCopy = { heading: string; value: string; evidence: string };

function renderSignal(signal: PlayerIdentitySignal, isCurrentUser: boolean): HighlightCopy | null {
  switch (signal.type) {
    case 'competitive_at_peak': {
      if (signal.details.kind !== 'rating') return null;
      return { heading: isCurrentUser ? 'AT YOUR PEAK' : 'AT PEAK RATING', value: `${signal.details.current.toLocaleString()} rating`, evidence: signal.evidence };
    }
    case 'competitive_ranked_games':
      return signal.details.kind === 'count' ? { heading: 'RANKED GAMES', value: `${signal.details.count.toLocaleString()} games`, evidence: signal.evidence } : null;
    case 'competitive_best_streak':
      return signal.details.kind === 'streak' ? { heading: 'BEST WIN STREAK', value: `${signal.details.games} games`, evidence: signal.evidence } : null;
    case 'competitive_current_streak':
      return signal.details.kind === 'streak' ? { heading: 'CURRENT WIN STREAK', value: `${signal.details.games} games`, evidence: signal.evidence } : null;
    case 'competitive_recent_form':
      return signal.details.kind === 'form' ? { heading: 'RECENT FORM', value: `${signal.details.wins}W–${signal.details.losses}L`, evidence: `Last ${signal.details.games} matches` } : null;
    case 'fritz_most_played_difficulty':
      return signal.details.kind === 'record' ? { heading: 'MOST-PLAYED FRITZ', value: signal.details.difficulty ? `${signal.details.difficulty} · ${signal.details.games} games` : `${signal.details.games} games`, evidence: signal.evidence } : null;
    case 'fritz_best_record':
      return signal.details.kind === 'record' ? { heading: 'BEST FRITZ RECORD', value: signal.details.difficulty ? `${signal.details.difficulty} · ${signal.details.wins}W–${signal.details.losses}L` : `${signal.details.wins}W–${signal.details.losses}L`, evidence: `${signal.details.games} games` } : null;
    case 'fritz_all_difficulties':
      return signal.details.kind === 'count' ? { heading: 'FRITZ DEPTH', value: 'All four difficulties', evidence: signal.evidence } : null;
    case 'fritz_overall_record':
      return signal.details.kind === 'record' ? { heading: 'FRITZ RECORD', value: `${signal.details.wins}W–${signal.details.losses}L`, evidence: `${signal.details.games} games` } : null;
    case 'fritz_average_score':
      return signal.details.kind === 'score' ? { heading: 'FRITZ AVERAGE SCORE', value: String(signal.details.score), evidence: signal.evidence } : null;
    case 'fritz_best_score':
      return signal.details.kind === 'score' ? { heading: 'FRITZ BEST SCORE', value: String(signal.details.score), evidence: signal.evidence } : null;
    case 'puzzle_completions':
      return signal.details.kind === 'count' ? { heading: 'PUZZLE COMPLETIONS', value: String(signal.details.count), evidence: 'Daily Puzzle completions' } : null;
    case 'puzzle_current_streak':
      return signal.details.kind === 'streak' ? { heading: 'PUZZLE STREAK', value: `${signal.details.games} days`, evidence: signal.evidence } : null;
    case 'puzzle_best_today':
      return signal.details.kind === 'score' ? { heading: 'TODAY’S PUZZLE BEST', value: String(signal.details.score), evidence: 'Today-only Daily Puzzle score' } : null;
    case 'puzzle_best_ever':
      return signal.details.kind === 'score' ? { heading: 'PUZZLE BEST', value: String(signal.details.score), evidence: 'All-time Daily Puzzle score' } : null;
    case 'puzzle_perfect_days':
      return signal.details.kind === 'count' ? { heading: 'PERFECT PUZZLE DAYS', value: String(signal.details.count), evidence: signal.evidence } : null;
    case 'learning_journey_progress':
      return signal.details.kind === 'journey' ? { heading: 'JOURNEY PROGRESS', value: `${signal.details.completed} of ${signal.details.total} nodes`, evidence: signal.evidence } : null;
    case 'learning_active_chapter':
      return signal.details.kind === 'chapter' ? { heading: 'CURRENTLY LEARNING', value: signal.details.title, evidence: signal.evidence } : null;
    case 'rivalry_viewer_head_to_head':
      return signal.details.kind === 'record' ? { heading: signal.label.toUpperCase(), value: `${signal.details.wins}W–${signal.details.losses}L`, evidence: `${signal.details.games} games` } : null;
    case 'rivalry_most_played':
      return signal.details.kind === 'rival' ? { heading: 'MOST-PLAYED RIVAL', value: signal.details.username, evidence: `${signal.details.games} games together` } : null;
    default: {
      const exhaustive: never = signal.type satisfies PlayerIdentitySignalType;
      return exhaustive;
    }
  }
}

export function PlayerIdentityHighlights({ signals, isCurrentUser }: PlayerIdentityHighlightsProps) {
  const visibleSignals = signals.filter((signal) => signal.visibility === 'public' || isCurrentUser).slice(0, 5);
  if (visibleSignals.length === 0) return null;
  return <section className="identity-highlights" aria-labelledby="identity-highlights-title"><div className="identity-highlights__heading"><p className="identity-eyebrow">At a glance</p><h2 id="identity-highlights-title">Player highlights</h2></div><div className="identity-highlights__grid">{visibleSignals.map((signal) => { const copy = renderSignal(signal, isCurrentUser); if (!copy) return null; return <article className={`identity-highlight identity-highlight--${signal.domain} identity-highlight--${signal.strength}`} key={signal.id} aria-label={`${copy.heading}: ${copy.value}. ${copy.evidence}`}><span className="identity-highlight__heading">{copy.heading}</span><strong>{copy.value}</strong><span className="identity-highlight__evidence">{copy.evidence}</span></article>; })}</div></section>;
}
