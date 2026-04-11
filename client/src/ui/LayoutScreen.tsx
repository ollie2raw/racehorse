import type { ReactNode } from 'react';

interface LayoutScreenProps {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}

export default function LayoutScreen({
  title,
  subtitle,
  className,
  contentClassName,
  children,
}: LayoutScreenProps) {
  return (
    <div className={`layout-screen screen${className ? ` ${className}` : ''}`}>
      <div className="layout-screen-bg" aria-hidden="true" />
      <div className="layout-screen-beam" aria-hidden="true" />
      <div className="layout-screen-vignette" aria-hidden="true" />
      <div className="layout-screen-inner">
        <header className="layout-screen-header">
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
