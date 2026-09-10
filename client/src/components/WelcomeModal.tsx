import { Button, Modal } from './primitives';
import type { AppMode } from '../types';
import './WelcomeModal.css';

interface WelcomeModalProps {
  open: boolean;
  /** Dismiss without picking a mode (✕, backdrop, Escape, "Got it"). */
  onDismiss: () => void;
  /** Pick a daily challenge — the caller dismisses and navigates. */
  onNavigate: (mode: AppMode) => void;
}

/**
 * First-visit welcome — "Direction B" (start with today).
 *
 * The home screen already leads with the two daily cards; this leans in: a
 * brand-new player's first action is one of today's challenges, and everything
 * else is a one-line "when you want more" list pointing at the tabs.
 *
 * Wired to `useAppSessionUi`'s `welcomeOpen` / `hasSeenWelcome` — see App.tsx.
 * Copy is `docs/scoping/welcome-modal-copy-drafts-2026-09-10.md` Direction B.
 */
export function WelcomeModal({ open, onDismiss, onNavigate }: WelcomeModalProps) {
  return (
    <Modal open={open} onClose={onDismiss} title="Welcome. Here's today." maxWidth={460}>
      <p className="rh-welcome-lede">
        Racehorse is built around two daily challenges — start with one, and your
        streak begins.
      </p>

      <ul className="rh-welcome-modes">
        <li>
          <span className="rh-welcome-mode-name">Daily Fritz</span>
          <span className="rh-welcome-mode-desc">Best-of-3 against the bot. ~5 minutes.</span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Daily Puzzles</span>
          <span className="rh-welcome-mode-desc">
            Solve as many as you can before the clock runs out.
          </span>
        </li>
      </ul>

      <div className="rh-welcome-cta">
        <Button variant="tier-elite" onClick={() => onNavigate('dailyFritz')}>
          Play Daily Fritz
        </Button>
        <Button variant="tier-standard" onClick={() => onNavigate('puzzleRush')}>
          Play Daily Puzzles
        </Button>
      </div>

      <p className="rh-welcome-more">
        <span className="rh-welcome-more-label">When you want more:</span> full
        matches vs Fritz or a Ghost of your own game · live Multiplayer and
        Tournaments · the Journey campaign · rules and coached games under Learn.
        All from the tabs below.
      </p>

      <div className="rh-welcome-dismiss">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}

export default WelcomeModal;
