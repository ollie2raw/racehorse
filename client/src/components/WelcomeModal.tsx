import { Button, Modal } from './primitives';
import type { AppMode } from '../types';
import './WelcomeModal.css';

interface WelcomeModalProps {
  open: boolean;
  /** Dismiss without picking a mode (✕, backdrop, Escape, "Let's play"). */
  onDismiss: () => void;
  /** Pick Daily Fritz — the caller dismisses and navigates. */
  onNavigate: (mode: AppMode) => void;
}

/**
 * First-visit welcome — "Option A" (Daily Fritz leads as "start here").
 *
 * Daily Fritz is the one mode framed as a daily habit everywhere else in the
 * product (HomeScreen's "Today's Race" card, the streak strip), so this leads
 * with it as the one obvious first click, then lists every other mode as a
 * one-line description below — no other mode is singled out.
 *
 * Wired to `useAppSessionUi`'s `welcomeOpen` / `hasSeenWelcome` — see App.tsx.
 * Copy is `docs/scoping/welcome-modal-decision-package-2026-09-10.md` §7,
 * Option A. Every line there traces to current in-app copy or server logic —
 * see that doc's grounding table before changing any of these descriptions.
 */
export function WelcomeModal({ open, onDismiss, onNavigate }: WelcomeModalProps) {
  return (
    <Modal open={open} onClose={onDismiss} title="Welcome to Racehorse Dominoes" maxWidth={520}>
      <div className="rh-welcome-start">
        <p className="rh-welcome-start-label">Start here</p>
        <p className="rh-welcome-start-desc">
          Daily Fritz — best of 3, same deal for everyone, once a day.
        </p>
        <Button variant="tier-elite" onClick={() => onNavigate('dailyFritz')}>
          Play Daily Fritz
        </Button>
      </div>

      <p className="rh-welcome-more-label">Everything else, whenever you want it:</p>

      <ul className="rh-welcome-modes">
        <li>
          <span className="rh-welcome-mode-name">Puzzle Rush</span>
          <span className="rh-welcome-mode-desc">Beat the clock, solve as many as you can.</span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Multiplayer</span>
          <span className="rh-welcome-mode-desc">Invite a friend with a room code, 1v1 live.</span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Tournament</span>
          <span className="rh-welcome-mode-desc">
            8-player bracket, first to 30 wins, a new champion every 30 minutes.
          </span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Play vs Fritz</span>
          <span className="rh-welcome-mode-desc">Pick a tier and format, practice offline anytime.</span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Journey</span>
          <span className="rh-welcome-mode-desc">
            The flagship campaign: master every position, beat every chapter.
          </span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Ghost</span>
          <span className="rh-welcome-mode-desc">
            Train a model of your own play from your Fritz matches, then spar against it (or a friend&apos;s).
          </span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">The Lab</span>
          <span className="rh-welcome-mode-desc">
            Spot one-turn, all-7-tile clears before they&apos;re offered.
          </span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Learn</span>
          <span className="rh-welcome-mode-desc">Walk through the rules before your first coached hand.</span>
        </li>
        <li>
          <span className="rh-welcome-mode-name">Social</span>
          <span className="rh-welcome-mode-desc">Your leaderboard, your friends, and what they&apos;re up to.</span>
        </li>
      </ul>

      <div className="rh-welcome-dismiss">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Let&apos;s play →
        </Button>
      </div>
    </Modal>
  );
}

export default WelcomeModal;
