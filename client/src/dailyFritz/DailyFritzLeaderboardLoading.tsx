import { BrandLogo } from '../components';
import './dailyFritz.css';
import './dailyFritzLeaderboardBoard.css';

/* Name widths vary per row so the placeholder reads like a list of real
   usernames rather than five identical bars. */
const SKELETON_ROWS = [
  { delay: 0, name: '62%' },
  { delay: 90, name: '48%' },
  { delay: 180, name: '71%' },
  { delay: 270, name: '54%' },
  { delay: 360, name: '43%' },
];

/**
 * Leaderboard loading state.
 *
 * Wears the same lockup as the Daily Fritz set loader — brand, eyebrow,
 * display headline — so arriving at the board feels like the same product,
 * then shows the board's own row shape rather than a spinner. The rows are the
 * thing about to appear, so the wait previews the destination.
 */
export function DailyFritzLeaderboardLoading({ onBack }: { onBack: () => void }) {
  return (
    <div className="df-fritz-loading-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__texture" />
      </div>

      <div className="df-fritz-loading-shell">
        <nav className="df-fritz-loading-nav">
          <div className="df-fritz-loading-brand">
            <BrandLogo iconSize={32} showWordmark />
          </div>
          <button type="button" className="df-fritz-loading-back rh-back-button" onClick={onBack}>
            <span className="df-fritz-loading-back-icon">←</span>
            <span>Back to Daily Fritz</span>
          </button>
        </nav>

        <main className="df-fritz-loading-main">
          <div
            className="df-fritz-loading-lockup dfl-loading-lockup"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="df-fritz-loading-eyebrow">
              <span className="df-fritz-loading-dot" aria-hidden />
              DAILY FRITZ
            </div>
            <h1 className="df-fritz-loading-title">Reading today&rsquo;s board</h1>
            <p className="df-fritz-loading-subtitle">
              Everyone plays the same tiles. The only variable is you.
            </p>

            <div className="dfl-skeleton" aria-hidden="true">
              {SKELETON_ROWS.map((row) => (
                <div
                  key={row.delay}
                  className="dfl-skeleton__row"
                  style={{ animationDelay: `${row.delay}ms` }}
                >
                  <span className="dfl-skeleton__rank" />
                  <span className="dfl-skeleton__avatar" />
                  <span className="dfl-skeleton__name" style={{ width: row.name }} />
                  <span className="dfl-skeleton__games">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default DailyFritzLeaderboardLoading;
