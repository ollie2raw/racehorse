import { Fragment, useEffect, useState } from 'react';
import { BrandLogo } from '../components';
import { Button } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';
import './dailyFritz.css';

const DF_LOADING_STEPS = [
  { label: '1 Game one' },
  { label: '2 Game two' },
  { label: '3 Decider' },
] as const;

export type DailyFritzLoadingPhase = 'preparing' | 'still-preparing' | 'failed' | 'retrying';

export type DailyFritzLoadingScreenProps = {
  phase: DailyFritzLoadingPhase;
  loadError: string | null;
  onBack: () => void;
  onRetry: () => void;
  retryPending: boolean;
};

export function DailyFritzLoadingScreen({
  phase,
  loadError,
  onBack,
  onRetry,
  retryPending,
}: DailyFritzLoadingScreenProps) {
  const [activeStep, setActiveStep] = useState(0);
  const isFailed = phase === 'failed';
  const isSlow = phase === 'still-preparing';
  const isRetrying = phase === 'retrying';

  useEffect(() => {
    if (isFailed) return undefined;
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % DF_LOADING_STEPS.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [isFailed]);
  const title = isFailed
    ? 'Couldn’t load Daily Fritz'
    : isSlow || isRetrying
      ? 'Still preparing…'
      : 'Preparing today’s set';
  const subtitle = isFailed
    ? loadError ?? 'Please try again.'
    : isSlow || isRetrying
      ? 'The game server may be waking up.'
      : 'Best of 3 vs Elite Fritz — competitive daily challenge. Strong play; losing sometimes is expected.';
  const showRetry = isFailed || isSlow;
  const busy = !isFailed && phase !== 'still-preparing';

  return (
    <div className="df-fritz-loading-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__texture" />
      </div>

      <div className="df-fritz-loading-shell">
        <nav className="df-fritz-loading-nav">
          <div className="df-fritz-loading-brand">
            <BrandLogo iconSize={32} showWordmark={true} />
          </div>
          <button type="button" className="df-fritz-loading-back rh-back-button" onClick={onBack}>
            <span className="df-fritz-loading-back-icon">←</span>
            <span>Back to Single Player</span>
          </button>
        </nav>

        <main className="df-fritz-loading-main">
          <div
            className="df-fritz-loading-lockup"
            role="status"
            aria-live="polite"
            aria-busy={busy || retryPending}
          >
            <div className="df-fritz-loading-eyebrow">
              <span className="df-fritz-loading-dot" aria-hidden />
              DAILY FRITZ
            </div>
            <h1 className="df-fritz-loading-title">{title}</h1>
            <p className="df-fritz-loading-subtitle">{subtitle}</p>

            {!isFailed ? (
              <div className="df-fritz-loading-steps">
                {DF_LOADING_STEPS.map((step, index) => (
                  <Fragment key={step.label}>
                    {index > 0 ? <div className="df-fritz-loading-step-connector" aria-hidden /> : null}
                    <div className="df-fritz-loading-step">
                      <div
                        className={`df-fritz-loading-chip${activeStep === index ? ' is-active' : ''}`}
                      />
                      <span
                        className={`df-fritz-loading-step-label${activeStep === index ? ' is-active' : ''}`}
                      >
                        {step.label}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            ) : null}

            {showRetry ? (
              <div className="df-fritz-loading-actions">
                <Button
                  type="button"
                  variant="tier-elite"
                  size="md"
                  className="df-fritz-loading-retry"
                  disabled={retryPending}
                  onClick={onRetry}
                >
                  {retryPending ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
