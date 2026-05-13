import './GlassCard.css';

type AccentColor = 'blue' | 'gold' | 'purple' | 'green';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  lifted?: boolean;
  accent?: AccentColor;
  children?: React.ReactNode;
}

export function GlassCard({ lifted = false, accent, className = '', children, ...rest }: GlassCardProps) {
  const classes = [
    'rh-glass-card',
    lifted ? 'rh-glass-card--lifted' : '',
    accent ? `rh-glass-card--accent-${accent}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
