type BoneyardStackIconProps = {
  className?: string;
};

export function BoneyardStackIcon({ className }: BoneyardStackIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.8"
        y="7"
        width="18.4"
        height="10"
        rx="2.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12"
        y1="8.9"
        x2="12"
        y2="15.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
