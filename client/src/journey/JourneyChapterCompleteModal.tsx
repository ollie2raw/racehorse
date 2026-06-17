import { Button, Modal } from '../components/primitives';
import type { JourneyChapterDefinition } from './journeyTypes';

type JourneyChapterCompleteModalProps = {
  open: boolean;
  chapter: JourneyChapterDefinition | null;
  onClose: () => void;
};

function getChapterCompleteBody(chapter: JourneyChapterDefinition): string {
  if (chapter.chapterNumber === 1) {
    return 'You cleared the opening march—but Racehorse Journey has only just begun. More trails, harder Fritz lines, and deeper chapters are ahead.';
  }
  if (chapter.chapterNumber === 6) {
    return 'You cleared the Master Table—the deepest seat on the Journey so far. More chapters are still ahead.';
  }
  return `You cleared ${chapter.title}. ${chapter.nextChapterCopy}`;
}

export function JourneyChapterCompleteModal({
  open,
  chapter,
  onClose,
}: JourneyChapterCompleteModalProps) {
  if (!chapter) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Chapter ${chapter.chapterNumber} Complete`}
      maxWidth={560}
    >
      <div className="rh-journey-chapter-complete rh-journey-modal-panel">
        <p className="rh-journey-chapter-complete__eyebrow">{chapter.title} Cleared</p>
        <p className="rh-journey-chapter-complete__headline">{chapter.title} conquered.</p>
        <p className="rh-journey-chapter-complete__body">{getChapterCompleteBody(chapter)}</p>
        <div className="rh-journey-chapter-complete__reward">
          <span className="rh-journey-chapter-complete__reward-label">Chapter Reward</span>
          <span className="rh-journey-chapter-complete__reward-value">{chapter.finalReward}</span>
        </div>
        <p className="rh-journey-chapter-complete__teaser">{chapter.nextChapterCopy}</p>
        <div className="rh-journey-chapter-complete__actions">
          <Button variant="tier-elite" type="button" onClick={onClose}>
            Continue the Journey
          </Button>
        </div>
      </div>
    </Modal>
  );
}
