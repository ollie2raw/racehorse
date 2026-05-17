import { Button } from './primitives';
import { GameOverlayPortal } from './GameOverlayPortal';
import './leaveGameModal.css';

interface Props {
  onCancel: () => void;
  onLeave: () => void;
  title?: string;
  copy?: string;
  confirmLabel?: string;
}

export default function LeaveGameModal({
  onCancel,
  onLeave,
  title = 'Leave Game?',
  copy = "Your progress in this hand will be lost. The match will be marked as abandoned and won't count toward your streak.",
  confirmLabel = 'Leave Game',
}: Props) {
  return (
    <GameOverlayPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leave game confirmation"
        className="rh-leave-overlay"
        onClick={onCancel}
      >
        <div className="rh-leave-card" onClick={(e) => e.stopPropagation()}>
          <h2 className="rh-leave-modal__title">{title}</h2>
          <p className="rh-leave-modal__copy">{copy}</p>
          <div className="rh-leave-modal__buttons">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="rh-leave-modal__btn rh-leave-modal__btn--cancel"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="rh-leave-modal__btn rh-leave-modal__btn--leave"
              onClick={onLeave}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
