import { useAnimatedScore } from '../hooks/useAnimatedScore';

export interface AnimatedScoreProps {
  value: number;
  duration?: number;
  className?: string;
}

export function AnimatedScore({ value, duration = 600, className }: AnimatedScoreProps) {
  const displayed = useAnimatedScore(value, duration);
  return <span className={className}>{displayed}</span>;
}
