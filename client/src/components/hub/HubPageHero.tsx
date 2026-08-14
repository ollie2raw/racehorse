import type { ReactNode } from 'react';
import './hubPageHero.css';

interface HubPageHeroMeta {
  dateLabel: string;
  dateSub?: string;
  countdownLabel?: string;
}

interface HubPageHeroProps {
  badge?: string;
  badgeIcon?: ReactNode;
  title: string;
  subtitle: string;
  heroImageSrc?: string;
  heroImageAlt?: string;
  meta?: HubPageHeroMeta;
  filters?: ReactNode;
  accent?: 'gold' | 'neutral';
}

export default function HubPageHero({
  badge,
  badgeIcon,
  title,
  subtitle,
  heroImageSrc,
  heroImageAlt = '',
  meta,
  filters,
  accent = 'gold',
}: HubPageHeroProps) {
  return (
    <header className={`rh-hub-hero rh-hub-hero--${accent}`}>
      <div className="rh-hub-hero-copy">
        {badge ? (
          <span className="rh-hub-hero-badge">
            {badgeIcon ? <span className="rh-hub-hero-badge-icon" aria-hidden="true">{badgeIcon}</span> : null}
            {badge}
          </span>
        ) : null}
        <h1 className="rh-hub-hero-title">{title}</h1>
        <p className="rh-hub-hero-subtitle">{subtitle}</p>
        {filters ? <div className="rh-hub-hero-filters">{filters}</div> : null}
      </div>

      {heroImageSrc ? (
        <div className="rh-hub-hero-art" aria-hidden="true">
          <img src={heroImageSrc} alt={heroImageAlt} className="rh-hub-hero-art-img" fetchPriority="high" decoding="async" />
        </div>
      ) : null}

      {meta ? (
        <aside className="rh-hub-hero-meta" aria-label="Daily status">
          <div className="rh-hub-hero-meta-row">
            <span className="rh-hub-hero-meta-icon" aria-hidden="true">📅</span>
            <span>
              <strong>{meta.dateLabel}</strong>
              {meta.dateSub ? <span className="rh-hub-hero-meta-sub">{meta.dateSub}</span> : null}
            </span>
          </div>
          {meta.countdownLabel ? (
            <p className="rh-hub-hero-countdown">
              Resets in <strong>{meta.countdownLabel}</strong>
            </p>
          ) : null}
        </aside>
      ) : null}
    </header>
  );
}
