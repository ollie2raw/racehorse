import type { ReactNode } from 'react';
import './socialPageHero.css';

interface SocialPageHeroProps {
  title: string;
  subtitle: string;
  /** Small-caps kicker above the headline, as on the Daily Fritz leaderboard. */
  eyebrow?: string;
  /** Actions rendered opposite the headline (back link, primary CTA). */
  actions?: ReactNode;
  meta?: ReactNode;
  filters?: ReactNode;
}

export default function SocialPageHero({
  title,
  subtitle,
  eyebrow,
  actions,
  meta,
  filters,
}: SocialPageHeroProps) {
  return (
    <>
      <header className="social-hero">
        <div className="social-hero__head">
          {eyebrow ? <span className="social-hero__eyebrow">{eyebrow}</span> : null}
          <h1 className="social-hero__title">
            {title}
            <span className="social-hero__title-dot" aria-hidden="true">.</span>
          </h1>
          <p className="social-hero__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="social-hero__actions">{actions}</div> : null}
      </header>
      {/* The stat strip is fused to the masthead's bottom edge, so it sits
          outside <header> rather than inside it. */}
      {meta ? <div className="social-hero__meta">{meta}</div> : null}
      {filters ? <div className="social-hero__filters">{filters}</div> : null}
    </>
  );
}
