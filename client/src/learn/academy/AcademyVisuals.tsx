import { Fragment } from 'react';
import { CoreRhythmGrid } from './CoreRhythmGrid';
import { DoublesTempoVisual } from './DoublesTempoVisual';
import { ReadyFinishVisual } from './ReadyFinishVisual';
import { ScoringOpenCountVisual } from './ScoringOpenCountVisual';
import type { HowToPlayVisualType } from '../howToPlay/howToPlayModules';
import {
  LearnIconDraw,
  LearnIconLock,
  LearnIconRefresh,
  LearnIconStack,
  LearnIconTile,
} from './LearnIcons';

const PIPELINE_STEPS = [
  { n: 1, accent: 'mint', Icon: LearnIconTile, title: 'Can you play?', desc: 'You must play.' },
  { n: 2, accent: 'gold', Icon: LearnIconRefresh, title: 'Score or double?', desc: 'Keep your turn.' },
  { n: 3, accent: 'cyan', Icon: LearnIconStack, title: 'Blocked?', desc: 'Racehorse draws.' },
  { n: 4, accent: 'slate', Icon: LearnIconLock, title: 'Pile locked?', desc: 'Auto-pass.' },
] as const;

type AcademyVisualsProps = {
  visual: HowToPlayVisualType;
};

export function AcademyVisuals({ visual }: AcademyVisualsProps) {
  switch (visual) {
    case 'intro-beats':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--intro">
          <CoreRhythmGrid sectionLabel="Core rhythm" />
        </div>
      );

    case 'turn-flow':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--pipeline">
          <p className="learn-academy__section-label learn-academy__pipeline-head">Decision pipeline</p>
          <div className="learn-academy__pipeline-track" role="list">
            {PIPELINE_STEPS.map((step, index) => (
              <Fragment key={step.n}>
                <article
                  role="listitem"
                  className={`learn-academy__pipe-card learn-academy__pipe-card--${step.accent}`}
                >
                  <span className="learn-academy__pipe-card-n">{step.n}</span>
                  <div className="learn-academy__pipe-card-body">
                    <div
                      className={`learn-academy__pipe-card-icon learn-academy__pipe-card-icon--${step.accent}`}
                    >
                      <step.Icon />
                    </div>
                    <div className="learn-academy__pipe-card-copy">
                      <strong className="learn-academy__pipe-card-title">{step.title}</strong>
                      <span className="learn-academy__pipe-card-desc">{step.desc}</span>
                    </div>
                  </div>
                </article>
                {index < PIPELINE_STEPS.length - 1 ? (
                  <span
                    className={`learn-academy__pipe-arrow learn-academy__pipe-arrow--${step.accent}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
      );

    case 'scoring-open-count':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--scoring">
          <ScoringOpenCountVisual />
        </div>
      );

    case 'doubles-compare':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--doubles">
          <DoublesTempoVisual />
        </div>
      );

    case 'win-guided':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--finish">
          <ReadyFinishVisual />
        </div>
      );

    default:
      return null;
  }
}
