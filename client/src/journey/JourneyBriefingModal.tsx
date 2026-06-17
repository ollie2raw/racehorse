import { Button, Modal } from '../components/primitives';
import type { JourneyBriefing } from './journeyBriefings';

type JourneyBriefingModalProps = {
  open: boolean;
  briefing: JourneyBriefing | null;
  reviewMode: boolean;
  onClose: () => void;
  onComplete?: () => void;
};

export function JourneyBriefingModal({
  open,
  briefing,
  reviewMode,
  onClose,
  onComplete,
}: JourneyBriefingModalProps) {
  if (!briefing) return null;

  return (
    <Modal open={open} onClose={onClose} title={briefing.title} maxWidth={560}>
      <div className="rh-journey-briefing rh-journey-modal-panel">
        <p className="rh-journey-briefing__eyebrow">{briefing.eyebrow}</p>
        <p className="rh-journey-briefing__intro">{briefing.intro}</p>

        <div className="rh-journey-briefing__notes-block">
          <p className="rh-journey-briefing__notes-label">Trail Notes</p>
          <ul className="rh-journey-briefing__notes">
            {briefing.trailNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="rh-journey-briefing__reward">
          <span className="rh-journey-briefing__reward-label">Reward</span>
          <span className="rh-journey-briefing__reward-value">{briefing.rewardLabel}</span>
        </div>

        <div className="rh-journey-briefing__actions">
          {!reviewMode && onComplete ? (
            <Button variant="tier-elite" type="button" onClick={onComplete}>
              Complete Briefing
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {reviewMode ? 'Close' : 'Not Yet'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
