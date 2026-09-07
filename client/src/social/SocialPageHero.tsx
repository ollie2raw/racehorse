import type { ReactNode } from 'react';

export interface SocialHeroStat {
  label: string;
  value: string;
  qualifier?: string;
  accent?: boolean;
}

interface SocialPageHeroProps {
  eyebrow: string;
  title: string;
  tagline: string;
  actions?: ReactNode;
  stats?: SocialHeroStat[];
  filters?: ReactNode;
}

/**
 * The Social masthead in the leaderboard "board" treatment: display
 * headline with a gold terminal dot on a faint grid-paper ground, and a
 * single connected stat strip fused to its bottom edge.
 */
export default function SocialPageHero({
  eyebrow,
  title,
  tagline,
  actions,
  stats,
  filters,
}: SocialPageHeroProps) {
  return (
    <>
      <div className="rh-sb-masthead-wrap">
        <header className="rh-sb-masthead">
          <div>
            <span className="rh-sb-eyebrow">{eyebrow}</span>
            <h1 className="rh-sb-title">
              {title}
              <span className="rh-sb-title__dot" aria-hidden="true">.</span>
            </h1>
            <p className="rh-sb-tagline">{tagline}</p>
          </div>
          {actions ? <div className="rh-sb-masthead__actions">{actions}</div> : null}
        </header>

        {stats && stats.length > 0 ? (
          <div className="rh-sb-meta" aria-label="Social status">
            {stats.map((stat) => (
              <div className="rh-sb-meta__cell" key={stat.label}>
                <span className="rh-sb-meta__label">{stat.label}</span>
                <span className={`rh-sb-meta__value${stat.accent ? ' is-accent' : ''}`}>
                  {stat.value}
                  {stat.qualifier ? <span className="rh-sb-meta__qual"> {stat.qualifier}</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {filters ?? null}
    </>
  );
}
