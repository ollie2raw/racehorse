import { RotateOverlay } from '../../../components';

type BotMatchGuidedV2BootErrorViewProps = {
  guidedV2BootError: string;
  onBack: () => void;
};

export function BotMatchGuidedV2BootErrorView({
  guidedV2BootError,
  onBack,
}: BotMatchGuidedV2BootErrorViewProps) {
  return (
    <>
      <RotateOverlay />
      <div
        className="screen game-screen walnut-live theme-green bot-match-screen learn-lesson-screen learn-pvf-root pvf-root tier-rookie"
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 0', overflow: 'hidden' }}
      >
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
        </div>
        <div
          className="learn-guided-pvf"
          data-ui="guided-boot-error"
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
        >
          <div className="learn-guided-hero-card" style={{ maxWidth: 520, width: '100%' }}>
            <div className="learn-guided-hero-card__content">
              <p className="learn-guided-hero-card__eyebrow">Guided Match</p>
              <h2 className="learn-guided-hero-card__title">Lesson not available</h2>
              <p className="learn-guided-hero-card__description">{guidedV2BootError}</p>
              <button type="button" className="pvf-back-btn rh-back-button" onClick={onBack} style={{ marginTop: 24 }}>
                ← Back to Learn
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}