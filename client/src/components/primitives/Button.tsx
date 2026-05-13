import './Button.css';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'tier-rookie'
  | 'tier-standard'
  | 'tier-elite'
  | 'tier-master';

type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonOwnProps<E extends React.ElementType> = {
  as?: E;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: React.ReactNode;
};

type ButtonProps<E extends React.ElementType> = ButtonOwnProps<E> &
  Omit<React.ComponentPropsWithRef<E>, keyof ButtonOwnProps<E>>;

export function Button<E extends React.ElementType = 'button'>({
  as,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps<E>) {
  const Tag = (as ?? 'button') as React.ElementType;

  const classes = [
    'rh-btn',
    `rh-btn--${variant}`,
    size !== 'md' ? `rh-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
