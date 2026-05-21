import { Flag } from 'lucide-react';
import type { HowToPlayModule } from '../howToPlay/howToPlayModules';
import { LEARN_ICON_STROKE } from './LearnIcons';

const PATH_FLAG_SIZE = 20;

type LearnProgressTrackProps = {
  page: number;
  modules: HowToPlayModule[];
  onGoTo: (index: number) => void;
};

export function LearnProgressTrack({ page, modules, onGoTo }: LearnProgressTrackProps) {
  const count = modules.length;

  return (
    <div className="learn-academy__path" aria-label="Training progress">
      <div className="learn-academy__path-rail">
        <span className="learn-academy__path-label">
          Step {page + 1} of {count}
        </span>
        <ol className="learn-academy__path-steps">
          {modules.map((m, i) => (
            <li key={m.id} className="learn-academy__path-step">
              {i > 0 ? <span className="learn-academy__path-connector" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`learn-academy__path-node${
                  page === i ? ' learn-academy__path-node--active' : ''
                }${i < page ? ' learn-academy__path-node--done' : ''}`}
                aria-current={page === i ? 'step' : undefined}
                onClick={() => onGoTo(i)}
              >
                <span className="learn-academy__path-num">{i + 1}</span>
              </button>
              <span
                className={`learn-academy__path-name${
                  page === i ? ' learn-academy__path-name--active' : ''
                }${i < page ? ' learn-academy__path-name--done' : ''}`}
              >
                {m.stepLabel}
              </span>
            </li>
          ))}
        </ol>
        <span className="learn-academy__path-finish" aria-hidden="true">
          <Flag size={PATH_FLAG_SIZE} strokeWidth={LEARN_ICON_STROKE} />
        </span>
      </div>
    </div>
  );
}
