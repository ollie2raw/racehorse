import { Button, Modal } from '../components/primitives';

type NoBrainerIntroModalProps = {
  open: boolean;
  onStart: () => void;
};

export function NoBrainerIntroModal({ open, onStart }: NoBrainerIntroModalProps) {
  return (
    <Modal
      open={open}
      onClose={onStart}
      title="What's a no-brainer?"
      maxWidth={520}
    >
      <div className="nbl-intro-modal">
        <p className="nbl-intro-modal__body">
          A no-brainer is a hand where all 7 of your starting tiles chain together — meaning you
          can play every single one in one turn and go out before your opponent gets a turn. This
          mode gives you every possible no-brainer deal, so you can train your eye to spot the chain
          instantly.
        </p>
        <p className="nbl-intro-modal__tagline">
          Solve it, and you&apos;ll never miss one in a real game.
        </p>
        <div className="nbl-intro-modal__actions">
          <Button variant="tier-master" type="button" onClick={onStart}>
            Start training
          </Button>
        </div>
      </div>
    </Modal>
  );
}
