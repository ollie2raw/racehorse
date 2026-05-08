import './leaveGameModal.css';

interface Props {
  onCancel: () => void;
  onLeave: () => void;
}

export default function LeaveGameModal({ onCancel, onLeave }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Leave game confirmation"
      className="rh-modal-overlay rh-modal-overlay--danger"
      onClick={onCancel}
    >
      <div className="rh-modal rh-modal--danger" onClick={(e) => e.stopPropagation()}>
        <div className="rh-modal__decor" aria-hidden="true">!</div>
        <div className="rh-modal__warn-icon" aria-hidden="true">!</div>
        <p className="rh-modal__eyebrow">Confirm</p>
        <h2 className="rh-modal__title">{'LEAVE\nGAME?'}</h2>
        <p className="rh-modal__copy">
          Your progress in this hand will be lost. The match will be marked as
          abandoned and won't count toward your streak.
        </p>
        <div className="rh-modal__buttons">
          <button type="button" className="rh-btn-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="rh-btn-leave" onClick={onLeave}>Leave Game</button>
        </div>
      </div>
    </div>
  );
}
