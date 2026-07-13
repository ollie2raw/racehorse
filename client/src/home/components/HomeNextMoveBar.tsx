import { ArrowRight, BookOpen, Bot, Crown, Puzzle, Trophy, Users } from 'lucide-react';
import type { HomePrimaryAction } from '../homeTypes';
import './HomeNextMoveBar.css';

export type HomeNextMoveBarProps = {
  action: HomePrimaryAction | null;
  loading?: boolean;
  onAction?: (action: HomePrimaryAction) => void;
};

function ActionIcon({ type }: { type: HomePrimaryAction['type'] }) {
  if (type === 'continue_tournament') return <Trophy aria-hidden="true" />;
  if (type === 'continue_daily_fritz' || type === 'play_daily_fritz') return <Bot aria-hidden="true" />;
  if (type === 'continue_daily_puzzle' || type === 'play_daily_puzzle') return <Puzzle aria-hidden="true" />;
  if (type === 'continue_lesson') return <BookOpen aria-hidden="true" />;
  if (type === 'challenge_online_rival') return <Users aria-hidden="true" />;
  return <Crown aria-hidden="true" />;
}

export function HomeNextMoveBar({ action, loading = false, onAction }: HomeNextMoveBarProps) {
  if (loading) {
    return (
      <section className="home-next-move home-next-move--loading" aria-busy="true" aria-label="Loading your next move">
        <div className="home-next-move__skeleton home-next-move__skeleton--icon" />
        <div className="home-next-move__skeleton home-next-move__skeleton--copy" />
        <div className="home-next-move__skeleton home-next-move__skeleton--cta" />
      </section>
    );
  }

  if (!action) return null;

  return (
    <section className={`home-next-move home-next-move--${action.type}`} aria-labelledby="home-next-move-title">
      <span className="home-next-move__icon" aria-hidden="true">
        <ActionIcon type={action.type} />
      </span>
      <div className="home-next-move__copy">
        <span className="home-next-move__eyebrow">Your next move</span>
        <h2 id="home-next-move-title" className="home-next-move__title">{action.title}</h2>
        <p className="home-next-move__reason">{action.reason}</p>
      </div>
      <button
        type="button"
        className="home-next-move__cta"
        onClick={() => onAction?.(action)}
        aria-label={`${action.cta}: ${action.title}`}
      >
        <span>{action.cta}</span>
        <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}
