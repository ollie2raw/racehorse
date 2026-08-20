import { Button } from '../components/primitives';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import type { RecoveredPrivateMatchUi } from './terminalRoomArchiveRecovery';
import '../components/leaveGameModal.css';

export const RESULT_RECOVERY_COPY = {
  unauthorizedTitle: 'Sign in to recover result',
  unauthorizedDetail:
    'Your saved room has ended, but result recovery needs a fresh sign-in. Return home, sign in, then retry Multiplayer.',
  forbiddenTitle: 'Result unavailable',
  forbiddenDetail: 'This result is unavailable.',
  absentTitle: 'Match ended — result unavailable',
  absentDetail: 'The archived result for this match could not be found.',
  syncingTitle: 'Result syncing, try again shortly',
  syncingDetail: 'The match has ended, but the result is still syncing. Try again in a moment.',
} as const;

function outcomeLabel(outcome: 'win' | 'loss' | 'draw'): string {
  if (outcome === 'win') return 'Win';
  if (outcome === 'loss') return 'Loss';
  return 'Draw';
}

function formatRatingDelta(delta: number | null): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

export type PrivateMatchResultRecoveryOverlayProps = {
  recovered: RecoveredPrivateMatchUi;
  onReturnHome: () => void;
  onSignIn?: () => void;
};

export function PrivateMatchResultRecoveryOverlay({
  recovered,
  onReturnHome,
  onSignIn,
}: PrivateMatchResultRecoveryOverlayProps) {
  if (recovered.kind === 'result') {
    const { result } = recovered;
    const rankingLine = result.ranking.applied
      ? formatRatingDelta(result.ranking.ratingDelta)
      : result.ranking.message;
    return (
      <GameOverlayPortal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Match result"
          className="rh-leave-overlay"
          data-testid="private-match-result-recovery"
          data-state="result"
        >
          <div className="rh-leave-card rh-leave-card--mp rh-result-recovery" onClick={(event) => event.stopPropagation()}>
            <p className="rh-result-recovery__eyebrow">Private Match</p>
            <p className="rh-result-recovery__badge" data-testid="result-outcome-badge">
              {outcomeLabel(result.outcome)}
            </p>
            <h2 className="rh-leave-modal__title" style={{ margin: '0 0 10px' }}>
              {result.yourScore} – {result.opponentScore}
            </h2>
            <p className="rh-leave-modal__copy" style={{ margin: '0 auto 12px' }}>
              vs {result.opponent.username}
            </p>
            {rankingLine ? (
              <p className="rh-result-recovery__ranking" data-testid="result-ranking-copy">
                {rankingLine}
              </p>
            ) : null}
            <div className="rh-result-recovery__actions">
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="rh-leave-modal__btn"
                onClick={onReturnHome}
              >
                Return home
              </Button>
            </div>
          </div>
        </div>
      </GameOverlayPortal>
    );
  }

  const copy =
    recovered.kind === 'unauthorized'
      ? { title: RESULT_RECOVERY_COPY.unauthorizedTitle, detail: RESULT_RECOVERY_COPY.unauthorizedDetail }
      : recovered.kind === 'forbidden'
        ? { title: RESULT_RECOVERY_COPY.forbiddenTitle, detail: RESULT_RECOVERY_COPY.forbiddenDetail }
        : recovered.kind === 'syncing'
          ? { title: RESULT_RECOVERY_COPY.syncingTitle, detail: RESULT_RECOVERY_COPY.syncingDetail }
          : { title: RESULT_RECOVERY_COPY.absentTitle, detail: RESULT_RECOVERY_COPY.absentDetail };

  const ctaLabel = recovered.kind === 'unauthorized' && onSignIn ? 'Sign in' : 'Return home';
  const onCta = recovered.kind === 'unauthorized' && onSignIn
    ? () => {
        onSignIn();
        onReturnHome();
      }
    : onReturnHome;

  return (
    <GameOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="rh-leave-overlay"
        data-testid="private-match-result-recovery"
        data-state={recovered.kind}
      >
        <div className="rh-leave-card rh-leave-card--mp rh-result-recovery" onClick={(event) => event.stopPropagation()}>
          <h2 className="rh-leave-modal__title" style={{ margin: '0 0 10px' }}>
            {copy.title}
          </h2>
          <p className="rh-leave-modal__copy" style={{ margin: '0 auto 24px' }}>
            {copy.detail}
          </p>
          <div className="rh-result-recovery__actions">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="rh-leave-modal__btn"
              onClick={onCta}
            >
              {ctaLabel}
            </Button>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
