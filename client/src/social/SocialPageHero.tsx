import type { ReactNode } from 'react';
import './socialPageHero.css';

interface SocialPageHeroProps {
  title: string;
  subtitle: string;
  filters?: ReactNode;
}

export default function SocialPageHero({
  title,
  subtitle,
  filters,
}: SocialPageHeroProps) {
  return (
    <header className="social-hero">
      <div className="social-hero__head">
        <h1 className="social-hero__title">{title}</h1>
        <p className="social-hero__subtitle">{subtitle}</p>
      </div>
      {filters ? <div className="social-hero__filters">{filters}</div> : null}
    </header>
  );
}
