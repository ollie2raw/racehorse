import type { BotDealSize } from './botEngine';
import LayoutScreen from '../ui/LayoutScreen';
import './botSetup.css';

interface BotSetupScreenProps {
  dealSize: BotDealSize;
  onDealSizeChange: (size: BotDealSize) => void;
  onStart: () => void;
  onBack: () => void;
}

export default function BotSetupScreen({
  dealSize,
  onDealSizeChange,
  onStart,
  onBack,
}: BotSetupScreenProps) {
  return (
    <LayoutScreen
      className="bot-setup-screen mode-home-screen mode-subpage-screen mode-accent-bot"
      badge="Practice"
      title="Play vs Fritz"
      subtitle="Choose deal size before the match starts."
      contentClassName="multiplayer-menu-card screen-shell bot-setup-content"
    >
      <div className="mode-entry-panel bot-setup-panel-shell">
        <div className="bot-setup-segmented" role="group" aria-label="Bot deal size">
          <button
            type="button"
            onClick={() => onDealSizeChange(7)}
            className={`bot-setup-size-btn ${dealSize === 7 ? 'is-active' : ''}`}
          >
            7 Tiles
          </button>
          <button
            type="button"
            onClick={() => onDealSizeChange(14)}
            className={`bot-setup-size-btn ${dealSize === 14 ? 'is-active' : ''}`}
          >
            14 Tiles
          </button>
        </div>

        <div className="mode-actions bot-setup-actions">
          <button className="mode-option mode-option-primary mode-accent-bot bot-setup-start" onClick={onStart}>
            <span className="mode-option-title">Start</span>
            <span className="mode-option-meta">Begin a {dealSize}-tile match vs bot</span>
          </button>
          <button className="mode-option mode-option-secondary bot-setup-back" onClick={onBack}>
            <span className="mode-option-title">Back to Home</span>
            <span className="mode-option-meta">Return to game mode menu</span>
          </button>
        </div>
      </div>
    </LayoutScreen>
  );
}
