import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { Button } from '../components/primitives';
import { getJourneyHomeSummary } from './journeyHomeSummary.ts';

type JourneyHomeEntryCardProps = {
  onNavigate: () => void;
};

export function JourneyHomeEntryCard({ onNavigate }: JourneyHomeEntryCardProps) {
  const summary = useMemo(() => getJourneyHomeSummary(), []);
  const chapterPct =
    summary.activeChapterTotal > 0
      ? Math.round((summary.activeChapterCompleted / summary.activeChapterTotal) * 100)
      : 0;
  const overallPct =
    summary.totalNodes > 0 ? Math.round((summary.totalCompleted / summary.totalNodes) * 100) : 0;

  return (
    <section
      className="sp-solo-mode-card sp-solo-mode-card--journey home-journey-entry relative box-border flex cursor-pointer flex-col overflow-hidden rounded-[20px] rounded-tl-[5px] px-7 py-8"
      onClick={onNavigate}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onNavigate();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Open Racehorse Journey"
    >
      <div className="home-journey-entry__surface" aria-hidden="true" />
      <div className="home-card-scrim" aria-hidden="true" />

      <div className="home-card-content home-journey-entry__content relative grid h-[268px] grid-rows-[1fr_auto] gap-7">
        <div className="home-journey-entry__body flex min-h-0 flex-col justify-start">
          <div className="sp-solo-mode-card__text sp-solo-mode-card__text--journey">
            <p className="home-journey-entry__mode">Flagship Campaign</p>
            <h2 className="home-journey-entry__title">Racehorse Journey</h2>
            <p className="home-journey-entry__lede">
              Build your Racehorse game across a long-form solo campaign of trials,
              puzzles, and boss gates.
            </p>
          </div>

          <div className="home-journey-entry__stats" aria-label="Journey overview">
            <div className="home-journey-entry__stat">
              <span className="home-journey-entry__stat-label">Campaign</span>
              <strong className="home-journey-entry__stat-value">108 Nodes</strong>
            </div>
            <div className="home-journey-entry__stat">
              <span className="home-journey-entry__stat-label">Playable</span>
              <strong className="home-journey-entry__stat-value">6 Chapters</strong>
            </div>
            <div className="home-journey-entry__stat">
              <span className="home-journey-entry__stat-label">Progress</span>
              <strong className="home-journey-entry__stat-value">{overallPct}% Cleared</strong>
            </div>
          </div>

          <div className="home-journey-entry__campaign-band">
            <div className="home-journey-entry__campaign-copy">
              <span className="home-journey-entry__campaign-label">
                {summary.allChaptersComplete ? 'Campaign Cleared' : 'Current Chapter'}
              </span>
              <strong className="home-journey-entry__campaign-title">
                {summary.allChaptersComplete ? 'All six chapters' : summary.activeChapter.title}
              </strong>
            </div>
            <div className="home-journey-entry__campaign-progress">
              <span className="home-journey-entry__campaign-progress-label">
                {summary.allChaptersComplete
                  ? `${summary.totalCompleted}/${summary.totalNodes}`
                  : `${summary.activeChapterCompleted}/${summary.activeChapterTotal}`}
              </span>
              <div className="home-journey-entry__progress-rail" aria-hidden="true">
                <div
                  className="home-journey-entry__progress-fill"
                  style={{ width: `${summary.allChaptersComplete ? 100 : chapterPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="tier-elite"
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            onNavigate();
          }}
          className="home-journey-entry__cta self-start"
          type="button"
        >
          <span>{summary.ctaLabel}</span>
          <span className="home-journey-entry__cta-arrow" aria-hidden="true">
            ›
          </span>
        </Button>
      </div>

      <div className="home-journey-entry__route" aria-hidden="true">
        <div className="home-journey-entry__route-line" />
        {[1, 2, 3, 4, 5].map((marker) => (
          <span
            key={marker}
            className={`home-journey-entry__route-marker${
              marker < 3 ? ' home-journey-entry__route-marker--complete' : ''
            }${marker === 3 ? ' home-journey-entry__route-marker--current' : ''}${
              marker === 5 ? ' home-journey-entry__route-marker--boss' : ''
            }`}
          >
            {marker === 5 ? '★' : marker}
          </span>
        ))}
        <span className="home-journey-entry__route-caption">Long-term progression</span>
      </div>
    </section>
  );
}
