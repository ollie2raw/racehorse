import { BrandLogo } from '../components';

export function ScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="rh-screen-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="rh-screen-loader__bg" aria-hidden />
      <div className="rh-screen-loader__panel">
        <div className="rh-screen-loader__brand">
          <BrandLogo iconSize={30} showWordmark />
        </div>
        <p className="rh-screen-loader__label">{label}</p>
        <div className="rh-screen-loader__rail" aria-hidden>
          <div className="rh-screen-loader__rail-fill" />
        </div>
      </div>
    </div>
  );
}
