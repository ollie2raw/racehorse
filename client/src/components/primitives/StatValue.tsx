import './StatValue.css';

interface StatValueProps {
  value: string | number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  accent?: string;
  className?: string;
}

export function StatValue({ value, label, size = 'md', inline = false, accent, className = '' }: StatValueProps) {
  const classes = [
    'rh-stat',
    size !== 'md' ? `rh-stat--${size}` : '',
    inline ? 'rh-stat--inline' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span
        className="rh-stat__value"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
      {label && <span className="rh-stat__label">{label}</span>}
    </div>
  );
}
