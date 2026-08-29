import { AnimatedScore } from '../components/AnimatedScore';
import { buildDossierGameRows } from './dossierGameRows';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import './dailyFritzModalDossier.css';

export type DailyFritzFinalResultOverlayProps = {
  overlay: DailyFritzSetOverlayViewModel;
  shareDone: boolean;
  onShare: () => void;
};

/**
 * End-of-set result, as a dossier on the run.
 *
 * The header stamps which run this is and whether it was verified, because an
 * unranked finish has to say so plainly rather than quietly showing a blank
 * rank. Everything below is the same card whatever the outcome: three game
 * rows, four stats, then the ways out.
 */
export function DailyFritzFinalResultOverlay({
  overlay,
  shareDone,
  onShare,
}: DailyFritzFinalResultOverlayProps) {
  const rows = buildDossierGameRows(overlay.games);
  const ranked = overlay.ranked !== false;
  const marginTone = overlay.marginTone === 'win' ? 'is-win' : overlay.marginTone === 'loss' ? 'is-loss' : '';

  return (
    <div className="game-over-overlay df-result-overlay" role="dialog" aria-label="Daily Fritz result">
      <div
        className={`dfd${ranked ? '' : ' dfd--unranked'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dfd__body">
          <header>
            <span className="dfd__eyebrow">Set result</span>
            <h2 className="dfd__headline" tabIndex={-1} autoFocus>
              {overlay.headline}
            </h2>
            <p className="dfd__sub">{overlay.subheadline}</p>
          </header>

          <div className="dfd__games" aria-label="Games in this set">
            {rows.map((row) => (
              <div
                key={row.gameNumber}
                className={`dfd__game${row.played ? '' : ' dfd__game--empty'}`}
              >
                <span className="dfd__game-no">G{row.gameNumber}</span>
                <span className="dfd__track">
                  {row.played ? (
                    <span
                      className={`dfd__fill dfd__fill--${row.tone}`}
                      style={{ width: `${row.sharePercent}%` }}
                    />
                  ) : null}
                </span>
                {row.played && row.tone === 'skunk' ? (
                  <span className="dfd__game-tag">Skunk</span>
                ) : null}
                <span className={`dfd__game-score dfd__game-score--${row.played ? row.tone : 'empty'}`}>
                  {row.played ? row.score : 'not played'}
                </span>
              </div>
            ))}
          </div>

          <dl className="dfd__stats">
            <div className="dfd__stat">
              <dt>Rank today</dt>
              <dd className={ranked ? 'is-accent' : ''}>{overlay.rankShort ?? overlay.rankValue ?? '—'}</dd>
            </div>
            <div className="dfd__stat">
              <dt>Point margin</dt>
              <dd className={marginTone}>{overlay.marginValue || '—'}</dd>
            </div>
            <div className="dfd__stat">
              <dt>Rating</dt>
              <dd>
                {ranked && overlay.shareRating ? (
                  <AnimatedScore value={overlay.shareRating} from={0} />
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="dfd__stat">
              <dt>Streak</dt>
              <dd>
                {overlay.shareStreak ? <AnimatedScore value={overlay.shareStreak} from={0} /> : '—'}
                {overlay.streakHeld ? <span className="dfd__held">held</span> : null}
              </dd>
            </div>
          </dl>

          {overlay.note ? <p className="dfd__note">{overlay.note}</p> : null}

          {overlay.errorMessage ? (
            <p className="dfd__note" role="alert">
              {overlay.errorMessage}
            </p>
          ) : null}

          {overlay.practiceHint ? <p className="dfd__note">{overlay.practiceHint}</p> : null}

          <div className="dfd__actions">
            <button type="button" className="dfd__btn dfd__btn--primary" onClick={onShare}>
              {shareDone ? 'Copied' : 'Share Result'}
            </button>
            <div className="dfd__row">
              <button
                type="button"
                className="dfd__btn"
                onClick={overlay.onPrimary}
                disabled={overlay.primaryDisabled}
              >
                {overlay.primaryLabel}
              </button>
              {overlay.secondaryLabel ? (
                <button type="button" className="dfd__btn" onClick={overlay.onSecondary}>
                  {overlay.secondaryLabel}
                </button>
              ) : null}
              {/*
                The completed-set card routes "Return Home" through tertiaryLabel
                rather than secondaryLabel, and no path sets both — so this shares
                the two-column row with the primary action rather than adding a
                third column.
              */}
              {overlay.tertiaryLabel ? (
                <button type="button" className="dfd__btn" onClick={overlay.onTertiary}>
                  {overlay.tertiaryLabel}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
