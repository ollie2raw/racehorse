import type { ReactNode } from 'react';

type LearnBoardStageProps = {
  children: ReactNode;
  title?: string;
  className?: string;
};

export function LearnBoardStage({ children, title, className = '' }: LearnBoardStageProps) {
  return (
    <div className={`learn-academy__stage-panel ${className}`.trim()}>
      {title ? <p className="learn-academy__stage-title">{title}</p> : null}
      <div className="learn-academy__stage-inner">{children}</div>
    </div>
  );
}
