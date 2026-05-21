type LearnActionButtonProps = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'next';
  disabled?: boolean;
};

export function LearnActionButton({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
}: LearnActionButtonProps) {
  if (variant === 'secondary') {
    return (
      <button type="button" className="learn-academy__btn learn-academy__btn--secondary" onClick={onClick}>
        <span>{label}</span>
        <span className="learn-academy__btn-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  if (variant === 'next') {
    return (
      <button
        type="button"
        className="learn-academy__btn learn-academy__btn--next"
        onClick={onClick}
        disabled={disabled}
      >
        <span>{label}</span>
        <span className="learn-academy__btn-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="learn-academy__btn learn-academy__btn--primary"
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      <span className="learn-academy__btn-arrow" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
