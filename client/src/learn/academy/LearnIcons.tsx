import { ICON_BY_TYPE, LEARN_ICON_STROKE, type LearnIconType } from './learnIconMap';

export type { LearnIconType } from './learnIconMap';
export { LEARN_ICON_STROKE } from './learnIconMap';

type LearnIconProps = {
  type: LearnIconType;
  className?: string;
  strokeWidth?: number;
};

export function LearnIcon({
  type,
  className = '',
  strokeWidth = LEARN_ICON_STROKE,
}: LearnIconProps) {
  const Icon = ICON_BY_TYPE[type];
  return (
    <Icon
      className={className}
      aria-hidden
      focusable="false"
      strokeWidth={strokeWidth}
    />
  );
}
