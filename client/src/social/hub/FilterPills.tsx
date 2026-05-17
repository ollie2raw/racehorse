export interface FilterPillOption<T extends string> {
  id: T;
  label: string;
}

interface FilterPillsProps<T extends string> {
  options: FilterPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export default function FilterPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: FilterPillsProps<T>) {
  return (
    <nav className={`rh-hub-filters ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          className={`rh-hub-filter${value === option.id ? ' rh-hub-filter--active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}
