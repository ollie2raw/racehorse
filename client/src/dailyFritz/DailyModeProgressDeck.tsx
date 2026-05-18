import { Button } from '../components/primitives';

export type DailyProgressCardVariant = 'active' | 'done' | 'locked' | 'idle';

export interface DailyProgressCardItem {
  slot: number;
  title: string;
  eyebrow: string;
  statusLine: string;
  hint?: string | null;
  scoreLine?: string | null;
  metaLeft?: string | null;
  metaRight?: string | null;
  variant: DailyProgressCardVariant;
  outcome?: 'won' | 'lost' | null;
  showPlay?: boolean;
  playLabel?: string;
  onPlay?: () => void;
  playDisabled?: boolean;
}

interface DailyModeProgressDeckProps {
  accent: 'gold' | 'blue';
  sectionLabel: string;
  deckTag: string;
  deckRule: string;
  activeSlot: number;
  items: DailyProgressCardItem[];
}

const LockIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M7 11V8a5 5 0 0 1 10 0v3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" />
  </svg>
);

export default function DailyModeProgressDeck({
  accent,
  sectionLabel,
  deckTag,
  deckRule,
  activeSlot,
  items,
}: DailyModeProgressDeckProps) {
  const playVariant = accent === 'gold' ? 'tier-elite' : 'tier-standard';

  return (
    <div className={`df-section df-section--progress df-progress-deck df-progress-deck--${accent}`}>
      <div className="fritz-section-label">{sectionLabel}</div>
      <div className="df-progress-deck__head">
        <span className="df-progress-deck__pulse" aria-hidden />
        <span className="df-progress-deck__tag">{deckTag}</span>
        <span className="df-progress-deck__rule">{deckRule}</span>
      </div>
      <div
        className="df-progress-deck__grid"
        data-active-slot={String(activeSlot)}
        role="list"
        aria-label="Set progress"
      >
        {items.map((item) => {
          const isActive = item.variant === 'active';
          const isLocked = item.variant === 'locked';
          const isDone = item.variant === 'done';

          return (
            <article
              key={item.slot}
              role="listitem"
              data-slot={item.slot}
              className={[
                'df-progress-card',
                `df-progress-card--${item.variant}`,
                item.outcome === 'won' ? 'df-progress-card--won' : '',
                item.outcome === 'lost' ? 'df-progress-card--lost' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {isActive ? (
                <span className="df-progress-card__badge df-progress-card__badge--active">ACTIVE</span>
              ) : null}
              {isDone ? (
                <span
                  className={[
                    'df-progress-card__badge',
                    item.outcome === 'won' ? 'df-progress-card__badge--won' : 'df-progress-card__badge--lost',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.outcome === 'won' ? 'Won' : 'Lost'}
                </span>
              ) : null}
              <div className="df-progress-card__index" aria-hidden>
                {item.slot}
              </div>
              <div className="df-progress-card__body">
                <span className="df-progress-card__eyebrow">{item.eyebrow}</span>
                <h3 className="df-progress-card__title">{item.title}</h3>
                <p className="df-progress-card__status">{item.statusLine}</p>
                {item.hint && !isDone ? (
                  <p className="df-progress-card__hint">{item.hint}</p>
                ) : null}
              </div>
              {item.metaLeft ? (
                <div className="df-progress-card__meta" aria-label={item.metaLeft}>
                  <span className="df-progress-card__meta-left">{item.metaLeft}</span>
                  {item.metaRight ? (
                    <>
                      <span className="df-progress-card__meta-divider" aria-hidden />
                      <span className="df-progress-card__meta-right">{item.metaRight}</span>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="df-progress-card__footer">
                {item.scoreLine && !item.showPlay && !item.metaLeft ? (
                  <span className="df-progress-card__score">{item.scoreLine}</span>
                ) : null}
                {item.showPlay ? (
                  <Button
                    type="button"
                    variant={playVariant}
                    size="sm"
                    className="df-progress-card__play"
                    disabled={item.playDisabled}
                    onClick={item.onPlay}
                  >
                    {item.playLabel ?? 'Play'}
                  </Button>
                ) : null}
                {isLocked ? (
                  <span className="df-progress-card__lock" aria-hidden>
                    <LockIcon />
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
