import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import './tournamentHub.css';

/**
 * Shown for every tournament route (hub, bracket, result, deep links) while
 * live tournaments are switched off (config/tournamentsFeature.ts).
 */
export function TournamentsComingSoonScreen(props: {
  onNavigate: (mode: AppMode) => void;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onBackHome: () => void;
}) {
  return (
    <div className="th-page" data-testid="tournaments-coming-soon">
      <GlobalNav
        currentMode={'home' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onSignOut={props.onSignOut}
        activeColor="var(--accent-amber)"
      />
      <div className="th-shell th-soon">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
        </div>
        <div className="th-soon-body">
          <p className="th-kicker">Tournaments</p>
          <h1 className="th-title">Tournaments are coming back soon</h1>
          <p className="th-desc">
            Live brackets are paused while we bring more players in. In the meantime, Daily Fritz,
            Puzzle Rush and Play vs Fritz are all open.
          </p>
          <button type="button" className="th-back th-soon-cta" onClick={() => props.onNavigate('singlePlayerHub' as AppMode)}>
            Play Single Player
          </button>
        </div>
      </div>
    </div>
  );
}

export default TournamentsComingSoonScreen;
