import type { CSSProperties } from 'react';

const svgProps = {
  className: 'icon-svg',
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
  focusable: false as const,
};

export function ZoomOutIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg {...svgProps} style={style}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function ZoomInIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg {...svgProps} style={style}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function FullscreenIcon({
  isFullscreen,
  style,
}: {
  isFullscreen: boolean;
  style?: CSSProperties;
}) {
  return (
    <svg {...svgProps} style={style}>
      {isFullscreen ? (
        <>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </>
      ) : (
        <>
          <path d="M9 4H4v5" />
          <path d="M15 4h5v5" />
          <path d="M9 20H4v-5" />
          <path d="M15 20h5v-5" />
        </>
      )}
    </svg>
  );
}

export function VolumeIcon({ isMuted, style }: { isMuted: boolean; style?: CSSProperties }) {
  return (
    <svg {...svgProps} style={style} className="icon-svg volume-svg">
      <path d="M4 10h4l5-4v12l-5-4H4z" />
      {!isMuted && (
        <>
          <path d="M16 9a4 4 0 010 6" />
          <path d="M18 7a7 7 0 010 10" />
        </>
      )}
      {isMuted && <path className="icon-slash" d="M5 5l14 14" />}
    </svg>
  );
}

export function HomeIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg {...svgProps} style={style}>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" />
      <polyline points="9 21 9 12 15 12 15 21" />
    </svg>
  );
}

export function FitBoardIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg {...svgProps} style={style}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M9 20H4v-5" />
      <path d="M15 20h5v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" strokeWidth="1.4" />
    </svg>
  );
}
