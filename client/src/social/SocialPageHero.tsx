import type { ReactNode } from 'react';
import './socialPageHero.css';

interface SocialPageHeroProps {
  title: string;
  subtitle: string;
  meta?: ReactNode;
  filters?: ReactNode;
}

export default function SocialPageHero({
  title,
  subtitle,
  meta,
  filters,
}: SocialPageHeroProps) {
  return (
    <header className="social-hero">
      <div className="social-hero__head">
        <h1 className="social-hero__title">{title}</h1>
        <p className="social-hero__subtitle">{subtitle}</p>
      </div>
      {meta ? <div className="social-hero__meta">{meta}</div> : null}
      {filters ? <div className="social-hero__filters">{filters}</div> : null}
    </header>
  );
}
