import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { Button } from '../components/primitives';
import { getJourneyHomeSummary } from './journeyHomeSummary.ts';
import { getJourneyNodeStatus, loadJourneyProgress } from './journeyStorage.ts';
import type { JourneyNodeStatus } from './journeyTypes.ts';

type JourneyHomeEntryCardProps = {
  onNavigate: () => void;
};

type ChapterMapNode = {
  id: string;
  status: JourneyNodeStatus;
  isBoss: boolean;
};

export function JourneyHomeEntryCard({ onNavigate }: JourneyHomeEntryCardProps) {
  const summary = useMemo(() => getJourneyHomeSummary(), []);
  const overallPct =
    summary.totalNodes > 0 ? Math.round((summary.totalCompleted / summary.totalNodes) * 100) : 0;
  const chapterPct =
    summary.activeChapterTotal > 0
      ? Math.round((summary.activeChapterCompleted / summary.activeChapterTotal) * 100)
      : 0;

  const chapterMapNodes = useMemo<ChapterMapNode[]>(() => {
    const progress = loadJourneyProgress();
    const chapterNodes = summary.activeChapter.nodes.slice(0, 12);
    return chapterNodes.map((node) => ({
      id: node.id,
      status: summary.allChaptersComplete
        ? 'completed'
        : getJourneyNodeStatus(node, progress, summary.activeChapter.nodes),
      isBoss: node.nodeType === 'boss',
    }));
  }, [summary]);

  const chapterLabel = summary.allChaptersComplete
    ? 'All six chapters cleared'
    : summary.activeChapter.title;

  const chapterCaption = summary.allChaptersComplete
    ? 'Campaign complete'
    : `Chapter ${summary.activeChapter.chapterNumber}`;

  return (
    <section
      className="home-journey-entry relative flex cursor-pointer items-center overflow-hidden rounded-[18px] border border-white/[0.055] bg-[rgba(7,9,16,0.88)] px-7 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.028),0_8px_20px_rgba(0,0,0,0.22)]"
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

      <div className="home-journey-entry__lead flex min-w-[236px] items-center gap-4">
        <div className="home-journey-entry__badge" aria-hidden="true">
          RH
        </div>
        <div className="min-w-0">
          <p className="home-journey-entry__mode">Flagship Campaign</p>
          <h2 className="home-journey-entry__title">Racehorse Journey</h2>
          <p className="home-journey-entry__hook">
            Master every position. Beat the campaign.
          </p>
        </div>
      </div>

      <div className="home-journey-entry__map flex min-w-0 flex-1 flex-col items-center justify-center px-4">
        <p className="home-journey-entry__map-caption">{chapterCaption}</p>
        <div className="home-journey-entry__map-track" aria-hidden="true">
          <div className="home-journey-entry__map-line" />
          {chapterMapNodes.map((node) => (
            <span
              key={node.id}
              className={[
                'home-journey-entry__map-node',
                `home-journey-entry__map-node--${node.status}`,
                node.isBoss ? 'home-journey-entry__map-node--boss' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>
      </div>

      <div className="home-journey-entry__actions ml-7 flex min-w-[280px] items-center gap-6 border-l border-white/10 pl-8">
        <div className="min-w-0 flex-1">
          <p className="home-journey-entry__progress-label">Campaign Progress</p>
          <p className="home-journey-entry__progress-value">
            <span className="home-journey-entry__progress-pct">{overallPct}%</span>
            <span className="home-journey-entry__progress-suffix"> cleared</span>
          </p>
          <p className="home-journey-entry__chapter-line">{chapterLabel}</p>
          <div className="home-journey-entry__progress-rail" aria-hidden="true">
            <div
              className="home-journey-entry__progress-fill"
              style={{ width: `${summary.allChaptersComplete ? 100 : chapterPct}%` }}
            />
          </div>
        </div>

        <Button
          variant="tier-elite"
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            onNavigate();
          }}
          className="home-journey-entry__cta shrink-0"
          style={{ minWidth: 148, height: 44, justifyContent: 'space-between', paddingInline: 16 }}
          type="button"
        >
          <span>{summary.ctaLabel}</span>
          <span className="home-journey-entry__cta-arrow" aria-hidden="true">
            ›
          </span>
        </Button>
      </div>
    </section>
  );
}
