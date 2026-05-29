import type { CSSProperties } from 'react';

type BoneyardStackIconProps = {
  className?: string;
  style?: CSSProperties;
  size?: number;
};

/** Horizontal domino tile — boneyard pill + Fritz hub summary rows. */
export function BoneyardStackIcon({ className, style, size = 16 }: BoneyardStackIconProps) {
  const useSizeAttr = style?.width == null && style?.height == null;

  return (
    <svg
      className={className}
      style={style}
      {...(useSizeAttr ? { width: size, height: size } : {})}
      viewBox="0 0 24 24"
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
