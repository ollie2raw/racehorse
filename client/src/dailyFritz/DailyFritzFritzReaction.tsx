import { useCallback } from 'react';
import { useDeferredAsset } from '../ui/useDeferredAsset';

export type DailyFritzFritzMood = 'confident' | 'neutral' | 'defeated';

type DailyFritzFritzReactionProps = {
  mood: DailyFritzFritzMood;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function DailyFritzFritzReaction({
  mood,
  size = 'md',
  className,
}: DailyFritzFritzReactionProps) {
  const loadConfidentArt = useCallback(
    () => import('../assets/bot/playfritz2png.webp'),
    [],
  );
  const loadNeutralArt = useCallback(
    () => import('../assets/singlePlayerHub/leftfacingfritzNOBRAINER.webp'),
    [],
  );
  const loadDefeatedArt = useCallback(
    () => import('../assets/bot/playfritz2png.webp'),
    [],
  );

  const confidentSrc = useDeferredAsset('daily-fritz-fritz-confident', loadConfidentArt);
  const neutralSrc = useDeferredAsset('daily-fritz-fritz-neutral', loadNeutralArt);
  const defeatedSrc = useDeferredAsset('daily-fritz-fritz-defeated', loadDefeatedArt);

  const src =
    mood === 'confident' ? confidentSrc : mood === 'neutral' ? neutralSrc : defeatedSrc;

  if (!src) return null;

  return (
    <div
      className={[
        'df-fritz-reaction',
        `df-fritz-reaction--${size}`,
        `df-fritz-reaction--${mood}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <div className="df-fritz-reaction-glow" />
      <img src={src} alt="" className="df-fritz-reaction-img" decoding="async" />
    </div>
  );
}

export function dailyFritzMoodFromMarginTone(
  marginTone: 'win' | 'loss' | 'idle',
): DailyFritzFritzMood {
  if (marginTone === 'win') return 'defeated';
  if (marginTone === 'loss') return 'confident';
  return 'neutral';
}

export function dailyFritzMoodFromGameHeadline(headline: string): DailyFritzFritzMood {
  return headline.startsWith('You take') ? 'neutral' : 'confident';
}
