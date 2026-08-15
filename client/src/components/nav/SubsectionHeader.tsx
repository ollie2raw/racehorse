import type { ReactNode } from 'react';
import './SubsectionHeader.css';

export interface SubsectionHeaderProps {
  title: string;
  onBack: () => void;
  /** Accessible name for the back control (defaults to "Back") */
  backAriaLabel?: string;
  className?: string;
  /** Optional trailing slot (e.g. status chip) */
  trailing?: ReactNode;
}

/**
 * Compact drill-in header: top-left back arrow + short title.
 * Sits below GlobalNav / above hub content; does not replace bottom tabs.
 */
export function SubsectionHeader({
  title,
  onBack,
  backAriaLabel = 'Back',
  className,
  trailing,
}: SubsectionHeaderProps) {
  return (
    <header
      className={`rh-subsection-header${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="rh-subsection-header__back rh-back-button"
        onClick={onBack}
        aria-label={backAriaLabel}
      >
        <span className="rh-subsection-header__arrow" aria-hidden>
          ←
        </span>
      </button>
      {title ? (
        <h1 className="rh-subsection-header__title">{title}</h1>
      ) : (
        <div className="rh-subsection-header__title rh-subsection-header__title--empty" aria-hidden />
      )}
      {trailing ? (
        <div className="rh-subsection-header__trailing">{trailing}</div>
      ) : (
        <div className="rh-subsection-header__spacer" aria-hidden />
      )}
    </header>
  );
}
