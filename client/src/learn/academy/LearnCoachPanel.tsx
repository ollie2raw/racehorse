import type { ReactNode } from 'react';

type LearnCoachPanelProps = {
  stepLabel: string;
  title: string;
  lede: string;
  beats?: string[];
  momentumNote?: string;
  takeaway: string;
  footer?: ReactNode;
};

export function LearnCoachPanel({
  stepLabel,
  title,
  lede,
  beats = [],
  momentumNote,
  takeaway,
  footer,
}: LearnCoachPanelProps) {
  return (
    <div className="learn-academy__coach">
      <header className="learn-academy__header">
        <p className="learn-academy__kicker">
          How to Play <span aria-hidden="true">·</span> {stepLabel}
        </p>
        <h1 className="learn-academy__title">{title}</h1>
      </header>

      <p className="learn-academy__lede">{lede}</p>

      {beats.length > 0 ? (
        <ul className="learn-academy__beats">
          {beats.map((beat) => (
            <li key={beat}>{beat}</li>
          ))}
        </ul>
      ) : null}

      {momentumNote ? (
        <blockquote className="learn-academy__momentum">
          <p>{momentumNote}</p>
        </blockquote>
      ) : null}

      <div className="learn-academy__takeaway">
        <span className="learn-academy__takeaway-label">Takeaway</span>
        <p className="learn-academy__takeaway-text">{takeaway}</p>
      </div>

      {footer ? <div className="learn-academy__coach-ctas">{footer}</div> : null}
    </div>
  );
}
