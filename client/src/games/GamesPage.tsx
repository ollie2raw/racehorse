import { HistoricalGameReviewPortal } from '../modules/review/HistoricalGameReviewPortal';
import LayoutScreen from '../ui/LayoutScreen';

interface GamesPageProps {
  signedIn: boolean;
  onBack: () => void;
}

/**
 * Your games: the archive of every saved Play vs Fritz game, with your record at a glance, filters, and a review for
 * each one (instant when it has been analyzed, analyzed on demand from the saved record when it has not).
 */
export default function GamesPage({ signedIn, onBack }: GamesPageProps) {
  return (
    <LayoutScreen
      // Deliberately not `mode-home-screen`: premium-theme.css sizes that class's header and content to min(1000px, 94vw)
      // !important, which ignores the shell's own padding and pushes the column past the right edge of a phone.
      className="screen lobby-screen mode-subpage-screen rating-history-screen games-screen"
      title="Games"
      subtitle="Every game you have played against Fritz, ready to review"
      contentClassName="screen-shell rating-history-content"
    >
      <div className="rating-history-body" style={{ width: '100%', display: 'grid', gap: 14 }}>
        {signedIn ? (
          <HistoricalGameReviewPortal enabled layout="page" />
        ) : (
          <p role="status" className="rh-recent-reviews__status">Sign in to see your saved games.</p>
        )}
        <div className="rating-history-back" style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button className="mode-inline-btn rh-back-button" data-rh-parent-back onClick={onBack}>
            ← Back to Home
          </button>
        </div>
      </div>
    </LayoutScreen>
  );
}
