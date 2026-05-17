import type { ReactNode } from 'react';
import './filterPillRow.css';

export interface FilterPillOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface FilterPillRowProps<T extends string> {
  options: FilterPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export default function FilterPillRow<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filters',
}: FilterPillRowProps<T>) {
  return (
    <nav className="rh-hub-pills" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`rh-hub-pill${active ? ' rh-hub-pill--active' : ''}`}
            onClick={() => onChange(option.id)}
          >
            {option.icon ? <span className="rh-hub-pill-icon" aria-hidden="true">{option.icon}</span> : null}
            {option.label}
          </button>
        );
      })}
    </nav>
  );
}
