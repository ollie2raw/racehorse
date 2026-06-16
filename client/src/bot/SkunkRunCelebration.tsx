import { useEffect } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import type { SkunkCelebrationSide } from './skunkCelebration';
import { SKUNK_RUN_DURATION_MS } from './skunkCelebration';
import './skunkRunCelebration.css';

function SkunkSprite() {
  return (
    <svg
      className="skunk-run-sprite-svg"
      viewBox="0 0 120 72"
      aria-hidden
    >
      <ellipse className="skunk-run-shadow" cx="58" cy="64" rx="34" ry="5" />
      <g className="skunk-run-body-group">
        <path
          className="skunk-run-tail"
          d="M18 34 C4 22 2 8 14 6 C22 4 26 18 28 30 Z"
        />
        <ellipse className="skunk-run-body" cx="52" cy="38" rx="30" ry="18" />
        <path
          className="skunk-run-stripe"
          d="M38 24 C46 38 48 52 42 58 C54 54 58 40 56 28 C52 22 44 20 38 24 Z"
        />
        <ellipse className="skunk-run-head" cx="78" cy="32" rx="14" ry="12" />
        <path className="skunk-run-ear skunk-run-ear--back" d="M72 22 L68 12 L76 18 Z" />
        <path className="skunk-run-ear skunk-run-ear--front" d="M84 20 L90 10 L86 22 Z" />
        <circle className="skunk-run-eye" cx="83" cy="30" r="2.2" />
        <ellipse className="skunk-run-snout" cx="92" cy="34" rx="5" ry="3.5" />
      </g>
      <g className="skunk-run-legs">
        <rect className="skunk-run-leg skunk-run-leg--a" x="40" y="48" width="5" height="14" rx="2.5" />
        <rect className="skunk-run-leg skunk-run-leg--b" x="52" y="48" width="5" height="14" rx="2.5" />
        <rect className="skunk-run-leg skunk-run-leg--c" x="64" y="48" width="5" height="14" rx="2.5" />
        <rect className="skunk-run-leg skunk-run-leg--d" x="76" y="48" width="5" height="14" rx="2.5" />
      </g>
    </svg>
  );
}

export type SkunkRunCelebrationProps = {
  side: SkunkCelebrationSide;
  onComplete: () => void;
};

export function SkunkRunCelebration({ side, onComplete }: SkunkRunCelebrationProps) {
  useEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      onComplete();
      return undefined;
    }
    const timer = window.setTimeout(onComplete, SKUNK_RUN_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <GameOverlayPortal>
      <div
        className={`skunk-run-overlay skunk-run-overlay--${side}`}
        role="presentation"
        aria-hidden
      >
        <div className="skunk-run-track">
          <SkunkSprite />
        </div>
        <div className="skunk-run-dust" aria-hidden />
      </div>
    </GameOverlayPortal>
  );
}
