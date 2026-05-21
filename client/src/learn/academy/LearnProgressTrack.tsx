import type { HowToPlayModule } from '../howToPlay/howToPlayModules';

type LearnProgressTrackProps = {
  page: number;
  modules: HowToPlayModule[];
  onGoTo: (index: number) => void;
};

function PathFlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="learn-academy__path-flag-icon">
      <path
        fill="currentColor"
        d="M3 3h9v2H5v8h7v2H3V3zm11 0h2v14h-2V3z"
        opacity="0.9"
      />
      <path
        fill="currentColor"
        d="M5 3h1v1H5zm0 2h1v1H5zm0 2h1v1H5zm0 2h1v1H5zm0 2h1v1H5z"
        opacity="0.5"
      />
    </svg>
  );
}

function PathHorseIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" className="learn-academy__path-horse-icon">
      <path
        fill="currentColor"
        d="M2 12c2-1 3-4 5-5 2-2 4-1 5 1 1 2 3 2 5 0 2-2 3-4 2-1-2-3-2-4 1-1 2-4 1-5-1-2-1-3 1-4 2H2z"
      />
    </svg>
  );
}

export function LearnProgressTrack({ page, modules, onGoTo }: LearnProgressTrackProps) {
  const count = modules.length;

  return (
    <div className="learn-academy__path" aria-label="Training progress">
      <span className="learn-academy__path-label">
        Step {page + 1} of {count}
      </span>
      <div className="learn-academy__path-rail">
        <span className="learn-academy__path-horse" aria-hidden="true">
          <PathHorseIcon />
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
          <PathFlagIcon />
        </span>
      </div>
    </div>
  );
}
