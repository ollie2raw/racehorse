import { Button } from '../components/primitives';
import type { DailyProgressCardItem } from './DailyModeProgressDeck';

const LockIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
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

interface DailyFritzArenaTrackProps {
  activeSlot: number;
  winTarget: number;
  items: DailyProgressCardItem[];
}

export default function DailyFritzArenaTrack({ activeSlot, winTarget, items }: DailyFritzArenaTrackProps) {
  return (
    <section className="df-arena-track" aria-label="Best-of-3 set gauntlet">
      <div className="df-arena-track__head">
        <span className="df-arena-track__pulse" aria-hidden />
        <span className="df-arena-track__tag">Best of 3</span>
        <p className="df-arena-track__rule">
          First to {winTarget} per game · win two games to take the set
        </p>
      </div>

      <div className="df-arena-track__path" data-active-slot={String(activeSlot)}>
        <div className="df-arena-track__rail" aria-hidden="true">
          {items.map((item, index) => (
            <div key={`rail-${item.slot}`} className="df-arena-track__rail-segment">
              {index > 0 ? (
                <div
                  className={[
                    'df-arena-track__connector',
                    items[index - 1]?.variant === 'done' ? 'df-arena-track__connector--lit' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              ) : null}
              <div
                className={[
                  'df-arena-node__medallion',
                  `df-arena-node__medallion--${item.variant}`,
                  item.outcome === 'won' ? 'df-arena-node__medallion--won' : '',
                  item.outcome === 'lost' ? 'df-arena-node__medallion--lost' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="df-arena-node__medallion-num">{item.slot}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="df-arena-track__cards">
          {items.map((item) => {
            const isActive = item.variant === 'active';
            const isLocked = item.variant === 'locked';
            const isDone = item.variant === 'done';
            const isDecider = item.slot === 3;

            return (
              <article
                key={item.slot}
                data-slot={item.slot}
                className={[
                  'df-arena-node',
                  `df-arena-node--${item.variant}`,
                  item.outcome === 'won' ? 'df-arena-node--won' : '',
                  item.outcome === 'lost' ? 'df-arena-node--lost' : '',
                  isDecider ? 'df-arena-node--decider' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="df-arena-node__card">
                  {isActive ? <span className="df-arena-node__live">Live</span> : null}
                  {isDone ? (
                    <span
                      className={[
                        'df-arena-node__result',
                        item.outcome === 'won' ? 'df-arena-node__result--won' : 'df-arena-node__result--lost',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {item.outcome === 'won' ? 'Won' : 'Lost'}
                    </span>
                  ) : null}
                  {isLocked ? (
                    <span className="df-arena-node__lock" aria-hidden>
                      <LockIcon />
                    </span>
                  ) : null}

                  <span className="df-arena-node__eyebrow">{item.eyebrow}</span>
                  <h3 className="df-arena-node__title">{item.title}</h3>
                  <p className="df-arena-node__status">{item.statusLine}</p>
                  {item.hint && !isDone ? <p className="df-arena-node__hint">{item.hint}</p> : null}
                  {item.scoreLine && isDone ? <p className="df-arena-node__score">{item.scoreLine}</p> : null}
                  {!isDone && item.metaLeft ? <p className="df-arena-node__meta">{item.metaLeft}</p> : null}
                  {item.showPlay ? (
                    <Button
                      type="button"
                      variant="tier-elite"
                      size="md"
                      className="df-arena-node__play"
                      disabled={item.playDisabled}
                      onClick={item.onPlay}
                    >
                      {item.playLabel ?? 'Play'}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
