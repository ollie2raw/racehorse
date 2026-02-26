import type { ReactNode } from 'react';

interface LayoutScreenProps {
  badge?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}

export default function LayoutScreen({
  badge,
  title,
  subtitle,
  className,
  contentClassName,
  children,
}: LayoutScreenProps) {
  return (
    <div className={`layout-screen${className ? ` ${className}` : ''}`}>
      <div className="layout-screen-bg" aria-hidden="true" />
      <div className="layout-screen-beam" aria-hidden="true" />
      <div className="layout-screen-vignette" aria-hidden="true" />
      <div className="layout-screen-inner">
        <header className="layout-screen-header">
          {badge ? <p className="layout-screen-badge">{badge}</p> : null}
          <h2 className="layout-screen-title">{title}</h2>
          {subtitle ? <p className="layout-screen-subtitle">{subtitle}</p> : null}
        </header>
        <div className={`layout-screen-content${contentClassName ? ` ${contentClassName}` : ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
