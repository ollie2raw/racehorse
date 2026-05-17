import type { ReactNode } from 'react';
import './sideRailCard.css';

interface SideRailCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}

export default function SideRailCard({
  title,
  action,
  children,
  className,
  footer,
}: SideRailCardProps) {
  return (
    <section className={`rh-hub-rail-card${className ? ` ${className}` : ''}`}>
      <div className="rh-hub-rail-card-head">
        <h2 className="rh-hub-rail-card-title">{title}</h2>
        {action ? <div className="rh-hub-rail-card-action">{action}</div> : null}
      </div>
      <div className="rh-hub-rail-card-body">{children}</div>
      {footer ? <div className="rh-hub-rail-card-footer">{footer}</div> : null}
    </section>
  );
}
