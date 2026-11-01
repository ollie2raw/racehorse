import type { ReactNode } from 'react';

interface LayoutScreenProps {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Heading level of the title. A page's title is its `h1`, so pages that have no other `h1` pass 1. The default
   * stays 2 because some callers already render their own `h1` and would otherwise end up with two.
   */
  headingLevel?: 1 | 2;
  children?: ReactNode;
}

export default function LayoutScreen({
  title,
  subtitle,
  className,
  contentClassName,
  headingLevel = 2,
  children,
}: LayoutScreenProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className={`layout-screen screen${className ? ` ${className}` : ''}`}>
      <div className="layout-screen-bg" aria-hidden="true" />
      <div className="layout-screen-beam" aria-hidden="true" />
      <div className="layout-screen-vignette" aria-hidden="true" />
      <div className="layout-screen-inner">
        <header className="layout-screen-header">
          <Heading className="layout-screen-title">{title}</Heading>
          {subtitle ? <p className="layout-screen-subtitle">{subtitle}</p> : null}
        </header>
        <div className={`layout-screen-content${contentClassName ? ` ${contentClassName}` : ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
