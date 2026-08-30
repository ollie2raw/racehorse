import type { ReactNode } from 'react';

export type StatsAccent = 'gold' | 'green' | 'blue' | 'purple';

/**
 * One mode's panel.
 *
 * Same card language as the rules article and the Settings page — an
 * accent-tinted surface, an uppercase eyebrow above the heading, and a kicker
 * dot tying the heading to the accent — so the long-form pages read as one
 * product.
 *
 * `empty` replaces the body outright. A mode nobody has played used to render
 * five zeros, which looks like a broken panel rather than an empty one.
 */
export function StatsModeCard({
  accent,
  eyebrow,
  title,
  empty,
  wide,
  children,
}: {
  accent: StatsAccent;
  eyebrow: string;
  title: string;
  empty?: string | null;
  /** Spans both grid columns on desktop, for a card with rows under its figures. */
  wide?: boolean;
  children?: ReactNode;
}) {
  const id = `stats-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`;
  return (
    <section
      className={`rh-stats-card rh-stats-card--${accent}${wide ? ' rh-stats-card--wide' : ''}`}
      aria-labelledby={id}
    >
      <p className="rh-stats-eyebrow">{eyebrow}</p>
      <h2 id={id} className="rh-stats-card-title">
        {title}
      </h2>
      {empty ? <p className="rh-stats-empty">{empty}</p> : children}
    </section>
  );
}

/** A value and what it measures. The value carries the weight, not the label. */
export function StatsFigure({
  value,
  label,
  tone,
}: {
  value: ReactNode;
  label: string;
  tone?: 'accent';
}) {
  return (
    <div className={`rh-stats-figure${tone === 'accent' ? ' rh-stats-figure--accent' : ''}`}>
      <span className="rh-stats-figure-value">{value}</span>
      <span className="rh-stats-figure-label">{label}</span>
    </div>
  );
}

/** The figure row inside a card. Wraps rather than scrolls on a phone. */
export function StatsFigureGrid({ children }: { children: ReactNode }) {
  return <div className="rh-stats-figure-grid">{children}</div>;
}
