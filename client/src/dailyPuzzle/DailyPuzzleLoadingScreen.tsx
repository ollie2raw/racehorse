import { BrandLogo } from '../components';
import { getDailyPuzzleStepPresentation } from './presentation';
import '../screens/RacehorseHomeArt.css';
import './dailyPuzzle.css';

export type DailyPuzzleLoadingScreenProps = {
  onBack: () => void;
};

export function DailyPuzzleLoadingScreen({ onBack }: DailyPuzzleLoadingScreenProps) {
  const loadingSteps = [1, 2, 3].map((slotIndex) => getDailyPuzzleStepPresentation(slotIndex));
  return (
    <div className="daily-puzzle-loading-root daily-puzzle-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__texture" />
      </div>

      <div className="daily-puzzle-loading-shell">
        <nav className="daily-puzzle-loading-nav">
          <div className="daily-puzzle-loading-brand">
            <BrandLogo iconSize={32} showWordmark={true} />
          </div>
          <button type="button" className="loading-back-btn rh-back-button" onClick={onBack}>
            <span className="loading-back-icon">←</span>
            <span>Back to Home</span>
          </button>
        </nav>

        <main className="daily-puzzle-loading-main">
          <div className="loading-lockup">
            <div className="loading-eyebrow">
              <span className="blue-dot" />
              DAILY PUZZLE
            </div>
            <h1 className="loading-title">Preparing today’s ladder</h1>
            <p className="loading-subtitle">Three fixed puzzles. Same board for everyone.</p>

            <div className="loading-steps">
              {loadingSteps.map((step, index) => (
                <div key={step.shortLabel} style={{ display: 'contents' }}>
                  <div className="loading-step">
                    <div className={`loading-step-chip ${index === 0 ? 'is-active' : ''}`} />
                    <span className="loading-step-label">{`${step.title} · ${step.subtitle}`}</span>
                  </div>
                  {index < loadingSteps.length - 1 ? <div className="loading-step-connector" /> : null}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
