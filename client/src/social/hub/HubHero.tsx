import type { ReactNode } from 'react';

interface HubHeroProps {
  eyebrow?: ReactNode;
  title: string;
  subtitle: string;
  filters?: ReactNode;
  aside?: ReactNode;
  mascotSrc?: string;
  mascotAlt?: string;
  className?: string;
}

export default function HubHero({
  eyebrow,
  title,
  subtitle,
  filters,
  aside,
  mascotSrc,
  mascotAlt = '',
  className = '',
}: HubHeroProps) {
  return (
    <header className={`rh-hub-hero ${className}`.trim()}>
      <section className="rh-hub-hero-copy">
        {eyebrow ? <p className="rh-hub-hero-eyebrow">{eyebrow}</p> : null}
        <h1 className="rh-hub-hero-title">{title}</h1>
        <p className="rh-hub-hero-sub">{subtitle}</p>
        {filters ? <section className="rh-hub-hero-filters">{filters}</section> : null}
      </section>
      {mascotSrc || aside ? (
        <section className="rh-hub-hero-visual" aria-hidden={!mascotSrc && !aside}>
          {mascotSrc ? <img className="rh-hub-hero-mascot" src={mascotSrc} alt={mascotAlt} /> : null}
          {aside ? <aside className="rh-hub-hero-aside">{aside}</aside> : null}
        </section>
      ) : null}
    </header>
  );
}
