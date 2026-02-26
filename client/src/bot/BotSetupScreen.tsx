import type { BotDealSize } from './botEngine';
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
    <div className="bot-setup-screen">
      <aside className="bot-setup-panel">
        <div className="bot-setup-content">
          <div className="bot-setup-header">
            <div className="bot-setup-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="7" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 4v2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="9.1" cy="12" r="1.1" fill="currentColor" />
                <circle cx="14.9" cy="12" r="1.1" fill="currentColor" />
              </svg>
            </div>
            <div className="bot-setup-headline">
              <p className="lobby-kicker bot-setup-kicker">Practice</p>
              <h2 className="bot-setup-title">Play vs Bot</h2>
              <p className="bot-setup-subtitle">Choose deal size before the match starts.</p>
            </div>
          </div>

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
            <button className="mode-option mode-option-primary bot-setup-start" onClick={onStart}>
              <span className="mode-option-title">Start</span>
              <span className="mode-option-meta">Begin a {dealSize}-tile match vs bot</span>
            </button>
            <button className="mode-option mode-option-secondary" onClick={onBack}>
              <span className="mode-option-title">Back to Home</span>
              <span className="mode-option-meta">Return to game mode menu</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="bot-setup-stage" aria-hidden="true">
        <div className="bot-setup-spotlight" />
      </div>
    </div>
  );
}
