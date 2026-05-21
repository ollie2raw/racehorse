import type { ReactNode } from 'react';

export type LearnRuleAccent = 'mint' | 'gold' | 'blue' | 'muted';

type LearnRuleCardProps = {
  label: string;
  detail: string;
  accent?: LearnRuleAccent;
  icon?: ReactNode;
  className?: string;
};

export function LearnRuleCard({ label, detail, accent = 'mint', icon, className = '' }: LearnRuleCardProps) {
  return (
    <li className={`learn-academy__rule-card learn-academy__rule-card--${accent} ${className}`.trim()}>
      {icon ? <span className="learn-academy__rule-icon">{icon}</span> : null}
      <span className="learn-academy__rule-label">{label}</span>
      <span className="learn-academy__rule-detail">{detail}</span>
    </li>
  );
}
