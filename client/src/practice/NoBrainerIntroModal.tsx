import { Button, Modal } from '../components/primitives';

type NoBrainerIntroModalProps = {
  open: boolean;
  onStart: () => void;
  onDismiss: () => void;
};

export function NoBrainerIntroModal({ open, onStart, onDismiss }: NoBrainerIntroModalProps) {
  return (
    <Modal
      open={open}
      onClose={onDismiss}
      title="What's a no-brainer?"
      panelClassName="nbl-intro-modal-panel"
      maxWidth={560}
    >
      <div className="nbl-intro-modal">
        <header className="nbl-intro-modal__header">
          <p className="nbl-intro-modal__kicker">The Lab</p>
          <h2 className="nbl-intro-modal__title">What&apos;s a no-brainer?</h2>
          <p className="nbl-intro-modal__lede">Every hand in this mode has one.</p>
        </header>

        <ul className="nbl-intro-modal__beats">
          <li>All 7 of your starting tiles chain together</li>
          <li>Play every tile in one turn</li>
          <li>Go out before your opponent gets a turn</li>
        </ul>

        <div className="nbl-intro-modal__takeaway">
          <span className="nbl-intro-modal__takeaway-label">Takeaway</span>
          <p className="nbl-intro-modal__takeaway-text">
            Solve it, and you&apos;ll never miss one in a real game.
          </p>
        </div>

        <div className="nbl-intro-modal__actions">
          <Button variant="tier-master" size="lg" type="button" onClick={onStart}>
            Start training
          </Button>
        </div>
      </div>
    </Modal>
  );
}
