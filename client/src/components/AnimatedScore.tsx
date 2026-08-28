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

export function AnimatedScore({ value, duration = 600, from, format, className }: AnimatedScoreProps) {
  const displayed = useAnimatedScore(value, duration, from);
  return <span className={className}>{format ? format(displayed) : displayed}</span>;
}
