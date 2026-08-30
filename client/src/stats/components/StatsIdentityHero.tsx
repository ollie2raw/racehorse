import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { AnimatedScore } from '../../components/AnimatedScore';
import { RECENT_FORM_LIMIT, summarizeRecentForm } from '../statsDerivations';

type Props = {
  username: string | null;
  competitive: PlayerIdentityModel['competitive'];
};

const DASH = '—';

/**
 * The one block that answers "how am I doing" before anything else on the
 * page. Rating is the dominant number; rank, peak and recent form sit beside
 * it as context rather than as equals.
 *
 * Rank, peak, provisional and recentForm are all already in the identity
 * model — the previous page fetched them and rendered none of them.
 */
export function StatsIdentityHero({ username, competitive }: Props) {
  const form = summarizeRecentForm(competitive.recentForm ?? []);
  const squares = (competitive.recentForm ?? []).slice(-RECENT_FORM_LIMIT);

  return (
    <section className="rh-stats-hero" aria-labelledby="stats-hero-title">
      <p className="rh-stats-eyebrow">Competitive</p>
      <h1 id="stats-hero-title" className="rh-stats-hero-name">
        {username ? `@${username}` : 'Your record'}
      </h1>

      <div className="rh-stats-hero-figures">
        <div className="rh-stats-hero-rating">
          <span className="rh-stats-figure-value rh-stats-figure-value--hero">
            {competitive.rating == null ? (
              DASH
            ) : (
              <AnimatedScore value={competitive.rating} from={0} format={(n) => n.toLocaleString()} />
            )}
          </span>
          <span className="rh-stats-figure-label">Rating</span>
          {competitive.provisional && (
            <span className="rh-stats-hero-provisional">Provisional — still settling</span>
          )}
        </div>

        <dl className="rh-stats-hero-meta">
          <div>
            <dt>Global rank</dt>
            <dd>{competitive.globalRank == null ? DASH : `#${competitive.globalRank}`}</dd>
          </div>
          <div>
            <dt>Peak</dt>
            <dd>{competitive.peakRating == null ? DASH : competitive.peakRating.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Ranked games</dt>
            <dd>{competitive.rankedGames == null ? DASH : competitive.rankedGames.toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {form && (
        <div className="rh-stats-form">
          <span className="rh-stats-figure-label">Recent form</span>
          <div className="rh-stats-form-rail" role="img" aria-label={`Recent form: ${form.label}`}>
            {squares.map((result, index) => (
              <span
                // Position is the identity here: results repeat, and the rail
                // is redrawn whole whenever the model refreshes.
                key={index}
                className="rh-stats-form-square"
                data-testid="stats-form-square"
                data-result={result}
              />
            ))}
          </div>
          <span className="rh-stats-form-label">{form.label}</span>
        </div>
      )}
    </section>
  );
}
