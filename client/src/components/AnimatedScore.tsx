import { useState } from 'react';
import { motionDuration } from '../ui/motion';
import './animatedScore.css';
import { useAnimatedScore } from '../hooks/useAnimatedScore';

export interface AnimatedScoreProps {
  value: number;
  duration?: number;
  /**
   * Start the count here instead of at `value`. Needed wherever the final
   * number is already known at mount — without it the first render is the
   * final value and nothing animates.
   */
  from?: number;
  /** Formats the animating number, e.g. thousands separators on a rating. */
  format?: (value: number) => string;
  className?: string;
}

export function AnimatedScore({ value, duration = motionDuration.reward, from, format, className }: AnimatedScoreProps) {
  const displayed = useAnimatedScore(value, duration, from);
  const [observed, setObserved] = useState({ value, increased: false });
  if (observed.value !== value) setObserved({ value, increased: value > observed.value });
  return (
    <span className={`rh-score-value ${className ?? ''}`} role="img" aria-label={format ? format(value) : String(value)}>
      <span key={value} aria-hidden="true" className={`rh-score-value__digits${observed.increased ? ' rh-score-value__digits--changed' : ''}`}>
        {format ? format(displayed) : displayed}
      </span>
    </span>
  );
}
